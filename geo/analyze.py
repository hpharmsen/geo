"""Detectie per antwoord + aggregatie naar scores.

Per AI-antwoord bepalen we:
  - genoemd?        merknaam komt voor (case-insensitive, simpele varianten)
  - concurrenten    welke van de opgegeven concurrenten genoemd worden
  - positie         volgorde van eerste verschijning t.o.v. concurrenten
  - geciteerd?      de merk-URL (domein) komt voor in de tekst/bronnen

Sentiment laten we in deze versie bewust leeg (None): liever niet meten dan
slecht meten. Komt later.
"""

import re
from urllib.parse import urlparse


def _norm(s):
    return re.sub(r"\s+", " ", (s or "").lower()).strip()


def _domain(url):
    if not url:
        return ""
    if "://" not in url:
        url = "http://" + url
    netloc = urlparse(url).netloc.lower()
    return netloc[4:] if netloc.startswith("www.") else netloc


def _name_present(text_low, naam):
    """Komt een merknaam voor? Hele-woord match, accent/leesteken-tolerant."""
    if not naam:
        return False
    naam_low = _norm(naam)
    # Woordgrenzen, maar sta toe dat de naam zelf spaties/leestekens bevat.
    pattern = r"(?<![a-z0-9])" + re.escape(naam_low) + r"(?![a-z0-9])"
    return re.search(pattern, text_low) is not None


def analyze_answer(text, merknaam, concurrenten, merk_url, sources=None):
    """Geeft een dict met de bevindingen voor één antwoord."""
    text_low = _norm(text)
    sources = sources or []

    mentioned = _name_present(text_low, merknaam)

    competitors_present = [c for c in concurrenten if _name_present(text_low, c)]

    # Positie: volgorde van eerste verschijning onder {merk + concurrenten}.
    positie = None
    if mentioned:
        alle = [merknaam] + list(concurrenten)
        eerste_index = {}
        for naam in alle:
            naam_low = _norm(naam)
            m = re.search(r"(?<![a-z0-9])" + re.escape(naam_low) + r"(?![a-z0-9])", text_low)
            if m:
                eerste_index[naam] = m.start()
        gesorteerd = sorted(eerste_index, key=lambda n: eerste_index[n])
        if merknaam in gesorteerd:
            positie = gesorteerd.index(merknaam) + 1

    # Citatie: merk-domein in tekst of in meegeleverde bron-URL's.
    dom = _domain(merk_url)
    cited = False
    if dom:
        haystack = text_low + " " + " ".join(s.lower() for s in sources)
        cited = dom in haystack

    return {
        "mentioned": mentioned,
        "position": positie,
        "competitors_present": competitors_present,
        "cited": cited,
    }


def _agg(rows):
    # Gefaalde calls (error gezet) tellen NIET mee als "niet genoemd" —
    # ze worden apart geteld zodat een kapotte provider geen fake 0% geeft.
    ok = [r for r in rows if not r.get("error")]
    errors = len(rows) - len(ok)
    n = len(ok)
    if n == 0:
        return {"runs": 0, "errors": errors, "mention_share": None,
                "citatie_share": None, "gem_positie": None}
    mentions = sum(1 for r in ok if r["analysis"]["mentioned"])
    cites = sum(1 for r in ok if r["analysis"]["cited"])
    posities = [r["analysis"]["position"] for r in ok if r["analysis"]["position"]]
    return {
        "runs": n,
        "errors": errors,
        "mention_share": round(mentions / n, 3),
        "citatie_share": round(cites / n, 3),
        "gem_positie": round(sum(posities) / len(posities), 2) if posities else None,
    }


def rows_per_provider_modus(per_run):
    """Lijst rijen, één per (provider, modus), met de aggregatie erin."""
    keys = sorted({(r["provider"], r.get("modus", "kaal")) for r in per_run})
    rows = []
    for prov, modus in keys:
        subset = [r for r in per_run if r["provider"] == prov and r.get("modus", "kaal") == modus]
        agg = _agg(subset)
        agg["provider"] = prov
        agg["modus"] = modus
        rows.append(agg)
    return rows


def totals_per_modus(per_run):
    """Totaal-aggregatie per modus (over alle providers heen)."""
    modi = sorted({r.get("modus", "kaal") for r in per_run})
    return {m: _agg([r for r in per_run if r.get("modus", "kaal") == m]) for m in modi}


def answers_drilldown(per_run):
    """Per (modus, prompt, provider): frequentie + één representatief antwoord.

    Representatief = eerste geslaagde run waarin het merk genoemd is; anders de
    eerste geslaagde run; anders de eerste (zodat een fout ook zichtbaar is).
    """
    keys = []
    seen = set()
    for r in per_run:
        k = (r.get("modus", "kaal"), r["prompt"], r["provider"])
        if k not in seen:
            seen.add(k)
            keys.append(k)

    out = []
    for modus, prompt, provider in keys:
        groep = [r for r in per_run if r.get("modus", "kaal") == modus
                 and r["prompt"] == prompt and r["provider"] == provider]
        ok = [r for r in groep if not r.get("error")]
        mentioned_count = sum(1 for r in ok if r["analysis"]["mentioned"])
        # Kies het representatieve antwoord.
        voorbeeld = next((r for r in ok if r["analysis"]["mentioned"]), None) \
            or (ok[0] if ok else groep[0])
        out.append({
            "modus": modus,
            "prompt": prompt,
            "provider": provider,
            "runs": len(ok),
            "mentioned_count": mentioned_count,
            "voorbeeld_text": voorbeeld.get("text", ""),
            "voorbeeld_mentioned": voorbeeld["analysis"]["mentioned"],
            "voorbeeld_positie": voorbeeld["analysis"]["position"],
            "voorbeeld_error": voorbeeld.get("error"),
        })
    return out


def competitor_shares_per_modus(per_run, concurrenten):
    """Mention share per concurrent, per modus (over geslaagde runs)."""
    modi = sorted({r.get("modus", "kaal") for r in per_run})
    out = {}
    for m in modi:
        ok = [r for r in per_run if r.get("modus", "kaal") == m and not r.get("error")]
        n = len(ok)
        out[m] = {}
        for c in concurrenten:
            out[m][c] = round(sum(1 for r in ok if c in r["analysis"]["competitors_present"]) / n, 3) if n else 0.0
    return out
