"""Meet-motor: draait de promptset langs de providers, meerdere runs per prompt,
aggregeert en schrijft result.json + rapport.md weg.

Het echte werk gebeurt hier (netwerk + keys op de server). De frontend toont
alleen het resultaat.
"""

import os
import re
import json
import asyncio
import datetime

import httpx

from . import prompts as prompts_mod
from . import providers as providers_mod
from . import analyze as analyze_mod
from . import report as report_mod
from . import book_prompts as book_mod
from .logsetup import get_logger

log = get_logger()

# Voorkeursvolgorde voor het model dat de diepte-analyses draait.
_BOOK_PROVIDER_ORDER = ["openai", "anthropic", "perplexity", "gemini"]
_BOOK_PROVIDER_LABEL = {"openai": "ChatGPT", "anthropic": "Claude",
                        "perplexity": "Perplexity", "gemini": "Gemini"}

# Meetmodi en hun mensgerichte labels.
_MODUS_LABELS = {"kaal": "Uit het geheugen", "zoeken": "Met live zoeken"}
_MODUS_PLAN = {
    "kaal": [("kaal", False)],
    "zoeken": [("zoeken", True)],
    "beide": [("kaal", False), ("zoeken", True)],
}


async def _fetch_page_text(client, url):
    """Haalt de zichtbare tekst van een pagina op (grove HTML-strip) voor de
    dvv-analyse. Geeft None terug als het niet lukt."""
    if not url:
        return None
    try:
        resp = await client.get(url, timeout=20, follow_redirects=True,
                                headers={"User-Agent": "Mozilla/5.0 (GEO-meter)"})
        resp.raise_for_status()
        html = resp.text
        html = re.sub(r"(?is)<(script|style|noscript).*?</\1>", " ", html)
        text = re.sub(r"(?s)<[^>]+>", " ", html)
        text = re.sub(r"\s+", " ", text).strip()
        return text[:6000] if text else None
    except Exception as e:  # noqa: BLE001
        log.warning("paginatekst ophalen mislukt (%s): %s", url, e)
        return None

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")

# Concurrency per provider. OpenAI/Perplexity (betaald, hoge limieten) mogen
# veel parallel; Gemini getemperd omdat de gratis tier snel een 429 geeft.
# Heb je Gemini-billing aan? Zet GEO_CONC_GEMINI hoger voor extra snelheid.
PROVIDER_CONCURRENCY = {
    "openai": int(os.getenv("GEO_CONC_OPENAI", "8")),
    "perplexity": int(os.getenv("GEO_CONC_PERPLEXITY", "8")),  # hogere tier; adaptieve rem vangt pieken
    "gemini": int(os.getenv("GEO_CONC_GEMINI", "8")),
    "anthropic": int(os.getenv("GEO_CONC_ANTHROPIC", "8")),  # Tier 2+
}

# Mensgerichte namen voor in meldingen.
PROVIDER_NAMES = {"openai": "ChatGPT", "gemini": "Gemini",
                  "perplexity": "Perplexity", "anthropic": "Claude"}

# Adaptieve rem: per provider een extra wachttijd (sec) vóór elke call. Groeit
# bij een 429, krimpt bij succes. Gedeeld over alle metingen. Zelf-regelend.
_PROVIDER_DELAY = {}
_DELAY_STEP = float(os.getenv("GEO_DELAY_STEP", "1.5"))
_DELAY_MAX = float(os.getenv("GEO_DELAY_MAX", "10"))
_DELAY_DECAY = float(os.getenv("GEO_DELAY_DECAY", "0.3"))
_DEFAULT_CONCURRENCY = int(os.getenv("GEO_MAX_CONCURRENCY", "5"))

# Globale semaforen: GEDEELD over alle gelijktijdige metingen (alle gebruikers
# samen), niet per meting. Zo overspoelen 15 gelijktijdige gebruikers de
# providers en de rekening niet. Lazy aangemaakt binnen de event loop.
_GLOBAL_SEMS = {}


def _global_sems(providers):
    for p in providers:
        if p not in _GLOBAL_SEMS:
            _GLOBAL_SEMS[p] = asyncio.Semaphore(PROVIDER_CONCURRENCY.get(p, _DEFAULT_CONCURRENCY))
    return _GLOBAL_SEMS


def _slug(s):
    keep = "".join(c if c.isalnum() else "-" for c in (s or "").lower())
    while "--" in keep:
        keep = keep.replace("--", "-")
    return keep.strip("-") or "merk"


async def run_measurement(config, progress=None):
    """config: dict met merknaam, url, categorie, markt, taal, concurrenten,
    runs_per_prompt. Geeft het result-dict terug en schrijft de bestanden.

    progress: optionele callable(done, total) voor voortgang.
    """
    merknaam = config["merknaam"]
    url = config.get("url", "")
    categorie = config["categorie"]
    markt = config.get("markt", "")
    taal = config.get("taal", "nl")
    concurrenten = config.get("concurrenten", []) or []
    runs = int(config.get("runs_per_prompt", 5))
    doelgroep = config.get("doelgroep", "")

    promptset = prompts_mod.generate_promptset(categorie, markt, concurrenten, taal, doelgroep)

    beschikbaar = providers_mod.available_providers()
    actieve_providers = list(providers_mod.PROVIDERS.keys())  # alle, demo-fallback regelt de rest
    demo_modus = not all(beschikbaar.values())

    # Meetmodus: kaal (geheugen), zoeken (live web), of beide (vergelijk).
    modus = config.get("modus", "zoeken")
    plan = _MODUS_PLAN.get(modus, _MODUS_PLAN["zoeken"])
    modi = [label for label, _ in plan]

    # Bouw de takenlijst: modus x provider x prompt x run.
    taken = []
    for modus_label, search_flag in plan:
        for provider in actieve_providers:
            for prompt in promptset:
                for _ in range(runs):
                    taken.append((provider, prompt, search_flag, modus_label))

    # Diepte-analyses uit het boek (optioneel). Via het sterkste beschikbare model.
    boek_aan = bool(config.get("boek_analyses", False))
    boek_provider = next((p for p in _BOOK_PROVIDER_ORDER if beschikbaar.get(p)), "openai")
    boek_label = _BOOK_PROVIDER_LABEL.get(boek_provider, "de AI")
    boek_search = modus != "kaal"  # diepte-analyses mét zoeken tenzij puur 'kaal'

    meting_id = config.get("meting_id") or (_slug(merknaam) + "-" + datetime.date.today().isoformat())
    total = len(taken) + (len(book_mod._PROMPTS) if boek_aan else 0)
    done = {"n": 0}
    # Globale semaforen per provider (gedeeld over alle gelijktijdige metingen).
    sems = _global_sems(actieve_providers)
    per_run = []
    boek_analyses = []
    fout_log = []  # foutdetails voor in result.json
    throttled = {}  # provider -> huidige rem-vertraging (sec), voor de melding
    kosten = {}  # provider -> {usd, in, out, searches} (geschatte API-kosten)

    def _bill(provider, res):
        e = kosten.setdefault(provider, {"usd": 0.0, "in": 0, "out": 0, "searches": 0})
        e["usd"] += providers_mod.call_cost(provider, res.usage, res.searches)
        e["in"] += (res.usage or {}).get("input", 0)
        e["out"] += (res.usage or {}).get("output", 0)
        e["searches"] += res.searches or 0

    log.info("START meting %s | merk=%r categorie=%r markt=%r taal=%s runs=%s modus=%s boek=%s providers=%s",
             meting_id, merknaam, categorie, markt, taal, runs, modus, boek_aan, beschikbaar)

    def _melding():
        """Bouwt de schermmelding op basis van wie er nu afgeremd wordt."""
        namen = [PROVIDER_NAMES.get(p, p) for p in sorted(throttled)]
        if not namen:
            return None
        wie = namen[0] if len(namen) == 1 else (", ".join(namen[:-1]) + " en " + namen[-1])
        return ("We temperen " + wie + " even om de rate limit te ontwijken — "
                "de meting loopt door, maar duurt hierdoor iets langer.")

    def _register(provider, res):
        """Past de adaptieve rem aan: 429 → trager, succes → weer sneller."""
        is_429 = res.error and "429" in str(res.error)
        d = _PROVIDER_DELAY.get(provider, 0.0)
        if is_429:
            _PROVIDER_DELAY[provider] = min(d + _DELAY_STEP, _DELAY_MAX)
            throttled[provider] = _PROVIDER_DELAY[provider]
            log.info("meting %s | %s afgeremd naar +%.1fs (rate limit)", meting_id, provider, _PROVIDER_DELAY[provider])
        elif not res.error:
            nieuw = max(0.0, d - _DELAY_DECAY)
            _PROVIDER_DELAY[provider] = nieuw
            if nieuw == 0.0:
                throttled.pop(provider, None)

    async def _pace(provider):
        d = _PROVIDER_DELAY.get(provider, 0.0)
        if d:
            await asyncio.sleep(d)

    async with httpx.AsyncClient() as client:
        async def worker(provider, prompt, search_flag, modus_label):
            async with sems[provider]:
                await _pace(provider)
                call = providers_mod.PROVIDERS[provider]
                res = await call(client, prompt, merknaam, concurrenten, search=search_flag)
                _register(provider, res)
                _bill(provider, res)
                analysis = analyze_mod.analyze_answer(
                    res.text, merknaam, concurrenten, url, sources=res.sources
                )
                if res.error:
                    log.warning("meting %s | %s (%s) fout bij prompt %r: %s",
                                meting_id, provider, modus_label, prompt[:60], res.error)
                    fout_log.append({"bron": provider, "modus": modus_label,
                                     "prompt": prompt[:80], "fout": str(res.error)})
                per_run.append({
                    "provider": provider,
                    "modus": modus_label,
                    "prompt": prompt,
                    "analysis": analysis,
                    "text": (res.text or "")[:4000],
                    "is_demo": res.is_demo,
                    "error": res.error,
                })
                done["n"] += 1
                if progress:
                    progress(done["n"], total, _melding())

        async def boek_phase():
            # Overlapt met de hoofdmeting: scheelt wachttijd.
            dvv_url = (config.get("landingspagina") or url or "").strip()
            paginatekst = await _fetch_page_text(client, dvv_url)
            if not paginatekst:
                fout_log.append({"bron": "paginatekst", "prompt": dvv_url, "fout": "kon niet worden opgehaald"})
            prompts = book_mod.build_book_prompts(config, model_naam=boek_label, paginatekst=paginatekst)
            call = providers_mod.PROVIDERS[boek_provider]

            async def boek_worker(item):
                async with sems[boek_provider]:
                    await _pace(boek_provider)
                    res = await call(client, item["prompt"], merknaam, concurrenten, search=boek_search)
                    _register(boek_provider, res)
                    _bill(boek_provider, res)
                    if res.error:
                        log.warning("meting %s | boek/%s fout: %s", meting_id, item["id"], res.error)
                        fout_log.append({"bron": "boek/" + item["id"], "prompt": item["titel"], "fout": str(res.error)})
                    done["n"] += 1
                    if progress:
                        progress(done["n"], total, _melding())
                    return {"id": item["id"], "titel": item["titel"],
                            "uitleg": item["uitleg"], "prompt": item["prompt"],
                            "antwoord": res.text, "error": res.error, "is_demo": res.is_demo}

            res_list = await asyncio.gather(*[boek_worker(it) for it in prompts])
            order = {pid: i for i, (pid, _t, _u, _p) in enumerate(book_mod._PROMPTS)}
            res_list.sort(key=lambda a: order.get(a["id"], 99))
            return res_list

        tasks = [worker(p, q, s, m) for (p, q, s, m) in taken]
        if boek_aan:
            tasks.append(boek_phase())
        results = await asyncio.gather(*tasks)
        if boek_aan:
            boek_analyses = results[-1]  # de boek_phase()-uitkomst

    rows = analyze_mod.rows_per_provider_modus(per_run)
    totaal_per_modus = analyze_mod.totals_per_modus(per_run)
    concurrenten_per_modus = analyze_mod.competitor_shares_per_modus(per_run, concurrenten)
    antwoorden = analyze_mod.answers_drilldown(per_run)

    datum = datetime.date.today().isoformat()
    modellen = {
        "openai": providers_mod.OPENAI_MODEL,
        "perplexity": providers_mod.PERPLEXITY_MODEL,
        "gemini": providers_mod.GEMINI_MODEL,
        "anthropic": providers_mod.ANTHROPIC_MODEL,
    }

    kosten_totaal = round(sum(e["usd"] for e in kosten.values()), 4)
    kosten_per_provider = {p: {"usd": round(e["usd"], 4), "in_tokens": e["in"],
                               "out_tokens": e["out"], "searches": e["searches"]}
                           for p, e in kosten.items()}

    result = {
        "merknaam": merknaam,
        "url": url,
        "categorie": categorie,
        "markt": markt,
        "taal": taal,
        "datum": datum,
        "meting_id": meting_id,
        "demo_modus": demo_modus,
        "providers_beschikbaar": beschikbaar,
        "modellen": modellen,
        "runs_per_prompt": runs,
        "promptset": promptset,
        "modus": modus,
        "modi": modi,
        "modus_labels": {m: _MODUS_LABELS.get(m, m) for m in modi},
        "heeft_concurrenten": bool(concurrenten),
        "rows": rows,
        "totaal_per_modus": totaal_per_modus,
        "concurrenten_per_modus": concurrenten_per_modus,
        "antwoorden": antwoorden,
        "boek_analyses": list(boek_analyses),
        "boek_model": (boek_label + " (" + modellen.get(boek_provider, "") + ")") if boek_aan else None,
        "log": {
            "aantal_fouten": len(fout_log),
            "fouten": fout_log,
            "kosten_usd_schatting": kosten_totaal,
            "kosten_per_provider": kosten_per_provider,
        },
    }

    rapport_md = report_mod.build_report(result)

    out_dir = os.path.join(DATA_DIR, meting_id)
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "result.json"), "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    with open(os.path.join(out_dir, "rapport.md"), "w", encoding="utf-8") as f:
        f.write(rapport_md)

    _eerste = totaal_per_modus.get(modi[0], {}) if modi else {}
    log.info("KLAAR meting %s | modus=%s mention(%s)=%s fouten=%s kosten~$%.2f -> %s",
             meting_id, modus, (modi[0] if modi else "-"), _eerste.get("mention_share"),
             len(fout_log), kosten_totaal, os.path.join(out_dir, "result.json"))
    log.info("KOSTEN meting %s | totaal~$%.2f | per provider: %s",
             meting_id, kosten_totaal,
             ", ".join("%s $%.3f (%dx zoek)" % (PROVIDER_NAMES.get(p, p), e["usd"], e["searches"])
                       for p, e in kosten.items()))
    return result


def load_result(meting_id):
    path = os.path.join(DATA_DIR, meting_id, "result.json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_report(meting_id):
    path = os.path.join(DATA_DIR, meting_id, "rapport.md")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return f.read()
