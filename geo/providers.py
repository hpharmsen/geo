"""AI-providers. Elke provider is een losse, uitwisselbare module.

We draaien alleen de providers waarvoor een API-key in de environment staat.
Als er voor een provider geen key is, valt hij terug op een DEMO-antwoord,
zodat de webapp ook zonder keys te demonstreren is. Demo-antwoorden worden
duidelijk als zodanig gemarkeerd (is_demo=True) en tellen niet als echte meting.

Keys uit environment:
  OPENAI_API_KEY, PERPLEXITY_API_KEY, GEMINI_API_KEY
"""

import os
import re
import asyncio
import httpx


def _redact(text):
    """Verwijder API-keys uit een (fout)tekst voordat die gelogd of opgeslagen
    wordt. Gemini zet de key als ?key=... in de URL; OpenAI/Perplexity-keys
    hebben herkenbare prefixes."""
    text = str(text)
    text = re.sub(r"(?i)([?&]key=)[^&\s\"']+", r"\1***", text)
    text = re.sub(r"sk-[A-Za-z0-9_\-]{4,}", "sk-***", text)
    text = re.sub(r"pplx-[A-Za-z0-9_\-]{4,}", "pplx-***", text)
    text = re.sub(r"AQ\.[A-Za-z0-9_\-]{4,}", "AQ.***", text)
    return text


# Modellen — overschrijfbaar via environment.
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")
OPENAI_SEARCH_MODEL = os.getenv("OPENAI_SEARCH_MODEL", "gpt-4o-search-preview")
PERPLEXITY_MODEL = os.getenv("PERPLEXITY_MODEL", "sonar")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-flash-latest")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5")  # goedkoper dan Sonnet, prima voor mention-meting
ANTHROPIC_MAX_TOKENS = int(os.getenv("ANTHROPIC_MAX_TOKENS", "2048"))
ANTHROPIC_SEARCH_USES = int(os.getenv("ANTHROPIC_SEARCH_USES", "2"))

# Vaste, consistente meet-parameters.
TEMPERATURE = float(os.getenv("GEO_TEMPERATURE", "0.7"))
TIMEOUT = float(os.getenv("GEO_HTTP_TIMEOUT", "60"))
RETRIES = int(os.getenv("GEO_RETRIES", "6"))
RETRY_MAX_DELAY = float(os.getenv("GEO_RETRY_MAX_DELAY", "20"))


async def _post_retry(client, url, headers=None, json=None):
    """POST met retry-en-backoff op rate-limit/overload (429/503).

    Een rate-limit-venster reset per minuut, dus we proberen geduldig door
    (cumulatief ~70s over de pogingen) zodat een tijdelijke 429 alsnog slaagt
    i.p.v. als fout te eindigen.
    """
    delay = 2.0
    resp = None
    for attempt in range(RETRIES + 1):
        resp = await client.post(url, headers=headers, json=json, timeout=TIMEOUT)
        if resp.status_code in (429, 503) and attempt < RETRIES:
            await asyncio.sleep(delay)
            delay = min(delay * 2, RETRY_MAX_DELAY)
            continue
        break
    resp.raise_for_status()
    return resp


class ProviderResult:
    """Eén antwoord van één provider op één prompt."""

    def __init__(self, text, model, is_demo=False, error=None, sources=None,
                 usage=None, searches=0):
        self.text = text
        self.model = model
        self.is_demo = is_demo
        self.error = error
        self.sources = sources or []
        self.usage = usage or {"input": 0, "output": 0}
        self.searches = searches


# Geschatte prijzen (USD). Tokens per 1.000.000; 'search' = per zoekopdracht.
# Bij benadering — pas aan als de provider-tarieven wijzigen.
PRICING = {
    "openai":     {"in": 2.50, "out": 10.0, "search": 0.010},
    "gemini":     {"in": 0.30, "out": 2.50, "search": 0.035},
    "perplexity": {"in": 1.00, "out": 1.00, "search": 0.005},
    "anthropic":  {"in": 1.00, "out": 5.00, "search": 0.010},  # Haiku 4.5; zet op 3.0/15.0 voor Sonnet
}


def call_cost(provider, usage, searches):
    """Geschatte kosten (USD) van één call op basis van tokens + zoekopdrachten."""
    p = PRICING.get(provider, {})
    usage = usage or {}
    return (usage.get("input", 0) / 1e6 * p.get("in", 0)
            + usage.get("output", 0) / 1e6 * p.get("out", 0)
            + (searches or 0) * p.get("search", 0))


def available_providers():
    """Welke providers zijn 'echt' beschikbaar (key aanwezig)?"""
    out = {}
    out["openai"] = bool(os.getenv("OPENAI_API_KEY"))
    out["perplexity"] = bool(os.getenv("PERPLEXITY_API_KEY"))
    out["gemini"] = bool(os.getenv("GEMINI_API_KEY"))
    out["anthropic"] = bool(os.getenv("ANTHROPIC_API_KEY"))
    return out


def _demo_answer(prompt, merknaam, concurrenten):
    """Plausibel nep-antwoord voor demo-modus zonder key."""
    namen = list(concurrenten[:3])
    # Zet het merk soms in de lijst zodat de demo niet altijd 0% is.
    if len(prompt) % 2 == 0:
        namen.insert(1, merknaam)
    lijst = ", ".join(namen) if namen else merknaam
    return (
        "[DEMO-antwoord — geen echte API-call] "
        "Er zijn verschillende goede opties. Bekende aanbieders zijn: "
        + lijst
        + ". Welke het beste past hangt af van je budget en wensen."
    )


async def call_openai(client, prompt, merknaam, concurrenten, search=False):
    key = os.getenv("OPENAI_API_KEY")
    model = OPENAI_SEARCH_MODEL if search else OPENAI_MODEL
    if not key:
        return ProviderResult(_demo_answer(prompt, merknaam, concurrenten), model, is_demo=True)
    try:
        body = {"model": model, "messages": [{"role": "user", "content": prompt}]}
        if not search:
            body["temperature"] = TEMPERATURE  # search-preview accepteert geen temperature
        resp = await _post_retry(
            client,
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": "Bearer " + key},
            json=body,
        )
        data = resp.json()
        msg = data["choices"][0]["message"]
        text = msg.get("content") or ""
        sources = []
        for ann in (msg.get("annotations") or []):
            url = (ann.get("url_citation") or {}).get("url")
            if url:
                sources.append(url)
        u = data.get("usage") or {}
        usage = {"input": u.get("prompt_tokens", 0), "output": u.get("completion_tokens", 0)}
        return ProviderResult(text, model, sources=sources, usage=usage, searches=1 if search else 0)
    except Exception as e:  # noqa: BLE001 — meting mag niet crashen op 1 call
        return ProviderResult("", model, error=_redact(e))


async def call_perplexity(client, prompt, merknaam, concurrenten, search=True):
    # Perplexity (sonar) zoekt altijd live op het web; de search-vlag heeft geen effect.
    key = os.getenv("PERPLEXITY_API_KEY")
    if not key:
        return ProviderResult(_demo_answer(prompt, merknaam, concurrenten), PERPLEXITY_MODEL, is_demo=True)
    try:
        resp = await _post_retry(
            client,
            "https://api.perplexity.ai/chat/completions",
            headers={"Authorization": "Bearer " + key},
            json={
                "model": PERPLEXITY_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": TEMPERATURE,
            },
        )
        data = resp.json()
        text = data["choices"][0]["message"]["content"]
        sources = data.get("citations", []) or []
        u = data.get("usage") or {}
        usage = {"input": u.get("prompt_tokens", 0), "output": u.get("completion_tokens", 0)}
        return ProviderResult(text, PERPLEXITY_MODEL, sources=sources, usage=usage, searches=1)
    except Exception as e:  # noqa: BLE001
        return ProviderResult("", PERPLEXITY_MODEL, error=_redact(e))


async def call_gemini(client, prompt, merknaam, concurrenten, search=False):
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        return ProviderResult(_demo_answer(prompt, merknaam, concurrenten), GEMINI_MODEL, is_demo=True)
    try:
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            + GEMINI_MODEL
            + ":generateContent?key="
            + key
        )
        body = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": TEMPERATURE},
        }
        if search:
            body["tools"] = [{"google_search": {}}]
        resp = await _post_retry(client, url, json=body)
        data = resp.json()
        cand = data["candidates"][0]
        parts = cand.get("content", {}).get("parts", [])
        text = "".join(p.get("text", "") for p in parts)
        sources = []
        for chunk in (cand.get("groundingMetadata", {}).get("groundingChunks") or []):
            uri = (chunk.get("web") or {}).get("uri")
            if uri:
                sources.append(uri)
        um = data.get("usageMetadata") or {}
        usage = {"input": um.get("promptTokenCount", 0), "output": um.get("candidatesTokenCount", 0)}
        return ProviderResult(text, GEMINI_MODEL, sources=sources, usage=usage, searches=1 if search else 0)
    except Exception as e:  # noqa: BLE001
        return ProviderResult("", GEMINI_MODEL, error=_redact(e))


async def call_anthropic(client, prompt, merknaam, concurrenten, search=False):
    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        return ProviderResult(_demo_answer(prompt, merknaam, concurrenten), ANTHROPIC_MODEL, is_demo=True)
    try:
        body = {
            "model": ANTHROPIC_MODEL,
            "max_tokens": ANTHROPIC_MAX_TOKENS,
            "temperature": TEMPERATURE,
            "messages": [{"role": "user", "content": prompt}],
        }
        if search:
            body["tools"] = [{"type": "web_search_20250305", "name": "web_search",
                              "max_uses": ANTHROPIC_SEARCH_USES}]
        resp = await _post_retry(
            client,
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json=body,
        )
        data = resp.json()
        # content is een lijst blokken; pak de tekst-blokken + bron-URL's uit zoekresultaten.
        text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
        sources = []
        for b in data.get("content", []):
            if b.get("type") == "web_search_tool_result":
                for r in (b.get("content") or []):
                    if isinstance(r, dict) and r.get("url"):
                        sources.append(r["url"])
        u = data.get("usage") or {}
        usage = {"input": u.get("input_tokens", 0), "output": u.get("output_tokens", 0)}
        searches = (u.get("server_tool_use") or {}).get("web_search_requests")
        if searches is None:
            searches = 1 if search else 0
        return ProviderResult(text, ANTHROPIC_MODEL, sources=sources, usage=usage, searches=searches)
    except Exception as e:  # noqa: BLE001
        return ProviderResult("", ANTHROPIC_MODEL, error=_redact(e))


# Registry: providernaam -> call-functie.
PROVIDERS = {
    "openai": call_openai,
    "perplexity": call_perplexity,
    "gemini": call_gemini,
    "anthropic": call_anthropic,
}
