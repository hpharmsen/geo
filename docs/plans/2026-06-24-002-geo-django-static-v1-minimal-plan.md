# Plan 002 — GEO als Django-API op harmsen.nl + GitHub Pages frontend (V1 minimal)

**Type**: refactor (greenfield rewrite met hergebruik van detectie-logica)
**Datum**: 2026-06-24
**Status**: ter bouw
**Vervangt**: `2026-06-24-001-refactor-harmsen-backend-static-frontend-plan.md` (research/review-trail; behouden als referentie)

## Doel

De GEO-meter draaibaar maken vanaf **`geo.harmsen.nl`** (GitHub Pages,
statisch) zonder extra hostingkosten en zonder API-keys in de browser.
De huidige FastAPI-app wordt vervangen door een **dunne Django-API** binnen
het bestaande `harmsen.nl`-Heroku-project, plus een **statische GitHub
Pages frontend** die alle orkestratie in de browser doet.

## Scope-keuze (waarom dit plan korter is dan 001)

Plan 001 specificeerde een volledige publiek-veilige defense (Turnstile +
JWT measurement-tokens + per-token call-budget + resumable measurements).
Na verdieping is gekozen voor de **minimale variant**:

- **$5/dag globale USD kill-switch** = harde financiële bovengrens.
- **Per-IP rate-limit** (5 metingen/IP/uur) = voorkomt triviale single-curl drain.
- **Geen Turnstile, geen JWT, geen per-token-budget, geen resume.**

Rationale: $5/dag is de echte financiële verzekering. Turnstile/JWT verhogen
alleen attacker-effort (bypass kost ~$0.034), niet de bovengrens. Voor een
niet-aangekondigde personal-tool URL is dat overkill. Acceptabele worst-case:
$150/maand als iemand 'm vindt en dagelijks drained.

**Trigger voor V1.1** (voeg Turnstile + JWT toe als):
- URL wordt actief gelinked vanaf je blog/social (publiek bekend), of
- Daily cap fired van een vreemde IP zonder jouw medeweten.

## Uitgangspunten

- **Backend**: nieuwe Django app `apps/geo/` binnen `~/Sites/harmsen.nl`,
  draait mee in bestaande Heroku-deploy. Puur API — geen HTML.
- **Frontend**: GitHub Pages site op `geo.harmsen.nl` (custom CNAME).
  Repo: huidige `~/proj/geo/` herbestemd; FastAPI-Python verwijderd.
  Auto-deploy bij `git push` naar `main`.
- **Cross-origin**: strakke CORS-allowlist op de Django-API. Geen cookies,
  geen Authorization-header — calls zijn ongeauthenticeerd, beschermd door
  IP-rate-limit + USD-cap.
- **Styling overgenomen van harmsen.nl**: zelfde lettertypes (Ubuntu +
  Lobster Two), zelfde basiskleuren (#444 tekst, #44C links, accent
  rgb(166,177,53)).
- **Geen server-side opslag** van metingen. Resultaten leven in de browser
  tot tabblad sluit; user downloadt `rapport.md`.
- **Sync views, geen async**: één endpoint = één LLM-call, dus geen
  concurrency te oogsten. Sync `httpx.Client` + gunicorn `--threads 6`.
- **FastAPI verdwijnt**: detectielogica wordt 1× geport naar JS.
- **theadarchitect.nl**: uitgesteld naar V2.

## Architectuur

### Backend: `apps/geo/` (alleen API, sync views)

Drie endpoints onder `harmsen.nl/api/geo/*`:

```
POST /api/geo/run        body: {provider, prompt, search, max_tokens?}
                         resp: {text, model, sources, usage, cost_usd, error}

POST /api/geo/prompts    body: {categorie, markt, taal, concurrenten,
                                doelgroep, modus, runs}
                         resp: {prompts: [...], book_prompts: [...]}

GET  /api/geo/config     resp: {available_providers, available,
                                max_runs_per_prompt, cors_allowed_origins}
```

**Niet** `available_budget_remaining` exposen — alleen boolean `available`.
Voorkomt dat attacker drain kan timen.

**Sync views** (`def`, niet `async def`), `httpx.Client` met `timeout=28.0`.
Verifieer dat één request binnen de Heroku 30s-router-limiet blijft. Update
Procfile:

```
web: gunicorn website.wsgi --workers 2 --threads 6 --max-requests 1000 --max-requests-jitter 100
release: python manage.py migrate
```

Geeft 2 × 6 = 12 concurrent request-slots. Geen UvicornWorker-migratie nodig.

### Anti-abuse: 2 lagen

**1. Daily USD kill-switch ($5/dag default)** — Django cache, **in DB-cache
backend** (`cache_table` migration), niet LocMem. Cross-worker correct.
Counter-key: `'dailycost:' + datetime.now(timezone.utc).date().isoformat()`.
Charged bij elke `/api/geo/run` op basis van `usage`-respons; bij timeout/
abort/5xx pessimistic estimate (`max_tokens × prijs_per_token`) om
kill-switch-evasion via storms te voorkomen.

Boven plafond: alle `/api/geo/run` returnen 503 met
`{"error": "Dagbudget bereikt, morgen weer"}`. Reset om 00:00 UTC
(~01:00–02:00 NL — documenteer in UI).

**2. Per-IP rate-limit (5 metingen/IP/uur)** — Django cache, LocMem is OK
(per-worker drift acceptabel: worst case 5×workers metingen/uur per IP).
Counter-key: `'iprate:' + sha256(ip + GEO_IP_PEPPER).hexdigest()[:16]`,
TTL 3600s. Pepper als env-var, IPv6 truncate naar `/64` vóór hash.

**Aanvullend** (vrijwel gratis):
- CORS allowlist: `https://geo.harmsen.nl` + `localhost` in DEBUG.
  Env-driven (`GEO_CORS_ORIGINS`) zodat V2 geen deploy vereist.
- `DATA_UPLOAD_MAX_MEMORY_SIZE = 10240` in settings (10KB body cap).
- `max_runs_per_prompt = 10` hard cap in view.
- Server-side `max_tokens = min(req.get('max_tokens', 800), 800)` — frontend
  mag het niet ophogen.
- Input-sanitization op `merknaam`, `categorie`, `markt`, `concurrenten`:
  ```python
  def _clean(s, max_len):
      s = re.sub(r'[\x00-\x1f\x7f]', '', s)
      s = re.sub(r'[^\w\s\-&.,/]+', '', s, flags=re.UNICODE)
      return s[:max_len]
  ```
  Caps: merknaam 60, categorie 80, markt 40, concurrent 60.
- API-keys redactie in errors (`providers._redact`), uitgebreid met
  `AIza[…]{30,}` (Gemini), `postgres://[^\s]+`, `Bearer [A-Za-z0-9_\-\.]+`.

### Frontend: GitHub Pages site op `geo.harmsen.nl`

**Hosting**:
- Repo: `~/proj/geo/` herbestemd. Custom domain via `CNAME`-file.
- Deploy = `git push origin main`. Geen build-step.
- DNS bij registrar: `CNAME geo → <username>.github.io.`
- **Vóór alles**: `dig harmsen.nl CAA` — als restrictief en Let's Encrypt
  niet toegestaan, cert provisioning faalt stilzwijgend.
- "Enforce HTTPS" direct aanvinken — GH wacht netjes als cert nog niet klaar
  is. Mediaan provisioning: 5–15 min.

**Backend-URL**: hardcoded in `config.js` als `https://harmsen.nl/api/geo`.

**Styling van harmsen.nl overnemen** — pluk uit
`~/Sites/harmsen.nl/static_originals/css/main.css`:
- Lettertypes via `@import`: **Ubuntu** (body), **Lobster Two** (display).
- Design tokens als CSS-vars: `--c-text: #444; --c-link: #44C;
  --c-accent: rgb(166,177,53); --font-body: 'Ubuntu', sans-serif;
  --font-display: 'Lobster Two', serif;`.

**XSS-bescherming**:
- LLM-responses **altijd** via `textContent`, nooit `innerHTML`. Als
  Markdown-render nodig: gebruik DOMPurify.
- CSP-meta in `index.html`:
  ```html
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'self'; connect-src 'self' https://harmsen.nl;
                 script-src 'self'; style-src 'self' 'unsafe-inline'
                 fonts.googleapis.com; font-src fonts.gstatic.com">
  ```

Single-page widget die:
1. Toont formulier (merk, categorie, markt, concurrenten, modus, runs).
2. Klik "Meten" → haalt promptset via `POST /api/geo/prompts`.
3. Bouwt takenlijst (modus × provider × prompt × run) en runt **6 parallel**
   `POST /api/geo/run`-calls.
4. Voor elk antwoord: `analyze(text, merknaam, concurrenten, sources)` in JS.
   Update progressie + zichtbare resultaten incrementeel.
5. Diepte-analyses (`book_prompts`): aparte fase, `max_tokens=500–800`
   afhankelijk van model.
6. Aan einde: bouw `rapport.md` in JS, bied download aan, render samenvatting.

### Bestandenoverzicht

**Backend** (in bestaande Django site):
```
~/Sites/harmsen.nl/
  apps/geo/                       NIEUW
    __init__.py
    apps.py                       AppConfig.ready: setup_logging (justlog)
    urls.py                       /api/geo/run, /prompts, /config
    views.py                      sync views: run, prompts, config
    providers.py                  1:1 uit huidige geo/providers.py +
                                  _redact() uitgebreid
    prompts.py                    1:1 uit huidige geo/prompts.py
    book_prompts.py               1:1 uit huidige geo/book_prompts.py
    ratelimit.py                  USD kill-switch + per-IP rate-limit
    tests.py                      flat (host-conventie, niet tests/-package)
```

**Frontend-repo** (`~/proj/geo/` herbestemd → GitHub Pages):
```
~/proj/geo/
  CNAME                           "geo.harmsen.nl"
  index.html                      single-page widget + CSP-meta
  config.js                       BACKEND_URL
  brand.js                        teksten/merknaam
  theme.css                       CSS-vars (harmsen.nl-look)
  analyze.js                      port van Python analyze.py
  report.js                       port van Python report.py
  app.js                          glue: formulier → queue → rapport
  favicon.png
  tests/
    queue.test.js                 node --test, fetch-mock
    analyze.test.js               parity-corpus vs Python
  README.md
  docs/                           bestaande SOP-structuur blijft
```

3 JS-files i.p.v. de eerder voorgestelde 5-file split. Splits pas wanneer
`app.js` 500 regels passeert.

## Frontend robuustheid (vereenvoudigd)

Geen JWT → geen 401-modal → geen pause/resume token-flow → geen
localStorage-resume. Een meting van 50–300 calls duurt ~1–3 min; bij crash
re-run je 'm.

### Retry-matrix (in `app.js`)

| Foutoorzaak | Detectie | Actie |
|---|---|---|
| Netwerk down | `fetch` throwt, `navigator.onLine === false` | Wacht tot online, toon "geen verbinding"-banner. Resume bij `online`-event. |
| Heroku H12 timeout | HTTP 503, of `AbortController` na 30s | **1× retry** na 3s. Daarna `failed`. (Geen 3× — voorkomt 4× LLM-bill voor één resultaat.) |
| Provider-fout in body | 200 met `error`-veld | Geen retry. Mark failed, ga door. |
| Daily kill-switch | 503 met `{"error": "Dagbudget bereikt"}` | Stop hele meting, modal: "Dagelijks AI-budget op, morgen weer". |
| IP-rate-limit | 429 | Modal: "Te veel metingen vanaf jouw IP — wacht een uur". |
| 5xx (overig) | 500, 502 | 1× retry na 3s. Daarna failed. |
| 4xx (overig) | 400, 403, 404 | Geen retry. Mark failed, log naar console. |

**Partial failure is OK.** Rapport vermeldt aantal fouten en **per-provider
denominator** zodat cross-provider compares niet stilzwijgend biased zijn
(als 5 prompts falen alleen voor Perplexity, toont rapport "Perplexity:
45/50 prompts" naast Gemini's "50/50").

### UI-states

- **Per-call indicator** in takenlijst: ⏳ wachtend · ▶ bezig · 🔁 retry · ✓ klaar · ⚠️ mislukt (hover voor reden).
- **Voortgang**: `done / total · slagen / falen · geschat resterend`.
- **Aan einde**: bij `falen > 0`, expand-blok met details per fout.

### Offline-gedrag

- `online`/`offline` events → pauzeer/hervat queue.
- Banner "Geen verbinding — meting gepauzeerd". Geen retries terwijl offline.

## Implementatie-fases

### Fase 1 — Backend skeleton + rate-limit + kill-switch

**Tests eerst** (`apps/geo/tests.py`):
- `test_run_demo_zonder_key`: provider zonder key returnt `is_demo=True`.
- `test_run_geldige_call`: POST returnt ProviderResult-shape.
- `test_run_ongeldig_provider`: 400.
- `test_run_oversized_body`: 413 (via `DATA_UPLOAD_MAX_MEMORY_SIZE`).
- `test_input_sanitization_strips_control_chars`: `categorie='\x00foo'` → `'foo'`.
- `test_max_tokens_capped_server_side`: req `max_tokens=99999` → server cap 800.
- `test_dagbudget_bereikt`: 503 met juiste body.
- `test_ip_rate_limit`: 6e meting binnen uur vanaf zelfde IP → 429.
- `test_kosten_optellen_bij_succes`: counter advanced met `usage.cost`.
- `test_kosten_optellen_bij_timeout`: counter advanced met pessimistic estimate.
- `test_config_geen_budget_remaining`: response bevat `available` (bool), NIET `daily_budget_remaining`.

**Daarna**:
1. `apps/geo/` aanmaken volgens host-conventie.
2. `views.py` met `@csrf_exempt @require_http_methods(["POST"])` op write, `@require_GET` op config.
3. `providers.py` verhuizen, `_redact()` regexes uitbreiden.
4. `ratelimit.py`: USD kill-switch in DB-cache, IP-rate-limit in LocMem.
5. `urls.py` koppelen, dynamisch via `apps/*/urls.py` discovery (al in host).
6. `Procfile` updaten: `--workers 2 --threads 6`.
7. `settings.py`:
   - `INSTALLED_APPS += ['corsheaders']` (na `uv add django-cors-headers`)
   - `CORS_ALLOWED_ORIGINS = [...os.environ['GEO_CORS_ORIGINS'].split(',')]`
   - `CORS_ALLOW_CREDENTIALS = False`, `CORS_MAX_AGE = 86400`
   - `CSRF_TRUSTED_ORIGINS += ['https://geo.harmsen.nl']` (defense-in-depth, ook al heeft elke JSON-view `@csrf_exempt`)
   - `CACHES = {'default': {...DatabaseCache met cache_table...}}`
   - `DATA_UPLOAD_MAX_MEMORY_SIZE = 10240`
8. `python manage.py createcachetable` migration.
9. justlog setup in `apps/geo/apps.py:ready()`.

### Fase 2 — Promptset endpoint

**Tests eerst**:
- `test_prompts_categorie_marketing`: returnt N prompts, geen merknaam erin.
- `test_book_prompts_zonder_landingspagina`: skipt DVV cleanly.

**Daarna**: `prompts.py`, `book_prompts.py` verhuizen, view toevoegen.

### Fase 3 — JS analyse + rapport (port van Python)

**Tests eerst** (`tests/analyze.test.js`, `node --test`):
- `test_mention_detection_eenvoudig`: tekst met merknaam → mention=1.
- `test_mention_detection_negatief`: tekst zonder merknaam → mention=0.
- `test_citation_share_url_match`: bron-URL matcht merk-URL → citation=1.
- `test_rows_aggregatie`: meerdere runs → mention_share/citation_share.

**Daarna**: `analyze.js` en `report.js` schrijven met dezelfde
function-signatures als Python.

**Parity-test (in CI):** voer 10 echte LLM-antwoorden door beide
implementaties en assert byte-equality. Voorkomt drift bij V2-werk.

### Fase 4 — Frontend orkestratie + UI

**Unit-tests** (`tests/queue.test.js`):
- `test_basis_volgorde`: 10 calls, 6 parallel, allen slagen.
- `test_retry_op_504`: mock 504 → 200 → 1 retry, succesvol.
- `test_h12_max_1_retry`: 3× 504 → 1 retry → mark failed (niet 3× retry).
- `test_429_modal`: 429 → modal verschijnt, queue stopt.
- `test_daily_budget_stopt_alles`: 503 met daily-error → cancel queue + modal.
- `test_partial_failure_telt_op`: 50 calls, 5 falen → done=50, ok=45, fail=5.
- `test_offline_pauze`: emit `offline` → pause; `online` → resume.

**Geen** tests voor token-flow, captcha, resume-uit-storage (komen pas in V1.1).

**Daarna**: code opgebouwd in 3 modules (`app.js`, `analyze.js`, `report.js`)
+ `index.html` + `theme.css`. Alles ES-modules, geen bundler.

**Styling-stap**:
- Open `~/Sites/harmsen.nl/static_originals/css/main.css`, kopieer
  `@import`-regels + body/heading/link-kleuren naar `theme.css` als
  CSS-custom-properties.
- Open `geo.harmsen.nl` lokaal naast `harmsen.nl` (twee tabs), vergelijk
  visueel.

### Fase 5 — GitHub Pages, DNS, CORS

**Tests eerst** (`apps/geo/tests.py`):
- `test_cors_geo_harmsen_toegestaan`: preflight van `https://geo.harmsen.nl` returnt 200 met juiste headers (assert headers, niet alleen status).
- `test_cors_andere_origin_geblokkeerd`: `https://evil.example` → geen `Access-Control-Allow-Origin`.

**Daarna**:
1. `dig harmsen.nl CAA` — verify Let's Encrypt mag certs uitgeven. Fix bij registrar als nodig.
2. GH Pages aanzetten: Settings → Pages → Source `main` / root.
3. `CNAME`-file committen met `geo.harmsen.nl`.
4. DNS bij registrar: `CNAME geo → <username>.github.io.`, TTL 300.
5. "Enforce HTTPS" direct aanvinken (GH wacht netjes).
6. Env vars op Heroku:
   ```
   heroku config:set -a heroku-harmsen \
     OPENAI_API_KEY=... \
     PERPLEXITY_API_KEY=... \
     GEMINI_API_KEY=... \
     ANTHROPIC_API_KEY=... \
     GEO_DAILY_USD_CAP=5 \
     GEO_IP_PEPPER=$(python -c "import secrets; print(secrets.token_urlsafe(32))") \
     GEO_CORS_ORIGINS=https://geo.harmsen.nl
   ```
7. **E2E-smoke**: open `geo.harmsen.nl` in incognito, mini-meting
   (1 prompt, 1 run, demo → echt). Network-tab: alle calls naar
   `harmsen.nl/api/geo/*`, geen CORS-fouten.
8. Cert mediaan binnen 15 min; tijdens wachten testen via
   `https://<user>.github.io/geo/` met tijdelijk
   `GEO_CORS_ORIGINS=https://geo.harmsen.nl,https://<user>.github.io`.

### Fase 6 — Cleanup van `~/proj/geo/`

Pas na **stabiele E2E**:
1. Verwijder uit `~/proj/geo/`: `app.py`, `geo/` (Python pakket), `run.py`,
   `Procfile`, `runtime.txt`, `requirements.txt`, `.env.example`,
   `API-keys-hier-invullen.txt`, `START-HIER.md`, `DEPLOY.md`, `AGENTS.md`.
2. Frontend-bestanden verplaatsen van `static/` naar repo-root.
3. `README.md` herschrijven: doel = GH Pages frontend, deploy = `git push`.
4. Tijdelijke `<user>.github.io`-origin uit `GEO_CORS_ORIGINS` weghalen.
5. `docs/solutions/2026-XX-XX-geo-providers-niet-justai.md` schrijven:
   uitleggen waarom `providers.py` niet via `justai` gaat (citation-extraction
   en USD-cost-tracking mist). Documenteert de afwijking van de globale
   "altijd justai"-regel zodat het geen stilzwijgende drift is.
6. `docs/architecture.md` aanpassen naar nieuwe rol.

## Vragen die al beslist zijn

1. **Captcha**: geen. Trigger voor toevoegen = URL publiek gedeeld.
2. **JWT**: geen. Calls zijn ongeauthenticeerd; IP-cap + USD-cap is de defense.
3. **Dagbudget**: $5/dag (env `GEO_DAILY_USD_CAP=5`).
4. **Per-IP rate-limit**: 5 metingen/IP/uur.
5. **USD-counter cache**: DB-cache (cross-worker correct).
   IP-counter: LocMem (per-worker drift acceptabel).
6. **GitHub-account**: hp's eigen account, pagina = `geo.harmsen.nl`.
7. **Sync/async views**: sync (`def`), `httpx.Client`, gunicorn `--threads 6`.
8. **theadarchitect.nl**: V2.

## Risico's

- **30s timeout op book_prompts**: 5% kans diepte-prompt > 30s. Mitigatie:
  `max_tokens=500–800` afhankelijk van model. Haiku/Flash veilig, Sonnet
  niet gebruiken voor book_prompts in V1.
- **Iemand vindt URL en drained $5/dag**: maximale schade $150/maand.
  Acceptabel zolang URL niet publiek gedeeld is. Trigger voor V1.1.
- **CORS misconfiguratie**: test vroeg met echte deploy van zowel GH Pages
  als harmsen.nl, inclusief preflight (`OPTIONS`).
- **GH Pages HTTPS-cert vertraging**: mediaan 5–15 min, p95 4u, max 24u.
  Tijdens setup testen via `<user>.github.io/geo/`.
- **DNS-propagatie**: meestal binnen 10 min, kan tot uren. Test met
  `dig geo.harmsen.nl CNAME`.
- **Sync gunicorn + threading**: ORM-thread-safety. Verifieer met
  `ab -c 6 -n 6` lokaal en op staging.
- **Retry-storm bij Heroku-outage**: na 1 retry stoppen (niet 3) =
  voorkomt 50 tabs × 4 retries hameren.
- **IPv4-hash brute-force**: pepper (`GEO_IP_PEPPER`) is verplicht;
  zonder pepper is hash nutteloos voor GDPR.
- **DNS-hijack registrar**: als attacker je registrar-account compromiseert,
  kan hij `CNAME geo → eigen-server` zetten en daar eigen JS serveren onder
  jouw domein. Mitigatie: 2FA aanzetten op je domain-registrar account
  (geen code, 2 min portal-werk). Doe dit vóór live-gang.

## Definition of done

- `https://geo.harmsen.nl` werkt (HTTPS ✓, custom domain ✓): meting voor
  minstens 1 echt merk, rapport downloadbaar.
- **Visueel familie van harmsen.nl**: zelfde lettertypes en kleuren.
  Side-by-side check toont herkenbaar consistente look.
- Backend log toont per call: provider, kosten, ip_hash, latency.
  Via justlog, DB-viewer beschikbaar.
- **Daily kill-switch test**: zet `GEO_DAILY_USD_CAP=0.01` lokaal → eerste
  call slaagt, tweede 503.
- **IP-rate-limit test**: 6 metingen binnen uur vanaf zelfde IP → 6e 429.
- **Pessimistic-charging test**: forceer H12-timeout → counter advanced.
- **Robuustheid** (Chrome DevTools):
  - Meting van 100 calls voltooit als je halverwege "Offline" zet (30s) en
    weer "Online".
  - Meting voltooit met `Slow 3G` + 10% van responses op 504.
- **CSP-meta** in `index.html`, LLM-responses via `textContent` (geen
  innerHTML).
- FastAPI-code uit `~/proj/geo/` verwijderd; repo is nu zuiver GH Pages
  frontend met `CNAME`, alle tests groen.
- `docs/solutions/2026-XX-XX-geo-providers-niet-justai.md` aangemaakt.

## V1.1 — wanneer toevoegen

**Trigger A**: URL publiek gelinked (blog, twitter, klant-demo).
**Trigger B**: daily cap fired van vreemde IP zonder jouw medeweten.

Bij trigger: voeg toe (in volgorde van impact):
1. Cloudflare Turnstile op `/api/geo/start` + JWT measurement-token.
2. Per-token call-budget (300).
3. Resumable measurements via localStorage.
4. Module-split frontend (`queue.js`, `transport.js`, `storage.js`).

Plan 001 bevat alle implementatie-details voor deze stappen.

## V2 — theadarchitect.nl (open beslissing)

Na V1-launch wordt besloten hoe de tool op `theadarchitect.nl` getoond wordt:
iframe vanuit Webflow, tweede GH Pages repo, of Cloudflare Pages multi-domain.
Werk dat dan sowieso bij V2 hoort:

- Multi-theme: `brand.js` opsplitsen, `theme.css` met CSS-vars per merk.
- CORS-allowlist uitbreiden (env-driven, dus geen Heroku-deploy nodig).
- DoD V2: tweede merk werkt met eigen branding, dezelfde backend, geen
  duplicatie van API-keys.

**Trigger voor V2**: V1 een week stabiel, tool aan klanten van Ad Architect
willen tonen.
