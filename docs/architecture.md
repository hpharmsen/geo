# Architectuur (V1 — Django-API + GitHub Pages frontend)

Status: V1 minimal — fase 1+2 (backend) afgerond, fase 3+6 (frontend + cleanup)
nog te doen. Zie `docs/plans/2026-06-24-002-geo-django-static-v1-minimal-plan.md`.

## Twee repos, één tool

| Repo | Rol | Hosting |
|---|---|---|
| `~/Sites/harmsen.nl/` | Dunne Django-API (`apps/geo/`) | Heroku, bestaand project |
| `~/proj/geo/` | Statische frontend op `geo.harmsen.nl` | GitHub Pages |

De FastAPI-app in `~/proj/geo/` is uitgefaseerd: de detectielogica (`analyze.py`,
`report.py`) wordt geport naar JS in de frontend; de provider-calls
(`providers.py`) verhuizen naar Django; orkestratie verhuist naar de browser.

## Backend: `apps/geo/` in harmsen.nl

Drie endpoints onder `harmsen.nl/api/geo/*`. Sync views (`def`), één call =
één LLM-call, `httpx.Client(timeout=28.0)` (binnen Heroku 30s-router-limiet).

```
POST /api/geo/run        {provider, prompt, search?, max_tokens?, merknaam?, concurrenten?}
                         → {text, model, sources, usage, cost_usd, error, is_demo}

POST /api/geo/prompts    {categorie, markt, taal, concurrenten, doelgroep, merknaam?, landingspagina?}
                         → {prompts: [...], book_prompts: [...]}

GET  /api/geo/config     → {available_providers, available, max_runs_per_prompt,
                            max_tokens_cap, cors_allowed_origins}
```

`config` lekt geen `daily_budget_remaining` — alleen boolean `available`.

### Bestanden (apps/geo/)

```
apps.py           AppConfig (justlog setup als beschikbaar)
urls.py           run / prompts / config
views.py          sync views + body-cap + ratelimit-checks + sanitization
providers.py      sync httpx-port + _redact (sk-, pplx-, AIza, postgres, Bearer)
prompts.py        categorie-prompts (NL/EN templates, merknaam-vrij)
book_prompts.py   6 diepte-analyses (DVV wordt overgeslagen zonder landingspagina)
ratelimit.py      USD kill-switch (DB-cache) + per-IP rate-limit (LocMem)
tests.py          19 tests, draaien zonder externe API-calls
```

### Anti-abuse (twee lagen)

1. **Dagelijkse USD kill-switch** (`GEO_DAILY_USD_CAP`, default $5). Counter
   in cache `usdcap` (DatabaseCache → cross-worker correct). Charging:
   - Succes: `call_cost(provider, usage, searches)` op basis van werkelijke usage.
   - Timeout: `pessimistic_cost(provider, max_tokens, search)` — voorkomt
     dat storms onder de cap blijven door enkel timeouts uit te lokken.
   - Boven plafond: `/api/geo/run` → 503 `{error: 'Dagbudget bereikt'}`.
2. **Per-IP rate-limit** (5 metingen/IP/uur). Counter in cache `default`
   (LocMem; per-worker drift acceptabel, worst-case 5×workers/uur per IP).
   Key = `sha256(ip-bucket + '|' + GEO_IP_PEPPER)[:16]`; IPv6 truncate naar /64.

### Aanvullende guards

- Body-cap 10KB per /api/geo-call (in-view check; host's globale
  `DATA_UPLOAD_MAX_MEMORY_SIZE=10MB` blijft staan voor recipescanner).
- `max_tokens` server-side gecapt op 800 — frontend mag het niet ophogen.
- Input-sanitization (`_clean`): strip control chars + whitelist
  `\w \s - & . , /`; caps merknaam 60, categorie 80, markt 40, concurrent 60.
- `_redact()` redact in fouttekst: OpenAI/Perplexity/Anthropic prefixes,
  Gemini `AIza…`, `postgres://…`, `Bearer …`, en `?key=…` URL-params.
- CORS-allowlist alleen op `/api/geo/*` (regex), via `GEO_CORS_ORIGINS`
  env-var. `CORS_ALLOW_CREDENTIALS=False`, `CORS_MAX_AGE=86400`.

### Host-aanpassingen (harmsen.nl)

- `website/urls.py`: explicit `path('api/geo/', include('apps.geo.urls'))`;
  `geo` overgeslagen in de auto-loop (zoals `nieuwsbrief`).
- `website/settings.py`: `corsheaders` in INSTALLED_APPS + MIDDLEWARE,
  CORS-config, CACHES (`default`=LocMem, `usdcap`=DatabaseCache), `'test'`
  toegevoegd aan `in_local_mode` (skipt django-on-heroku tijdens tests).
- `website/test_settings.py`: nieuwe override die migraties uitschakelt
  zodat tests op sqlite draaien (apps/geo heeft zelf geen models).
- `Procfile`: gunicorn `--workers 2 --threads 6 --max-requests 1000` →
  12 concurrent slots; `release` voegt `createcachetable` toe.
- `pyproject.toml`: `django-cors-headers`, `httpx` toegevoegd via `uv add`.

## Frontend: GitHub Pages site op `geo.harmsen.nl` (nog te bouwen — Fase 3+4)

`~/proj/geo/` wordt omgebouwd tot statische frontend:

```
CNAME                     "geo.harmsen.nl"
index.html                single-page widget + CSP-meta
config.js                 BACKEND_URL = 'https://harmsen.nl/api/geo'
brand.js                  teksten/merknaam
theme.css                 CSS-vars (lettertypes + kleuren van harmsen.nl)
analyze.js                port van Python analyze.py
report.js                 port van Python report.py
app.js                    glue: formulier → queue (6 parallel) → rapport
tests/                    node --test, fetch-mock + parity-corpus
```

XSS-bescherming: LLM-output altijd via `textContent`; CSP-meta in `index.html`
beperkt `connect-src` tot `'self' https://harmsen.nl`.

### Retry-matrix (frontend orkestratie)

| Foutoorzaak | Detectie | Actie |
|---|---|---|
| Netwerk down | `fetch` throwt / `navigator.onLine` | Wacht op `online` |
| Heroku H12 timeout | 503 / abort na 30s | 1× retry na 3s, daarna failed |
| Provider-fout in body | 200 + `error`-veld | Geen retry; mark failed |
| Daily kill-switch | 503 + 'Dagbudget…' | Stop meting, modal |
| IP-rate-limit | 429 | Modal; queue stopt |
| 5xx overig | 500/502 | 1× retry na 3s |
| 4xx overig | 400/403/404 | Geen retry |

## Externe afhankelijkheden

- OpenAI Chat Completions API
- Perplexity Chat Completions API (sonar)
- Google Generative Language API (Gemini)
- Anthropic Messages API
- `httpx` (sync `Client`) voor alle HTTP-calls
- `django-cors-headers` voor cross-origin headers

## Environment-variabelen (Heroku)

```
OPENAI_API_KEY, PERPLEXITY_API_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY
GEO_DAILY_USD_CAP=5            # default $5/dag
GEO_IP_HOURLY_LIMIT=5          # default 5/IP/uur
GEO_IP_PEPPER=<random 32 bytes>  # vereist voor IP-hash (GDPR)
GEO_CORS_ORIGINS=https://geo.harmsen.nl
```

## Tests

```
cd ~/Sites/harmsen.nl    # of de feat/geo-api worktree
uv run python manage.py test apps.geo --settings=website.test_settings
```

19 tests dekken: demo-fallback, valid-call shape, ongeldig provider, lege
prompt, oversized body, max_tokens-cap, dagbudget-503, IP-rate-limit-429,
kosten-counter (succes + timeout), input-sanitization, config-no-budget-leak,
promptset-shape, book_prompts dvv-skip/met-pagina, `_redact` van extra patronen.

## Beperkingen V1

- Geen authenticatie; alleen IP-cap + USD-cap. Trigger voor V1.1
  (Turnstile + JWT measurement-tokens): URL publiek gedeeld, of dagcap fired
  van vreemde IP.
- Geen resumable measurements; bij browser-crash mid-meting moet je opnieuw.
- Geen server-side opslag van metingen — resultaten leven in de browser tot
  tab sluit, user downloadt `rapport.md`.

## V2 (gepland)

`theadarchitect.nl`: tweede merk, eigen branding, dezelfde backend, geen
duplicatie van keys. Multi-theme via `brand.js`-split + CSS-vars per merk.
