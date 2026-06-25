# Plan 001 — GEO als Django-API op harmsen.nl + GitHub Pages frontend

**Type**: refactor (greenfield rewrite met hergebruik van detectie-logica)
**Datum**: 2026-06-24
**Status**: ter review — **verdiept 2026-06-24** met 13 parallelle research/review-agents

---

## Enhancement Summary (2026-06-24)

**Onderzoek samengevat:** 8 research-agents (Django async, Turnstile, browser queue, GH Pages TLS, PyJWT, CORS, justai, Heroku H12), 4 review-agents (simpliciteit, security, correctness, architectuur), 1 skill-toepassing (Django) + justlog-integratie.

### Kritieke bevindingen (must-fix vóór bouw)

1. **Retry-budget × tasks > token-budget — wiskunde klopt niet.** 300 taken × (1 + 3 retries) = 1200 backend-calls, maar de per-token cap is 300. Een meting met veel H12's exhauseert de token halverwege. Fix: of cap verhogen naar ~1200, of `runs × providers × prompts` zo laag dat worst-case retries in 300 passen.
2. **Per-worker kill-switch is omzeilbaar via refresh.** Q&A #4 ("per worker OK") werkt voor het call-budget maar **NIET voor de daily kill-switch**: één 503 stopt de meting, refresh hit andere worker, meting loopt door. Effectieve daily-spend = N × cap. Fix: alleen voor de USD-counter shared store (DB-cache `cache_table`, ~10 regels), accepteer overige per-worker tellers.
3. **`async def` views op sync gunicorn levert geen winst op.** Elke request doet exact één outbound LLM-call (geen fan-out), dus er valt geen concurrency te oogsten. Conclusie: schrijf **sync views met `httpx.Client`** + tune gunicorn `--threads 6` (2 workers × 6 threads = 12 concurrent slots). Geen UvicornWorker-migratie nodig; bestaande 22 apps van harmsen.nl blijven onveranderd. Bevestigt risico in plan-regel 500.
4. **H12-retry kan dubbel betalen** + **kosten op timeout tellen niet mee** = de daily kill-switch is te bypassen door storms van timeouts. Fix: cap H12-retry op 1; tel pessimistic-estimate (op basis van `max_tokens`) bij elke timeout/abort mee in de USD-counter.
5. **Architectuur-keuze: tweede Heroku-app overwegen.** Een captcha-gated, paid-API endpoint in dezelfde dyno als 22 hobby-apps koppelt failure modes (runaway `httpx` of memory-leak in `apps/geo` blokkeert blog/playground). Een tweede Heroku-app op dezelfde codebase (~$0–7/maand) isoleert het. Niet noodzakelijk voor V1 als sync-views-route gekozen wordt, maar het overwegen waard.
6. **Inconsistentie met user-conventies.** Globale CLAUDE.md zegt "altijd `justai`". Host harmsen.nl gebruikt `justai~=5.3.0`. Plan port custom `providers.py`. Onderzoek: `justai` mist citation-extraction en USD-cost-per-search, dus de custom layer is een legitieme uitzondering — maar **documenteer dat in een ADR / `docs/solutions/`** zodat de afwijking expliciet is. Plan respecteert ook niet de host-conventie van flat `tests.py` en de globale `@csrf_exempt`-praktijk op JSON-views.

### Belangrijke security-bevindingen

- **Bypass-economie:** Turnstile-solve kost $0.001–0.003. Dagcap drainen = $0.034. De drie-laagse defense collapse tot "captcha solve". **Voeg toe:** per-IP daily measurement-cap (3/IP/24h) als 4e laag. Zonder dit is de tool een denial-of-wallet target.
- **`/api/geo/config` exposeert `daily_budget_remaining`** → attacker timed drain. Vervangen door `available: bool`.
- **XSS-keten:** prompt-injection in `categorie`/`markt`/`concurrenten` + LLM kan `<script>` returnen + frontend mogelijk `innerHTML` → token in localStorage gestolen. Mitigatie: server-side input-sanitization (regex + lengte-cap) + alleen `textContent` in DOM + DOMPurify als Markdown nodig is + CSP `<meta>` in `index.html`.
- **JWT-secret + replay:** bind `jti` aan hash van `(ip, user-agent)` om token-diefstal nutteloos te maken. Atomische `cache.incr()` met fail-closed.
- **IP-hash heeft pepper nodig** (anders brute-force trivial); IPv6 truncate naar /64 vóór hash.
- **Turnstile-validatie moet `hostname` veld checken** tegen `geo.harmsen.nl` (anders werkt token van willekeurige site).

### Simpliciteits-tegenwicht

Een onafhankelijke reviewer concludeerde dat het plan **~2.5× groter** is dan strikt nodig voor één gebruiker. Voorstel V1-minimum: daily USD kill-switch + per-IP rate-limit, géén Turnstile/JWT/resume/module-split. **Beslismoment voor jou:** ga je voor "publiek-veilig V1" (zoals nu) of "personal-tool V1 + triggers voor V1.1"? Beide zijn verdedigbaar; sectie "V1 scope-beslissing" hieronder zet ze naast elkaar. De security/correctness-fixes hierboven zijn nodig **als** je voor publiek-veilig V1 kiest.

### V1 scope-beslissing (nieuw, vóór bouw)

| Variant | Wat erin zit | Tijd | Wanneer kiezen |
|---|---|---|---|
| **A. Minimal V1** (simpliciteits-reviewer) | Sync views, daily USD kill-switch, per-IP rate-limit, één `app.js`, ~10 tests, geen JWT, geen Turnstile, geen resume | ~1–2 dagen | Eerste maand alleen jij + 1–2 testers; voeg defenses toe op het moment dat de cap *daadwerkelijk* fired van een vreemde IP |
| **B. Publiek-veilig V1** (oorspronkelijke plan) | Alles in dit plan + fixes hierboven | ~5–7 dagen | Je gaat de URL actief delen / linken vanaf harmsen.nl of social, dus abuse-risico is real op dag 1 |
| **C. Tussenweg (aanbevolen)** | Sync views, daily USD kill-switch (in DB-cache), per-IP rate-limit, JSON-input sanitization, CSP-meta, één `app.js` + `analyze.js` + `report.js`, ~15 tests. **Géén** Turnstile/JWT/resume tot er signaal is | ~2–3 dagen | Default: redelijke veiligheid zonder over-engineering |

De rest van dit plan beschrijft variant B. Lees de inline "Research insights" blokken om B in te perken of richting C te bewegen.

---

## Doel

De GEO-meter draaibaar maken vanaf **`geo.harmsen.nl`** (GitHub Pages,
statisch) én vanaf een pagina op `theadarchitect.nl`, zonder extra
hostingkosten en zonder API-keys in de browser. De huidige FastAPI-app wordt
vervangen door een **dunne Django-API** binnen het bestaande `harmsen.nl`-
Heroku-project, plus een **statische GitHub Pages frontend** die alle
orkestratie en aggregatie in de browser doet.

## Uitgangspunten (uit de brainstorm)

- **Backend**: nieuwe Django app `apps/geo/` binnen `~/Sites/harmsen.nl`,
  draait mee in de bestaande Heroku-deploy van harmsen.nl. **Puur API** —
  geen HTML, geen templates.
- **Frontend**: GitHub Pages site op `geo.harmsen.nl` (custom domain via
  CNAME). Repo: het huidige `~/proj/geo/` wordt hiervoor herbestemd — de
  FastAPI-Python wordt verwijderd, alleen statische HTML/CSS/JS blijft over.
  Auto-deploy bij `git push` naar `main` (geen build-step).
- **theadarchitect.nl**: **uitgesteld naar V2**. Aanpak (iframe, tweede GH
  Pages repo, of Cloudflare Pages met multi-domain) wordt bij V2-kickoff
  beslist. V1 bouwt alleen voor `geo.harmsen.nl`. Zie sectie "V2" onderaan.
- **Cross-origin**: frontend (`geo.harmsen.nl`) en backend (`harmsen.nl`)
  zijn verschillende origins. Strakke CORS-allowlist op de Django-API,
  JWT in `Authorization` header (geen cookies — die crossen niet).
- **Styling overgenomen van harmsen.nl**: zelfde lettertypes (Ubuntu +
  Lobster Two), zelfde basiskleuren (#444 tekst, #44C links, accent
  rgb(166,177,53)), zodat `geo.harmsen.nl` aanvoelt als een onderdeel van
  de hoofdsite — niet als een aparte tool.
- **Geen server-side opslag** van metingen. Resultaten leven in de browser
  tot tabblad sluit; gebruiker kan `rapport.md` downloaden.
- **Toegang**: publiek met strakke rate-limit + dagbudget-plafond + captcha.
- **30s Heroku-limiet**: één HTTP-call = één LLM-call. Frontend orkestreert
  parallel (browser doet ~6 simultaan).
- **FastAPI verdwijnt**: `geo/analyze.py` en `geo/report.py` worden 1× in JS
  herschreven; `geo/providers.py`, `prompts.py`, `book_prompts.py` verhuizen
  naar de Django-app. Daarna mag de Python-code uit `~/proj/geo/` weg.

## Architectuur

### Backend: `apps/geo/` (alleen API, geen HTML)

Stateless endpoints onder `harmsen.nl/api/geo/*`:

```
POST /api/geo/start      body: {turnstile_token}
                         resp: {measurement_token, expires_at, call_budget}

POST /api/geo/run        body: {provider, prompt, search, max_tokens?}
                         hdr:  Authorization: Bearer <measurement_token>
                         resp: {text, model, sources, usage, searches, error}

POST /api/geo/prompts    body: {categorie, markt, taal, concurrenten,
                                doelgroep, modus, runs}
                         hdr:  Authorization: Bearer <measurement_token>
                         resp: {prompts: [...], book_prompts: [...]}

GET  /api/geo/config     resp: {available_providers, daily_budget_remaining,
                                pricing, max_runs_per_prompt, captcha_site_key,
                                cors_allowed_origins}
```

**Geen** HTML-route. **Geen** `JOBS`-dict, **geen** background tasks,
**geen** lange requests. Elke `/api/geo/run` doet exact één LLM-call met
`httpx.AsyncClient` (Django ondersteunt async views vanaf 4.1) en returnt
binnen 5–25s.

Code uit `geo/providers.py` wordt 1-op-1 verhuisd (de provider-functies zijn
al async en pas-baar). `geo/prompts.py` en `geo/book_prompts.py` blijven
server-side: de frontend vraagt een promptset op via `/api/geo/prompts`,
puur Python (geen LLM), klaar in <100ms.

#### Research insights — backend (Django, async, justai)

**Sync views > async views op deze stack:**
- Host harmsen.nl draait `gunicorn website.wsgi` (sync WSGI). `async def` views worden dan binnen een per-request event-loop uitgevoerd; je oogst alleen winst als één request meerdere awaits parallel doet (`asyncio.gather`).
- Architectuur: één `/api/geo/run` = exact één LLM-call. Geen fan-out, dus geen voordeel van async.
- **Aanbeveling:** schrijf de views als `def` (sync), gebruik `httpx.Client` (niet `AsyncClient`), tune gunicorn:
  ```
  web: gunicorn website.wsgi --workers 2 --threads 6 --max-requests 1000 --max-requests-jitter 100
  ```
  Resultaat: 12 concurrent request-slots (2 × 6), geen UvicornWorker-migratie, geen risico voor de 22 bestaande apps. Niet `Procfile` wijzigen vereist een test op staging.
- **Alleen ASGI-route nodig als** je later streaming (SSE) van LLM-output naar browser doet — zie sectie "Heroku 30s" verderop.

**Hergebruik bestaande `justai` library — overwogen, afgewezen:**
- Globale CLAUDE.md zegt "altijd justai". Host heeft het al (`justai~=5.3.0`).
- `justai` biedt cross-provider tekst-prompting, async, token-telling, tool-use.
- **Mist:** citation-extraction (sources/URLs), USD-cost-berekening per provider, search-mode toggle, demo-fallback — exact wat GEO uniek maakt.
- **Verdict:** custom `providers.py` is een legitieme uitzondering. Documenteer dit in `docs/solutions/2026-XX-XX-geo-providers-niet-justai.md` zodat de afwijking expliciet is en niet stilzwijgend drift.

**Host-conventies om te volgen** (`/Users/hp/Sites/harmsen.nl/`):
- JSON-views krijgen `@csrf_exempt` + `@require_http_methods(["POST"])`. Bestaande apps (`apps/playground/playground.py:23`) doen het zo.
- Tests: host gebruikt **flat `tests.py`**, niet `tests/`-package. Plan-layout (`tests/test_*.py`) breekt deze conventie — kies één.
- Settings: env-vars **niet** in `os.environ` lezen vanuit views; eerst in `website/settings.py` als constanten parsen, dan `from django.conf import settings`.
- **Geen `CACHES` block** in huidige `settings.py` → default LocMemCache, per-worker, lost bij elke deploy. Voor de daily-USD-counter: voeg DB-cache toe (`cache_table` migration, ~10 regels).
- `CSRF_TRUSTED_ORIGINS`: bestaande hardcoded lijst aanvullen met `https://geo.harmsen.nl` (defense-in-depth, ook al exempt JSON-views CSRF).

**Failure-isolation overweging (architectuur-reviewer):**
> Een paid-API, captcha-gated, public-facing endpoint inbouwen in een Django site met 22 hobby-apps koppelt failure-modes: een runaway `httpx`-call of memory-leak in `apps/geo` evict blog/playground-requests. Overweeg **tweede Heroku-app** (`heroku-geo-api`) op dezelfde codebase met `DJANGO_SETTINGS_MODULE=website.settings_geo` (minimal `INSTALLED_APPS`). Kost ~$0–7/maand eco-dyno. **Niet noodzakelijk als** je sync-views + `--threads` doet (dyno-resources zijn dan duidelijk gequota'd), wel een vangnet bij groei. Bewaar als optie in `docs/architecture.md`, niet nu doen.

### Anti-abuse (kritisch — "publiek" mag niet betekenen "openbare creditcard")

Drie lagen, defensief gestapeld:

1. **Cloudflare Turnstile captcha** vóór elke meting. Frontend toont widget,
   user lost 'm op, frontend POST't de token naar `/api/geo/start` →
   backend valideert bij Cloudflare en geeft een **measurement-token** terug
   (JWT, geldig 30 min, max N calls). Alle `/api/geo/run`-calls moeten dat
   token meesturen.
2. **Per-token call-budget**: een token mag bijv. max 300 LLM-calls verbruiken
   (dekt ruim de grootste meting). Backend telt af in Django cache.
3. **Daily kill-switch per provider**: backend trackt totale USD-besteding van
   vandaag in Django cache. Boven plafond (env var, default $5/dag) →
   alle `/api/geo/run` returnen `{error: "Dagbudget bereikt"}` tot middernacht.

Aanvullend, goedkoop:
- CORS allowlist op `https://geo.harmsen.nl` en `http://localhost:*` voor
  dev (defense in depth; vervalsbaar maar weert browsers).
  theadarchitect.nl-origins worden in V2 toegevoegd.
- Max body-size (10KB) en max `runs_per_prompt` (10) hard in de view.
- API-keys redactie in foutmeldingen (al geregeld in `providers._redact`).

#### Research insights — Anti-abuse (security & correctness)

**Realistische bypass-economie** (security-reviewer):
- Turnstile-solve via paid services: $0.001–0.003 per token.
- Dagcap $5 / kost per meting ~$0.30 = ~17 metingen om de dag te drainen.
- Attacker-kosten: 17 × $0.002 = **$0.034 per dag** om je $5 budget te vernietigen. Praktisch ~$1/maand om de tool permanent onbruikbaar te maken.
- **De drie lagen stacken niet**: layer 2 en 3 zijn limieten, geen deterrents. Effectieve verdediging collapse tot "captcha solve".

**4e laag toevoegen — verplicht voor publiek-veilig V1:**
1. **Per-IP daily measurement-cap** (bijv. 3 metingen/IP/24h) — Django cache, key = `'iprate:' + sha256(ip + GEO_IP_PEPPER)[:16]`.
2. **`/api/geo/config` mag NIET `daily_budget_remaining` exposen** — attacker poll dit om drain te timen. Vervang door `available: bool`.
3. **Optioneel proof-of-work** op `/api/geo/start` (hashcash ~1s CPU) — verhoogt bypass-cost ~100× zonder gebruikers te hinderen.

**Per-worker kill-switch is gevaarlijk — override Q&A #4:**
- Q&A #4 zegt "per worker OK". Correct voor het per-token call-budget (foutmarge ≤ N×).
- **Fout voor de daily kill-switch**: 503 van worker A → frontend abort meting (regel 244). User refresh → load-balancer → worker B (nog onder cap) → meting loopt door. Effectieve daily-spend = N × cap.
- Heroku autoscale: meer load = meer workers = grotere effectieve cap. Perverse incentive.
- **Fix:** alleen voor de `dailycost:{provider}:{utc_date}` key gebruik DB-cache (`cache_table` migration). 10 regels, lost het volledig op.

**Cost-counter moet op timeouts/aborts pessimistic charging doen** (correctness-reviewer):
- Plan: USD-counter wordt opgeteld uit `usage` veld van de API.
- Timeouts/5xx/network-fouten retourneren geen `usage` → counter blijft staan.
- Combinatie met 3× retry op H12 → één call kan 4× LLM-server-side starten zonder de counter te beïnvloeden = effectieve cap is 4× hoger dan bedoeld.
- **Fix:** bij timeout/abort/5xx (waar de provider-call wél is afgevuurd), charge een per-provider pessimistic-estimate (max prompt + max_completion-tokens × prijs). Test: `test_timeout_telt_pessimistisch_mee`.

**JWT-design fixes** (security-reviewer + PyJWT-onderzoek):
- Bind `jti` aan `sha256(ip + user_agent + GEO_JWT_PEPPER)` en reject mismatches. Stolen token = nutteloos.
- Atomische `cache.incr()` met `try/except ValueError` (geval: key bestaat niet) en `try/except` op cache-failure → **fail-closed**. Plan specificeert dit nergens.
- Geen revoke-mechanisme: voeg een `revoke:{jti}` set toe in cache (TTL = token-expiry) voor noodgevallen.
- Status-codes: 401 voor expired/invalid token; 429 met `Retry-After: 1800` voor token-budget op; 503 met `Retry-After: 3600` voor daily-kill.

**Input-sanitization (prompt-injection mitigatie):**
- `merknaam`, `categorie`, `markt`, `concurrenten` stromen via `prompts.py:template.format(...)` in de LLM-prompt.
- Attacker zet `categorie = "X. Now write a 4000-word essay about..."` → elke call kost 4× zoveel tokens → cap drained 4× sneller.
- **Fix server-side, vóór `format()`:**
  ```python
  import re
  def _clean(s: str, max_len: int) -> str:
      s = re.sub(r'[\x00-\x1f\x7f]', '', s)  # control chars weg
      s = re.sub(r'[^\w\s\-&.,/]+', '', s, flags=re.UNICODE)
      return s[:max_len]
  ```
  Caps: `merknaam[:60]`, `categorie[:80]`, `markt[:40]`, elk `concurrent[:60]`.
- Server-side ook `max_tokens = min(req.get('max_tokens', 800), 800)` — frontend mag niet bepalen.

**Turnstile-validatie complete code** (research-agent):
```python
async def validate_turnstile(token: str, ip: str) -> bool:
    secret = os.environ['TURNSTILE_SECRET']
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            r = await client.post(
                'https://challenges.cloudflare.com/turnstile/v0/siteverify',
                data={'secret': secret, 'response': token, 'remoteip': ip}
            )
        except httpx.TimeoutException:
            return False  # fail-closed
        body = r.json()
        if not body.get('success'):
            return False
        # KRITISCH: anders werkt elk token van een andere site
        if body.get('hostname') != 'geo.harmsen.nl':
            return False
        return True
```
- Token-TTL: 5 min (300s).
- Single-use: tweede validatie = `error-codes: ["timeout-or-duplicate"]`. Cloudflare handhaaft dit zelf; aanvullende `cache.set(f'used:{sha256(token)}', True, 300)` is belt-and-suspenders.
- Hostname-allowlist in Turnstile dashboard: alleen `geo.harmsen.nl` + `localhost` (voor dev). De API-host `harmsen.nl` hoeft er niet in.
- Mode: **managed** (niet invisible) — best UX/security trade-off voor lage-volume publieke tool.

**Error-redaction uitbreiden** — huidige `_redact` mist:
- `r"AIza[0-9A-Za-z_\-]{30,}"` — Google API keys.
- `r"postgres://[^\s]+"` — DB URLs (uit Heroku tracebacks).
- `r"Bearer [A-Za-z0-9_\-\.]+"` — generic bearer tokens.
- Asserteer `DEBUG=False` in productie via een startup-check; Django's default 500-pagina is veilig **alleen** als DEBUG off.

**IP-hashing GDPR-veilig:**
- `sha256(ip)` zonder pepper = brute-forceable (4B IPv4 in seconden).
- Gebruik `GEO_IP_PEPPER` env-var (32 bytes urlsafe), roteer maandelijks.
- IPv6: truncate naar `/64` vóór hash. Log-retentie: max 30 dagen documenteren.

**Request-size limit hoort in settings, niet view:**
- Plan zegt "max 10KB in de view" — maar Heroku router accepteert tot 30MB voordat view runt.
- Zet `DATA_UPLOAD_MAX_MEMORY_SIZE = 10240` in `settings.py`. Werkt globaal, voor alle views.

### Frontend: GitHub Pages site op `geo.harmsen.nl`

**Hosting**:
- Repo: het huidige `~/proj/geo/` wordt herbestemd (zie cleanup, Fase 7).
- GitHub Pages instellen: Settings → Pages → Source: `main` branch, root
  folder. Geen build-step (geen Jekyll, geen Actions nodig).
- Custom domain: `CNAME`-bestand in repo-root met `geo.harmsen.nl`. DNS bij
  je registrar: `CNAME geo → <username>.github.io.`. GitHub provisioneert
  Let's Encrypt automatisch (kan tot 24u duren bij eerste setup).
- Deploy = `git push origin main`. Zichtbaar na ~30s.

**Backend-URL**: hardcoded in `config.js` als `https://harmsen.nl/api/geo`.
Geen relatieve paden — frontend en backend zijn verschillende origins.

**Branding**: V1 heeft één thema (harmsen). De code is wel zo opgezet dat
meerdere thema's later toegevoegd kunnen worden (CSS-variabelen in
`theme.css`, teksten in `brand.js`). Theme-selectie via query-parameter
(`?theme=...`) komt in V2.

**Styling van harmsen.nl overnemen** — concrete aanpak:

Hoofdsite gebruikt (uit `~/Sites/harmsen.nl/static_originals/css/main.css`):
- Lettertypes: **Ubuntu** (body, 400/700), **Lobster Two** (display).
- Tekstkleur body: `#444`. Headings: `black`.
- Links: `#44C`, geen underline tot hover.
- Accent: `rgb(166, 177, 53)` (groen, in menu-elementen).

Implementatie in de GH Pages frontend (`theme.css`):
1. **Externe fonts** via `@import` (zelfde Google Fonts-regels overnemen).
2. **Design tokens** als CSS-variabelen aan `:root` — bijv.
   `--c-text: #444; --c-link: #44C; --c-accent: rgb(166,177,53);
   --font-body: 'Ubuntu', sans-serif; --font-display: 'Lobster Two',
   serif;`. Maakt het V2-multi-theme-werk later triviaal.
3. **Tool-specifieke layout** (formulier, voortgangsbalk, modals) bouwt
   bovenop deze tokens.

**Geen** rechtstreekse `<link>` naar `https://harmsen.nl/static/...` —
GH Pages-deploy moet onafhankelijk werken als de hoofdsite even down is, en
we willen geen pijnlijke 30s-blokkade op de eerste pageview bij koude
Heroku-dyno. Liever de relevante stijlen kopiëren naar de frontend-repo en
expliciet syncen wanneer harmsen.nl visueel verandert.

**Risico van drift**: als de hoofdsite later van huisstijl verandert, blijft
`geo.harmsen.nl` op de oude stijl tot we 'm bewust bijwerken. Acceptabel —
en met de tokens-aanpak is bijwerken een paar regels.

#### Research insights — GitHub Pages + custom subdomain

**Cert-provisioning is meestal snel** (research-agent):
- Mediaan 5–15 min, p95 2–4u. De "24u" in het plan is de harde upper-bound van GH, niet typisch.
- "Enforce HTTPS" toggle: GH wacht netjes als je 'm te vroeg aanzet — geen risico, gewoon direct aanvinken.
- Tijdens provisioning: fallback `https://<username>.github.io/<repo>/` blijft werken. Test je CORS-flow daar tegen `harmsen.nl/api/geo/*` — voeg die origin tijdelijk aan `CORS_ALLOWED_ORIGINS` toe voor de smoke-test (en weer weg na DNS-cut).

**CAA-record check vóór alles** (kritisch, vaak vergeten):
```bash
dig harmsen.nl CAA
```
- Als `harmsen.nl` een restrictieve CAA heeft die `letsencrypt.org` niet toestaat: subdomain-cert faalt **stilzwijgend**. GH UI toont geen error.
- Heroku gebruikt typically AWS-certs (geen CAA-vereiste voor de apex), dus dit kan onverwacht een nieuwe constraint zijn.
- Fix bij restrictieve CAA: voeg `harmsen.nl CAA 0 issue "letsencrypt.org"` toe bij registrar.

**Geen conflict met Heroku-apex** — subdomain CNAME en apex A/CNAME zijn onafhankelijke DNS-tak. Veilig.

**Deploy zonder build step:** push naar `main` is correct. Geen GH Action nodig. Static-only = nul build-minutes verbruikt.

**Aanbevolen volgorde** (downtime-risico minimaal):
1. `dig harmsen.nl CAA` checken vóór alles.
2. CNAME-file committen.
3. DNS bij registrar instellen, TTL 300 (tijdelijk laag voor snelle iteratie).
4. GH Pages aanzetten + "Enforce HTTPS" direct.
5. Refresh GH Pages settings elke 30s; verwacht groen vinkje binnen 15 min.
6. Smoke-test via incognito + `https://<user>.github.io/geo/` fallback parallel.
7. Pas na stabiel: TTL terug naar 3600.

Single-page widget die:
1. Toont een Turnstile-captcha + formulier (merk, categorie, markt,
   concurrenten, modus, runs).
2. Klikt "Meten" → POST `https://harmsen.nl/api/geo/start` met captcha-token
   → krijgt measurement-token (JWT).
3. Haalt promptset via `POST /api/geo/prompts` (met `Authorization` header).
4. Bouwt takenlijst (modus × provider × prompt × run) en runt **maxParallel**
   `/api/geo/run`-calls tegelijk (default 6). Per call wordt het JWT
   meegestuurd in de `Authorization` header.
5. Voor elk antwoord: voer `analyze(text, merknaam, concurrenten, sources)`
   uit in JS (port van `geo/analyze.py`). Update progressie + zichtbaar
   resultaat incrementeel.
6. Voor diepte-analyses (`book_prompts`): aparte fase, kortere `max_tokens`
   om binnen 30s te blijven, één per provider-call.
7. Aan einde: bouw `rapport.md` in JS (port van `geo/report.py`), bied
   `download` aan, render samenvatting op pagina.

### theadarchitect.nl: uitgesteld naar V2

V1 levert alleen `geo.harmsen.nl`. De aanpak voor theadarchitect.nl wordt
apart beslist zodra V1 stabiel draait — zie sectie "V2" onderaan dit plan.

### Bestandenoverzicht (geprojecteerd)

**Backend** (in bestaande Django site):
```
~/Sites/harmsen.nl/
  apps/geo/                                  NIEUW (alleen API)
    __init__.py
    urls.py                                  /api/geo/* (geen HTML)
    views.py                                 async views: start, run, prompts, config
    providers.py                             1:1 uit huidige geo/providers.py
    prompts.py                               1:1 uit huidige geo/prompts.py
    book_prompts.py                          1:1 uit huidige geo/book_prompts.py
    captcha.py                               Cloudflare Turnstile validatie
    ratelimit.py                             token-budget + kill-switch
    tests/
      test_run_endpoint.py
      test_ratelimit.py
      test_captcha.py
      test_prompts.py
      test_cors.py
```

**Frontend-repo** (`~/proj/geo/` herbestemd → GitHub Pages):
```
~/proj/geo/
  CNAME                                      "geo.harmsen.nl"
  index.html                                 single-page widget
  config.js                                  BACKEND_URL = "https://harmsen.nl/api/geo"
  brand.js                                   teksten/merknaam (harmsen)
  theme.css                                  CSS-variabelen + harmsen.nl-look
                                             (Ubuntu/Lobster Two, kleuren-tokens)
  queue.js                                   parallel-queue + retry-state-machine
  transport.js                               fetch-wrapper + AbortController
  storage.js                                 localStorage read/write/throttle
  analyze.js                                 port van Python analyze.py
  report.js                                  port van Python report.py
  ui.js                                      DOM-binding (progressie, modals)
  app.js                                     glue: formulier → queue → rapport
  favicon.png
  tests/
    queue.test.js                            node --test
    analyze.test.js
    transport.test.js
  README.md                                  uitleg + deploy-link (GH Pages)
  docs/                                      bestaande SOP-structuur blijft
```

Geen `package.json` nodig (geen build, geen npm). Tests via `node --test`
gebruiken alleen built-in modules.

## Frontend robuustheid

Een meting bestaat uit 50–300 losse calls. Eén netwerkhickup of Heroku-timeout
mag de meting niet om zeep helpen. Uitgangspunten:

- **Elke call is idempotent.** Backend doet één LLM-call, returnt resultaat,
  bewaart niks. Herhalen is veilig.
- **Retry-budget per call**, niet per meting. Een falende call sleept de rest
  niet mee.
- **Partial failure is OK.** Als 5 van 200 calls definitief falen, gaat de
  meting door met de 195 die wel slaagden. Het rapport vermeldt het aantal
  fouten en sluit ze uit van de aggregatie.
- **Gebruiker weet altijd wat er gebeurt.** Geen "spinner zonder uitleg".
- **Hervatbaar.** Per-meting state in `localStorage`; refresh of crash kost
  geen werk.

### Retry-matrix (in `app.js`)

| Foutoorzaak | Hoe te detecteren | Actie |
|---|---|---|
| Netwerk down / DNS fail | `fetch` throwt, `navigator.onLine === false` | Wacht tot online, dan retry. Onbeperkt (gebruiker bepaalt). Toon "geen verbinding". |
| Heroku H12 timeout | HTTP 503, of frontend `AbortController` na 35s | Retry 3x met exp backoff 2s → 4s → 8s. Daarna call als "failed" markeren. |
| Provider-timeout binnen backend | 200 met `error: "..."` veld | Geen retry (backend deed er al 6 binnen `_post_retry`). Markeer als failed, ga door. |
| Rate-limit | HTTP 429 | Lees `Retry-After` header (default 10s), wacht, retry tot 3x. Toon "even rustig aan met {provider}". |
| Token verlopen | HTTP 401 | **Pauzeer queue**, toon captcha-modal, vervang token, hervat queue waar gestopt. |
| Token-budget op | HTTP 429 met `code: "token_budget"` | **Stop hele meting**, modal: "Maximum aantal vragen per meting bereikt". |
| Daily kill-switch | HTTP 503 met `code: "daily_budget"` | **Stop hele meting**, modal: "Dagelijks AI-budget op, morgen weer beschikbaar". |
| 5xx zonder retry-after | HTTP 500, 502 | Retry 1x na 3s. Daarna failed. |
| 4xx (behalve 401/408/429) | HTTP 400, 403, 404 | Geen retry. Log naar console, markeer call als failed met reden. |

### UI-states

- **Per-call indicator** in de takenlijst: ⏳ wachtend · ▶ bezig · 🔁 retry N/3
  · ✓ klaar · ⚠️ mislukt (hover voor reden).
- **Toast / notification-bar** voor system-wide events: "Verbinding kwijt —
  pauzeer", "Heroku traag, we proberen opnieuw", "Captcha verlopen".
- **Modal blokkade** voor non-recoverable: budget op, token verlopen
  (met opnieuw-captcha-knop), backend onbereikbaar.
- **Voortgang**: `done / total · slagen / falen · geschatte resterend`.
- **Aan einde**: als `falen > 0`, expand-blok met "details per fout"
  (gegroepeerd op provider/foutsoort).

### Resume via localStorage

```
localStorage.geo_measurement = {
  meting_id: "...",
  token: "...",            // JWT van captcha
  token_expires_at: 1234,
  config: { merknaam, categorie, ... },
  taken: [{provider, prompt, run, status, result?, error?}],
  begonnen_op: 1234
}
```

- Bij pagina-load: detecteer aanwezigheid → "Vorige meting niet klaar.
  [Hervatten] [Weggooien]".
- Tijdens meting: state wegschrijven na elke geslaagde of definitief-mislukte
  call (throttled, max 1× per seconde).
- Bij captcha-expiry: token vervangen, queue hervatten.

### Offline-gedrag

- `window.addEventListener('online'/'offline')` → pauzeer/hervat queue.
- Banner bovenaan: "Geen verbinding — meting gepauzeerd".
- Geen retries terwijl offline (verspilt geen pogingen).

#### Research insights — Frontend robuustheid (correctness + queue-patterns)

**Retry-budget × tasks > token-budget — wiskunde klopt niet** (correctness-reviewer):
- 300 taken × (1 + 3 retries) = **1200 backend-calls** worst-case.
- Per-token call-budget = 300.
- Een meting met veel H12's exhauseert de token halverwege en geeft modal "token-budget op → stop meting".
- **Drie opties:**
  - (a) Token-budget verhogen naar ~1200. Simpelste fix.
  - (b) `runs × providers × prompts` caps zodanig dat worst-case retries in 300 passen (max ~75 taken).
  - (c) Alleen succesvolle calls aftrekken (breekt abuse-rationale van de cap).
- **Aanbeveling:** (a) + test `test_budget_dekt_max_meting_met_retries`.

**H12-retry kan dubbel betalen** (correctness-reviewer):
- "Elke call is idempotent" verwijst naar afwezigheid van state-mutatie, **niet** afwezigheid van kosten.
- LLM-provider kan na de 30s Heroku-cutoff alsnog completing → counter telt niets, retry start opnieuw → 2× betaald.
- 3× retry op H12 = 4 paid LLM-calls voor 1 logische resultaat.
- **Fix:** cap H12/timeout-retries op 1 (niet 3). Charge pessimistic-estimate (zie security-insights).

**localStorage-throttle verliest in-flight state** (correctness-reviewer):
- Plan: state geschreven na elke geslaagde/mislukte call, throttled max 1×/s.
- Gat: calls flipped van `pending → in-flight` hebben geen aparte status. Bij refresh resume gaat alles wat geen `done` of `failed` is opnieuw → re-paid LLM-calls voor wat mogelijk al klaar was.
- Throttle van 1s kan tot ~1s aan completed-results verliezen.
- **Fix:**
  - Voeg expliciete `inflight` status toe.
  - Schrijf status-transities **synchroon** (niet throttled); throttle alleen UI-updates.
  - Op resume: behandel `inflight` als `unknown` → vraag user-confirmatie vóór re-issue, of dedupe server-side via idempotency-key per `(token, prompt, provider, run)`.

**401 mid-queue race** (correctness-reviewer):
- Plan beschrijft alleen "queue pauzeren" bij 401. Maar 5 calls met oud token zijn al in-flight.
- Mogelijke uitkomsten: sommige 200 (token nog net geldig), sommige 401 (verlopen) → modal spam of data loss.
- **Fix:**
  - Bij eerste 401: cancel in-flight set via AbortController.
  - Collapse alle 401s binnen 2s in één modal.
  - Na token-refresh: re-queue precies die calls.

**State-machine pattern voor pause/resume** (queue-research):
```js
class Queue {
  #refreshing = false;
  #abortAll = new AbortController();
  async exec(task) {
    try { return await task(this.#abortAll.signal); }
    catch (e) {
      if (e.status === 401 && !this.#refreshing) {
        this.#refreshing = true;
        this.#abortAll.abort();                  // cancel in-flight
        await this.showCaptchaModal();           // user solves
        this.#abortAll = new AbortController();  // fresh signal
        this.#refreshing = false;
        return await task(this.#abortAll.signal); // retry deze task
      }
      throw e;
    }
  }
}
```

**Backoff met decorrelated jitter** (AWS-pattern):
```js
const backoffMs = (attempt, base = 1000, cap = 30000) => {
  const exp = Math.min(base * (2 ** attempt - 1), cap);
  return Math.random() * exp;  // full jitter
};
```

**IndexedDB > localStorage voor 1.2MB:**
- localStorage quota varieert (5–10MB), maar 1.2MB plus oude metingen kan overlopen.
- IndexedDB: async, grotere quota, structured store, betere fit voor resumable jobs.
- Met `navigator.storage.estimate()` pre-flight controleren.
- **Alternatief simpeler:** overschrijf de vorige meting bij start van een nieuwe (plan zegt dit al impliciet), accepteer dat parallelle tabs collide. Voor één gebruiker = niet-issue.

**Daily-budget timezone** (correctness-reviewer):
- Plan: "tot middernacht". Welke? Heroku = UTC, jij = NL (UTC+1/+2).
- Naive `date.today()` = UTC-datum → reset om 00:00 UTC ≈ 01:00–02:00 NL.
- **Fix:** pin alle server-tijd aan UTC explicit (`datetime.now(timezone.utc)`), cache-key = `'dailycost:' + utc_date.isoformat()`. Document in UI: "budget reset om 00:00 UTC".

**Partial-failure aggregatie biast cross-provider compare** (correctness-reviewer):
- Als 5 prompts falen alleen voor Perplexity, maar slagen voor OpenAI/Gemini/Anthropic: Perplexity heeft denominator 45, anderen 50.
- `mention_share` percentages zijn dan niet vergelijkbaar.
- **Fix:** óf prompt droppen voor ALLE providers als hij voor één faalt, óf per-provider denominator naast percentage tonen en asymmetrie flaggen.

**AbortSignal.any() voor gelaagde aborts:**
```js
const sig = AbortSignal.any([parentSignal, AbortSignal.timeout(35000)]);
fetch(url, { signal: sig });
```
Modern (2024+), geen polyfill nodig in target-browsers.

**`Retry-After` parsing:** RFC 7231 staat zowel seconden als HTTP-date toe. Plan zegt "default 10s als header ontbreekt" — voeg toe: fallback bij malformed header, niet 0 of throw.

**AbortController 35s vs Heroku H12 30s:** plan heeft 35s frontend-abort, maar Heroku H12 vuurt eerder (30s) → backend retourneert 503 vóór de frontend-timeout. De 35s wordt zelden bereikt. Of align ze (35s ↔ 30s) of documenteer waarom 35s (CDN-buffer, klok-skew).

## Implementatie-fases (TDD-first per hp-richtlijn)

### Fase 1 — Backend skeleton (Django app + endpoints)

**Tests eerst** (`tests/test_run_endpoint.py`):
- `test_run_demo_zonder_key`: provider zonder key returnt is_demo=True.
- `test_run_geldige_call`: POST met geldig token + provider returnt ProviderResult-shape.
- `test_run_zonder_token`: 401.
- `test_run_ongeldig_provider`: 400.
- `test_run_oversized_body`: 413.

**Daarna**: `apps/geo/` aanmaken, `views.py` met async `/api/geo/run`,
`providers.py` 1:1 uit FastAPI-project verhuizen, `urls.py` koppelen.

### Fase 2 — Captcha + token + rate-limit + kill-switch

**Tests eerst**:
- `test_start_ongeldige_captcha`: 403.
- `test_start_geldige_captcha`: returnt token.
- `test_token_call_limit_overschreden`: 429.
- `test_dagbudget_bereikt`: alle calls 503 met "Dagbudget bereikt".
- `test_kosten_optellen`: kosten worden correct opgeteld per provider per dag.

**Daarna**: `captcha.py`, `ratelimit.py`, JWT-utility (PyJWT, al in stack),
middleware of decorator op `/api/geo/run` en `/api/geo/prompts`.

### Fase 3 — Promptset endpoint + book_prompts

**Tests eerst**:
- `test_prompts_categorie_marketing`: returnt N prompts, geen merknaam erin.
- `test_book_prompts_zonder_landingspagina`: skipt DVV-analyse cleanly.

**Daarna**: `prompts.py`, `book_prompts.py` verhuizen, `views.py` endpoint
toevoegen.

### Fase 4 — JS analyse + rapport (port van Python)

**Tests eerst** (`tests/analyze.test.js` in frontend-repo, draaibaar met
`node --test`):
- `test_mention_detection_eenvoudig`: tekst met merknaam → mention=1.
- `test_mention_detection_negatief`: tekst zonder merknaam → mention=0.
- `test_citation_share_url_match`: bron-URL matcht merk-URL → citation=1.
- `test_rows_aggregatie`: meerdere runs aggregeren naar mention_share/citation_share.

**Daarna**: `analyze.js` en `report.js` schrijven met dezelfde
function-signatures als de Python-originelen. Vergelijken: voer 10 echte
antwoorden door beide implementaties en assert exacte gelijkheid.

### Fase 5 — Frontend orkestratie + robuustheid + UI

De queue-implementatie is het hart van de frontend. We testen 'm geïsoleerd
(zonder DOM) met `node --test`, en daarna de UI met Playwright.

**Unit-tests eerst** (`tests/queue.test.js` in frontend-repo, met
`fetch`-mock):
- `test_basis_volgorde`: 10 calls in queue, 6 parallel, alle 10 slagen → klaar.
- `test_retry_op_504`: mock returnt eerst 504, dan 200 → 1 retry, eindigt
  succesvol. Backoff-timer gerespecteerd (2s).
- `test_retry_budget_op`: mock returnt 3× 504 → na 3 retries gemarkeerd als
  `failed`, queue gaat door met de rest.
- `test_abort_op_frontend_timeout`: mock hangt 40s → `AbortController` fires
  na 35s → telt als timeout → retry.
- `test_429_met_retry_after`: mock 429 met header `Retry-After: 5` →
  wacht 5s exact (binnen ±200ms) → retry.
- `test_geen_retry_op_400`: 400 → 1 call totaal, status `failed`, reden
  zichtbaar.
- `test_token_verlopen_pauze`: mock 401 → queue pauzeert (assert geen nieuwe
  calls), pas na callback `setToken(...)` hervat.
- `test_daily_budget_stopt_alles`: één call returnt 503 `code: daily_budget`
  → alle andere calls in queue worden cancelled, modal-callback aangeroepen.
- `test_partial_failure_telt_op`: 50 calls, 5 falen permanent → `done: 50,
  succeeded: 45, failed: 5`. Analyse draait op de 45 geslaagde.
- `test_offline_pauze`: emit `offline` event → queue pauzeert. `online` event
  → hervat. Geen calls afgevuurd terwijl offline.
- `test_resume_uit_storage`: schrijf state in localStorage, refresh sim,
  resume → queue start bij waar hij stopte (alleen `pending`-status, niet
  geslaagde calls opnieuw).
- `test_storage_throttle`: 100 snelle status-updates → max 1 write per seconde.

**UI-tests** (Playwright, smoke):
- Captcha-widget verschijnt; "Meten" disabled tot opgelost.
- Tijdens meting: progressie-balk groeit, per-call icoontjes wijzigen.
- Forceer 504 op één call (via service worker of dev-tools): zie 🔁 1/3,
  daarna ✓.
- Forceer 401 mid-meting: modal verschijnt, na captcha hervat queue.
- Forceer `offline`: banner verschijnt; `online` weer: banner weg, queue door.
- Refresh tijdens meting → resume-prompt verschijnt → klik hervatten → meting
  loopt door.
- Aan einde met fouten: "X mislukt" sectie expand-baar met details.

**Daarna**: code opgebouwd uit losse modules (zie bestandenoverzicht):
`queue.js`, `transport.js`, `storage.js`, `ui.js`, `app.js`. Alles ES-modules
(`<script type="module">`), geen bundler — werkt direct in moderne browsers
en op GH Pages.

**Styling-stap** (klein, eenmalig):
- Open `~/Sites/harmsen.nl/static_originals/css/main.css` en pluk de
  globale stijlen eruit: `@import`-regels voor Ubuntu + Lobster Two,
  body/heading-kleuren, link-styling, accent.
- Definieer ze als CSS-custom-properties in `:root` van `theme.css`.
- Open `geo.harmsen.nl` lokaal naast `harmsen.nl` (twee tabbladen) en
  vergelijk visueel: lettertype, kleur, link-hover. Moet "familie" voelen.

Hergebruik zoveel mogelijk van huidige `static/index.html` voor layout en
formulier; de orkestratie is volledig nieuw.

#### Research insights — Heroku 30s timeout & streaming

**H12 timing exact** (Heroku-onderzoek):
- 30s aftellen start zodra request bij dyno is.
- Eerste byte response moet binnen 30s. Daarna geldt **rolling 55s window** per byte.
- Client ziet **connection reset** (geen 503-body), terwijl dyno mogelijk doorwerkt en LLM-server-side completion alsnog kost. → relevantie voor cost-counter, zie security-insights.

**Realistische latencies 2026** (1500-token completion):
| Model | TTFT | totaal 1500 tok |
|---|---|---|
| Claude Haiku 4.5 | <600ms | 24–26s |
| Gemini 2.5 Flash | <600ms | 19–21s |
| GPT-5 nano/mini | 600ms | 31–33s |
| Perplexity Sonar | 400ms | 28–30s |
| Claude Sonnet 4.5 | 2s | 47–49s |

- **Haiku + Flash zijn de safe bets** voor <25s p50.
- **GPT-5 + Perplexity Sonar zijn borderline** voor p95 — book_prompts daar lopen risico op H12.
- **Claude Sonnet voor book_prompts = altijd risico** zonder streaming.

**book_prompts max_tokens guidance:**
- Haiku/Flash: 800 per prompt.
- GPT-5 mini / Perplexity Sonar: 600 per prompt.
- Sonnet 4.5: 500 max, of niet gebruiken voor book_prompts in V1.

**Streaming overweging:**
- Alle 4 providers ondersteunen streaming (SSE).
- Streaming bypasst H12 zodra eerste token arriveert (binnen 1–2s typisch).
- **Kosten:** vereist async views, SSE op de wire, browser-side reassembly.
- **Aanbeveling V1:** **niet** doen. Max_tokens-caps zijn voldoende, "one-call-one-request" blijft staan. Streaming voor V1.1 als book_prompts daadwerkelijk H12 hitten.

### Fase 6 — GitHub Pages, DNS, CORS

**Tests eerst** (`tests/test_cors.py` in Django backend):
- `test_cors_geo_harmsen_toegestaan`: preflight van
  `https://geo.harmsen.nl` returnt 200 met juiste headers.
- `test_cors_andere_origin_geblokkeerd`: preflight van
  `https://evil.example` returnt geen `Access-Control-Allow-Origin`.
- `test_options_preflight`: alle endpoints accepteren `OPTIONS`.

**Daarna**:

1. **GitHub Pages aanzetten** in `~/proj/geo/` repo:
   - Settings → Pages → Source: `main` / root.
   - `CNAME`-bestand committen met inhoud `geo.harmsen.nl`.
   - "Enforce HTTPS" aanvinken zodra cert provisioned is.
2. **DNS bij registrar**: `CNAME geo → <github-username>.github.io.`
   (let op de trailing dot). TTL: 300s tijdens setup, daarna 3600s.
3. **Wachten op cert**: GitHub provisioneert Let's Encrypt binnen 5–60 min,
   soms tot 24u. Controleer in Settings → Pages.
4. **Django CORS**:
   - `uv add django-cors-headers` in `~/Sites/harmsen.nl/`.
   - In `website/settings.py`: `corsheaders` aan `INSTALLED_APPS`,
     `corsheaders.middleware.CorsMiddleware` boven `CommonMiddleware`.
   - `CORS_ALLOWED_ORIGINS = ["https://geo.harmsen.nl"]`
     + lokaal: `+ ["http://localhost:8000", "http://127.0.0.1:8000"]`
     in DEBUG.
5. **Env vars op Heroku** (`heroku config:set -a heroku-harmsen ...`):
   `OPENAI_API_KEY`, `PERPLEXITY_API_KEY`, `GEMINI_API_KEY`,
   `ANTHROPIC_API_KEY`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET`,
   `GEO_DAILY_USD_CAP=5`, `GEO_JWT_SECRET=<random>`.
6. **End-to-end smoke**: open `geo.harmsen.nl` in incognito, run een mini-
   meting (1 prompt, 1 run, demo-modus → echte modus met je eigen merk).
   Controleer Network-tab: alle calls naar `harmsen.nl/api/geo/*` met
   `Authorization`-header, geen CORS-fouten.

theadarchitect.nl-integratie maakt geen onderdeel uit van Fase 6 — zie V2.

#### Research insights — CORS (django-cors-headers)

**Complete settings.py snippet** (CORS-research):
```python
INSTALLED_APPS += ['corsheaders']

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',   # EERSTE
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    ...
]

# Env-driven, niet hardcoded (architecture-reviewer: scheelt deploy bij V2)
CORS_ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get(
        'GEO_CORS_ORIGINS', 'https://geo.harmsen.nl'
    ).split(',') if o.strip()
]
if DEBUG:
    CORS_ALLOWED_ORIGINS += [
        'http://localhost:3000', 'http://localhost:8000',
        'http://127.0.0.1:8000',
    ]

# Authorization-header zit standaard in default-allow-headers van django-cors-headers
CORS_ALLOW_CREDENTIALS = False  # geen cookies
CORS_MAX_AGE = 86400            # preflight 24u cachen (default = 5s, performance-killer)

# 4-laagse defense: IP-rate-limit + body-size hard limit
DATA_UPLOAD_MAX_MEMORY_SIZE = 10240
```

**Preflight (OPTIONS) wordt automatisch afgehandeld door middleware** — geen `@csrf_exempt` op OPTIONS nodig, geen view-method aanpassing. **MAAR** test `test_options_preflight` moet headers asserteren, niet alleen status 200:
```python
def test_options_preflight(self):
    r = self.client.options('/api/geo/run',
        HTTP_ORIGIN='https://geo.harmsen.nl',
        HTTP_ACCESS_CONTROL_REQUEST_METHOD='POST',
        HTTP_ACCESS_CONTROL_REQUEST_HEADERS='Authorization,Content-Type')
    assert r.status_code == 200
    assert r['Access-Control-Allow-Origin'] == 'https://geo.harmsen.nl'
    assert 'authorization' in r['Access-Control-Allow-Headers'].lower()
    assert 'POST' in r['Access-Control-Allow-Methods']
```

**CSRF interactie:** Django CSRF triggert alleen op session-cookies. Met `Authorization`-header auth is CSRF stilstaand → géén `@csrf_exempt` strict nodig. **Echter:** plan-conventie van harmsen.nl (`apps/playground/playground.py:23`) zet wel `@csrf_exempt` op alle JSON-views. Volg die conventie voor consistentie.

**Curl preflight-test:**
```bash
curl -X OPTIONS https://harmsen.nl/api/geo/run \
  -H 'Origin: https://geo.harmsen.nl' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: Authorization,Content-Type' -v
```
Verwacht: `Access-Control-Allow-Origin: https://geo.harmsen.nl`.

### Research insights — Logging (justlog)

**Vervang `geo/logsetup.py` volledig door `justlog`** (skill-toepassing):
- Justlog doet rotation, stderr-dual-handler, optionele DB-log + webhook bij `ERROR+` — alles wat logsetup.py deed, beter.
- Bewaar **alleen** `_redact()` helper uit `providers.py` (domeinspecifiek, niet door justlog gedekt).

**Setup in `apps/geo/apps.py` (AppConfig.ready) of bovenin `settings.py`:**
```python
from justlog import setup_logging
setup_logging(
    log_file_path='logs/geo.log',
    level=logging.INFO,
    to_stderr_level=logging.INFO,   # Heroku → logplex
    max_bytes=5_000_000, backup_count=5, backup_days=30,
    logger_name='geo',
    use_database=True,              # web-viewer voor inspectie
    webhook=os.getenv('GEO_LOG_WEBHOOK'),  # optional, ERROR+ only
)
```

**Per-call log (DoD: provider, kosten, IP-hash, latency):**
```python
from justlog import lg
lg.info('provider_call',
        provider=provider, model=result.model,
        cost_usd=round(result.cost, 5),
        ip_hash=ip_hash, latency_ms=latency_ms,
        tokens=result.usage.get('total'))
```
- Event-name in snake_case (greppable).
- Levels: `INFO` = success, `WARNING` = kill-switch / rate-limit hit, `ERROR` = provider-fout.
- DB-logging: zet `db_level=logging.WARNING` als volume groeit; per-meting max ~300 calls = nu acceptabel.

### Fase 7 — Cleanup van `~/proj/geo/`

De repo wordt herbestemd van "FastAPI-app" naar "GH Pages frontend". Volgorde:

1. **Backend-code uit `~/proj/geo/` verwijderen** zodra Fase 1–3 in
   `harmsen.nl/apps/geo/` groen draaien en lokaal getest is:
   - Verwijder: `app.py`, `geo/` (Python pakket), `run.py`, `Procfile`,
     `runtime.txt`, `requirements.txt`, `.env.example`,
     `API-keys-hier-invullen.txt`, `START-HIER.md`, `DEPLOY.md`,
     `AGENTS.md`. De `static/` HTML/CSS-bestanden blijven (worden de basis
     voor de nieuwe frontend in repo-root).
   - `README.md` herschrijven: doel = GH Pages frontend voor de GEO-meter,
     deploy = `git push`, backend = `harmsen.nl/api/geo`.
2. **Frontend-bestanden verplaatsen** van `static/` naar repo-root.
3. **`CNAME`** committen met `geo.harmsen.nl`.
4. **`docs/solutions/2026-XX-XX-django-stateless-geo.md`** schrijven
   (lessons learned voor de SOP).
5. **`docs/`-mappen** blijven (doel.md, architecture.md aangepast om de
   nieuwe rol te beschrijven, plans/, brainstorms/, solutions/).

#### Research insights — Cutover-sequencing (architecture-reviewer)

Het plan conflateert "frontend deployen" en "FastAPI opruimen" in dezelfde repo. Risico: tijdens de switch is er een gat waarin niets werkt. **Expliciete sequentie:**

1. Django backend live op `harmsen.nl/api/geo/*`, smoke-tested met curl.
2. Nieuwe GH Pages frontend deployen op **tijdelijke** URL (`<user>.github.io/geo/`) en E2E-getest tegen live Django-backend. Voeg deze origin tijdelijk toe aan `GEO_CORS_ORIGINS`.
3. DNS-cut voor `geo.harmsen.nl` → GH Pages.
4. **Pas dan**: FastAPI Python uit `~/proj/geo/` verwijderen + Heroku-app van FastAPI (indien aanwezig) decommissionen.
5. Tijdelijke origin uit `GEO_CORS_ORIGINS` halen.

Gebruik een aparte branch `gh-pages-rewrite` voor de frontend; merge naar `main` pas na stap 3. Voorkomt "frontend gone before backend ready"-gat.

## Tests samengevat

Alle tests draaien via `python manage.py test apps.geo` (Django runner).
JS tests via `node --test static/geo/tests/`. Integratietest:

```
test_volledige_meting_via_demo:
  - geen keys gezet → alles demo
  - frontend start meting via Playwright
  - verifieer: rapport.md gedownload, mention_share = berekende waarde,
    GEEN echte API-calls gedaan (assert via httpx-mock).
```

### Aanvullende tests (uit reviews)

Backend (Django):
- `test_timeout_telt_pessimistisch_mee` — counter advanced bij H12/abort.
- `test_token_replay` — same JWT after expiry rejected.
- `test_token_tampering` — modified signature rejected.
- `test_concurrent_token_use` — 6 parallel calls met counter=5 → minstens 1 reject.
- `test_kill_switch_in_db_cache_cross_worker` — cap honored over 2 worker-processen (integration test).
- `test_xss_in_llm_response_sanitized` — frontend rendert provider-response veilig.
- `test_options_returns_cors_headers` — preflight assert headers, niet alleen status.
- `test_input_sanitization_strips_control_chars` — `categorie="\x00foo"` wordt opgeschoond.
- `test_max_tokens_capped_server_side` — frontend `max_tokens=99999` → server cap 800.
- `test_turnstile_hostname_mismatch_rejected` — token van `evil.com` hostname → fail.

Frontend (`node --test`):
- `test_budget_dekt_max_meting_met_retries` — assert math klopt.
- `test_resume_after_refresh_during_inflight` — `inflight` ≠ `pending`.
- `test_concurrent_401s_one_modal` — 6 parallelle 401's → 1 modal, geen spam.
- `test_per_provider_denominator_in_rapport` — partial-failure aggregatie correct.
- `test_retry_storm_max_3` — 50 sim-tabs op 503 → ≤3 retries elk, dan stop.

E2E (Playwright):
- `test_xss_geblokkeerd` — kwaadaardige LLM-response wordt als text, niet HTML, gerenderd.

### Aanbevolen contract-test

Per Fase 4 in plan: voer 10 echte LLM-antwoorden door zowel Python `analyze.py` als JS `analyze.js` en assert byte-equality van output. Codeer dit als CI-test (`tests/contract/test_analyze_parity.py`) zodat V2-werk niet stilzwijgend drift.

## Vragen en antwoorden

1. **JWT-secret op Heroku**: gebruik je een bestaande (Django `SECRET_KEY`)
   of een aparte? Antwoord: aparte
2. **Captcha provider**: Cloudflare Turnstile (gratis, geen tracking,
   aanbevolen) of hCaptcha. Antwoord: Turnstile
3. **Dagbudget default**: voorstel **$5/dag**. Bij benadering: één volle
   meting kost ~$0.10–0.50, dus ruim 10 metingen per dag publiek.
   Antwoord: akkoord
4. **Throttling cross-worker**: Django cache op LocMem werkt per worker.
   Voor correcte gedeelde tellers moeten we Django cache op DB of Redis
   zetten. Heroku Postgres is er al → cache_table maken. Klein werk,
   ~10 regels. Of accepteren dat tellers per worker leven (in praktijk OK
   voor 2 workers). Antwoord: per worker is OK.
5. **GitHub-account voor de repo**: moet ik 'm onder jouw account
   publiceren, of bestaat er al een `geo`-repo? Antwoord: Hij moet onder mijn account en de pagina moet geo.harmsen.nl worden.
6. **theadarchitect.nl-aanpak**: hele integratie uitgesteld naar V2 —
   beslissing tussen iframe, tweede GH Pages repo, of Cloudflare Pages
   multi-domain wordt bij V2-kickoff genomen. Zie sectie "V2".

## Risico's

- **30s timeout op boek-analyses**: 5% kans dat een diepte-prompt > 30s duurt.
  Mitigatie: `max_tokens` lager + frontend retry met `AbortController` op 35s.
- **Captcha-bypass**: ervaren scrapers omzeilen Turnstile. Daily kill-switch
  is de echte verzekering — gewoon je rekening.
- **CORS misconfiguratie**: frontend werkt lokaal maar niet productie. Test
  vroeg met een echte deploy van zowel GH Pages als harmsen.nl. Vergeet
  niet de preflight (`OPTIONS`) — Django moet die ook aankunnen.
- **GH Pages HTTPS-cert vertraging**: bij eerste setup van `geo.harmsen.nl`
  duurt het tot 24u voor het Let's Encrypt-cert er is. In die periode
  faalt elke fetch vanaf de frontend op `https`. Mitigatie: tijdens setup
  testen via een tijdelijke `*.github.io` URL met CORS-uitzondering, of
  gewoon wachten.
- **DNS-propagatie**: CNAME-wijziging is meestal binnen 10 min zichtbaar
  maar kan tot uren duren. Test met `dig geo.harmsen.nl CNAME`.
- **Cross-origin captcha**: Turnstile werkt cross-origin (token in body),
  maar de Turnstile-widget moet weten welk domein 'm host. Zet
  `geo.harmsen.nl` (en bij dev `localhost`) in de Turnstile site-config.
- **Django async views op gunicorn**: bestaande harmsen.nl draait sync gunicorn.
  Async views werken, maar vereisen `gunicorn` met `--worker-class uvicorn.workers.UvicornWorker`
  of accepteren dat de async-call sync wordt afgewacht. Verifiëren bij Fase 1.
- **Retry-storm bij outage**: als Heroku 10 min plat ligt, gaan 50 tabbladen
  tegelijk om de 8s retryen. Mitigatie: na 3 mislukte retries op rij
  *stoppen* met retryen en de gebruiker een "Probeer later opnieuw"-modal
  tonen — niet eindeloos blijven hameren.
- **localStorage-quota**: een meting met 300 antwoorden van 4KB = ~1.2MB.
  Binnen quota (5–10MB per origin), maar bij meerdere oude metingen kan het
  oplopen. Mitigatie: oude meting overschrijven bij start van nieuwe; bij
  `QuotaExceededError` cleanup + waarschuwing.

## Definition of done

- `https://geo.harmsen.nl` werkt (HTTPS cert ✓, custom domain ✓): meting
  voor minstens 1 echte merk, rapport downloadbaar, kosten zichtbaar.
- **Visueel familie van harmsen.nl**: zelfde lettertypes (Ubuntu + Lobster
  Two), tekstkleuren en accent. Side-by-side check met `www.harmsen.nl`
  toont een herkenbaar consistente look.
- Backend log toont per call: provider, kosten, IP (gehashed), latency.
- Daily kill-switch test: zet `GEO_DAILY_USD_CAP=0.01` → eerste call slaagt,
  tweede wordt geweigerd met duidelijke modal.
- **Robuustheids-acceptatie** (handmatig met Chrome DevTools → Network):
  - Een meting van 100 calls voltooit ook als je halverwege "Offline" zet
    voor 30s en daarna weer "Online".
  - Een meting voltooit ook als je `Throttling: Slow 3G` + 10% van responses
    op 504 forceert (via service worker).
  - Pagina refreshen tijdens meting → resume-knop verschijnt → vervolg loopt
    door zonder dubbele calls.
- FastAPI-code uit `~/proj/geo/` verwijderd; repo is nu zuiver de GH Pages
  frontend met `CNAME`, alle tests groen (Django + node).

## Open beslissingen na verdieping (jij kiest)

Deze keuzes zijn niet door de verdieping eenduidig opgelost — ze hangen af van jouw smaak en ambitie. Geadviseerde defaults staan vetgedrukt.

1. **V1-scope: A (minimal), B (volledig defended) of C (tussenweg)?** Zie tabel in Enhancement Summary. **Default: C** — sync views + USD kill-switch + per-IP rate-limit + sanitization + CSP, géén Turnstile/JWT/resume tot signaal.
2. **Sync of async views?** **Default: sync** (`def`, niet `async def`) — past bij sync gunicorn, voorkomt UvicornWorker-migratie, geen concurrency-verlies want één LLM-call per request.
3. **Tweede Heroku-app of `apps/geo` in harmsen.nl?** **Default: in harmsen.nl** met sync-views (failure-isolatie via dyno-resources). Tweede app pas overwegen bij groei.
4. **JWT secret-sharing met Django SECRET_KEY?** **Default: aparte secret** (`GEO_JWT_SECRET`) — failure-isolatie.
5. **Daily-budget-counter in LocMem of DB-cache?** **Default: DB-cache (`cache_table` migration)** voor de USD-counter, LocMem (per-worker) voor de overige tellers. Override Q&A #4 voor specifiek de kill-switch.
6. **Module-split frontend (5 files) of één `app.js`?** **Default: 3 files** — `app.js` + `analyze.js` + `report.js`. Split pas wanneer `app.js` 500 regels passeert.
7. **localStorage of IndexedDB voor resume?** **Default: localStorage met overschrijf-bij-nieuwe-meting** strategie — accept dat parallel-tab niet ondersteund wordt; voor één gebruiker geen issue. IndexedDB pas als 1.2MB-quota daadwerkelijk hit.
8. **`docs/solutions/2026-XX-XX-geo-providers-niet-justai.md`** schrijven? **Ja**, om de afwijking van de globale "altijd justai"-regel expliciet te documenteren.

## V2 — theadarchitect.nl (open beslissing)

Na V1-launch wordt besloten hoe de tool op `theadarchitect.nl` getoond wordt.
Drie kandidaten, samenvattend:

| Aanpak | Eén codebase | Voelt als één site | Setup-werk | Onderhoud |
|---|---|---|---|---|
| **A. Iframe vanuit Webflow** naar `geo.harmsen.nl?theme=adarch` | ✓ | ⚠️ rechthoek-in-pagina | minimaal (paar regels HTML) | nul |
| **B. Tweede GH Pages repo** met identieke bestanden + CNAME `geo.theadarchitect.nl` | ✗ (twee repo's, sync nodig) | ✓ | wat extra | sync-script of GH Action |
| **C. Cloudflare Pages multi-domain** — één repo, beide domeinen | ✓ | ✓ | nieuw platform leren | nul |

**Werk dat sowieso bij V2 hoort** (welke aanpak ook):
- Multi-theme: `brand.js` opsplitsen in thema-objecten, `theme.css` met
  CSS-variabelen per merk, runtime-keuze op basis van query-parameter of
  hostname.
- CORS-allowlist op de Django-API uitbreiden met de gekozen origin(s).
- Turnstile site-config uitbreiden met het tweede domein.
- DoD V2: tweede merk werkt met eigen branding, dezelfde backend, geen
  duplicatie van API-keys.

**Trigger voor V2**: zodra V1 een week stabiel draait op
`geo.harmsen.nl` en je de tool aan klanten van Ad Architect wilt tonen.
