# Architectuur (V1 — Django-API + GitHub Pages frontend)

Status: V1 minimal — fase 1+2 (backend) en fase 3+4 (frontend-port + orkestratie)
afgerond. Resterend: fase 5 (GH Pages + DNS + CORS) en fase 6 (cleanup van de
oude FastAPI-bestanden in `~/proj/geo/`). Zie
`docs/plans/2026-06-24-002-geo-django-static-v1-minimal-plan.md`.

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

## Frontend: GitHub Pages site op `geo.harmsen.nl`

`~/proj/geo/` is een statische frontend. Voor Fase 4 wonen de bestanden nog
in `static/`; Fase 6 verhuist alles naar repo-root (zodat de GH Pages-deploy
één directory pakt). Alle imports zijn relatief, dus de verhuizing is
puur een `git mv`.

```
static/
  index.html        single-page widget + CSP-meta
  config.js         BACKEND_URL (auto-detect localhost vs production)
  brand.js          teksten/merknaam (gebruikersbewerkbaar)
  theme.css         CSS-vars (kleuren + lettertype)
  api.js            dunne wrapper rond /api/geo/{config,prompts,run}
  queue.js          parallel-queue met retry/stop-condities (testbaar)
  analyze.js        port van Python analyze.py
  report.js         port van Python report.py
  app.js            DOM glue: formulier → queue → render → rapport
  favicon.png
tests/
  queue.test.js     9 tests (node --test, geen DOM-dep)
  analyze.test.js   16 tests (parity met analyze.py)
  report.test.js    14 tests (rapport-structuur)
  parity/           live-corpus parity-check (read README)
```

### Flow van een meting (in de browser)

1. `app.js` haalt `/api/geo/config` → welke providers staan aan.
2. `POST /api/geo/prompts` → `{prompts, book_prompts}`.
3. Bouwt takenlijst `modus × provider × prompt × run`.
4. `runQueue` (concurrency 6) → per task `POST /api/geo/run`.
5. Per resultaat: `analyzeAnswer(text, merknaam, concurrenten, url, sources)`
   in JS; push naar `per_run`.
6. Boek-fase (optioneel): aparte queue (concurrency 3), één run per
   diepte-prompt via de sterkste beschikbare provider.
7. Aggregeer (`rowsPerProviderModus`, `totalsPerModus`, etc.) → render +
   `buildReport(result)` → `rapport.md` download.

### Beveiliging in de browser

- **CSP-meta**: `default-src 'self'`, `connect-src 'self' https://harmsen.nl
  http://localhost:8000`, `script-src 'self'`, fonts alleen vanuit
  fonts.gstatic.com.
- **Geen innerHTML voor LLM-tekst**: alle AI-antwoorden gaan via
  `textContent` + DOM-constructie (`highlightInto`). Boek-analyses
  passeren een minimale, in-browser markdown-renderer die eerst alles
  escapet.
- **Geen externe scripts** (geen CDN-marked, geen analytics).

### Retry-matrix (queue.js + api.js)

`classifyResponse(status, body)` in `queue.js` mapt naar één van vier
foutsoorten; `runQueue` doet de retry-beslissing:

| Foutoorzaak | Detectie | `kind` | Actie |
|---|---|---|---|
| Netwerk down | `fetch` throwt + offline | (gate) | Wacht op `online`-event |
| Timeout 30s | `AbortError` | `transient` | 1× retry na 3s, daarna failed |
| Provider-fout in body | 200 + `error`-veld | `fail` | Geen retry; mark failed |
| Daily kill-switch | 503 + 'Dagbudget…' | `budget` | Stop hele queue, modal |
| IP-rate-limit | 429 | `rate_limited` | Stop hele queue, modal |
| 5xx (overig) | 500/502/503-overig/504 | `transient` | 1× retry na 3s |
| 4xx (overig) | 400/403/404 | `fail` | Geen retry |

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

**Backend** (in `~/Sites/harmsen.nl`):
```
uv run python manage.py test apps.geo --settings=website.test_settings
```
19 tests: demo-fallback, valid-call shape, ongeldig provider, lege prompt,
oversized body, max_tokens-cap, dagbudget-503, IP-rate-limit-429,
kosten-counter (succes + timeout), input-sanitization, config-no-budget-leak,
promptset-shape, book_prompts dvv-skip/met-pagina, `_redact` van extra patronen.

**Frontend** (in `~/proj/geo`):
```
node --test tests/*.test.js
```
39 tests:
- `queue.test.js` (9): parallel-volgorde, retry op 504, max 1 retry,
  4xx-no-retry, 429-stop, daily-budget-stop, partial-failure, offline-pauze,
  `classifyResponse`-mapping.
- `analyze.test.js` (16): mention/citation/positie, hele-woord matching,
  aggregatie, drilldown.
- `report.test.js` (14): markdown-structuur, demo-banner, modus-tabs,
  boek-blok, aanbevelingen.

Daarnaast `tests/parity/`: live-corpus check die 10 echte LLM-antwoorden door
Python én JS heen draait en byte-equality verifieert. Apart aan te roepen,
niet onderdeel van `node --test` (vereist `harmsen.nl`-backend + ~$0.015).

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
