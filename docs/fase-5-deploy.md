# Fase 5 — Online zetten op `geo.harmsen.nl`

Eenmalige setup. Door deze stappen in deze volgorde te doen voorkom je dat een
cert-/DNS-/CORS-probleem achteraf alles tegelijk verstikt.

Plan-referentie: `docs/plans/2026-06-24-002-geo-django-static-v1-minimal-plan.md` (§ Fase 5).

---

## 0. Vooraf — Cloudflare-context

`harmsen.nl` staat op **Cloudflare**-nameservers. DNS zet je dus in het
Cloudflare-dashboard (stap 4), niet bij je domein-registrar.

CAA is op 2026-06-26 leeg, dus Let's Encrypt mag certs uitgeven. Geen actie
nodig.

---

## 1. Env-vars in `~/Sites/harmsen.nl/.env` zetten

`./publish.sh` synct `.env` naar Heroku — je hoeft `heroku config:set` niet
zelf te draaien. Voeg deze regels onderaan `~/Sites/harmsen.nl/.env` toe
(OPENAI/PERPLEXITY/GEMINI/ANTHROPIC stonden er waarschijnlijk al voor andere
apps; kijk eerst of ze al gezet zijn):

```env
OPENAI_API_KEY=sk-...
PERPLEXITY_API_KEY=pplx-...
GEMINI_API_KEY=AIza...
ANTHROPIC_API_KEY=sk-ant-...
GEO_DAILY_USD_CAP=5
GEO_IP_PEPPER=<random-token>
GEO_CORS_ORIGINS=https://geo.harmsen.nl
```

Genereer een veilige pepper:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

> Zo lang de cert-provisioning op GitHub nog loopt kun je tijdelijk testen via
> `https://hpharmsen.github.io/geo/`. Tijdelijk:
>
> ```env
> GEO_CORS_ORIGINS=https://geo.harmsen.nl,https://hpharmsen.github.io
> ```
>
> En `hpharmsen.github.io` er weer afhalen zodra `geo.harmsen.nl` werkt (Fase 6).

Daarna in stap 2 met `./publish.sh` deployen — die zet `.env` automatisch op
Heroku én pusht de code.

---

## 2. Merge `feat/geo-api` naar `master` en deploy

```bash
cd ~/Sites/harmsen.nl
git fetch
git checkout master
git merge feat/geo-api
./publish.sh
```

`publish.sh` synct `.env` naar Heroku-config, doet `collectstatic`, en pusht
naar Heroku. `release: python manage.py migrate && python manage.py createcachetable`
in de Procfile maakt de `geo_cache_table` (DB-cache voor de USD kill-switch)
aan vóór de webdyno start.

**Smoke-test backend** (kan nog vóór de frontend live is):

```bash
curl -s https://harmsen.nl/api/geo/config | jq
```

Verwacht: JSON met `available_providers`, `available: true`, `max_runs_per_prompt: 10`.

---

## 3. GitHub Pages aanzetten op `~/proj/geo/`

1. Push de huidige `main` van `~/proj/geo/` naar GitHub (als dat nog niet
   gebeurd is — repo moet publiek of "Pages" moet aan staan voor private).
2. GitHub → repo `geo` → **Settings → Pages**:
   - **Source**: Deploy from a branch
   - **Branch**: `main` / **root**
   - **Custom domain**: `geo.harmsen.nl` (deze wordt al uit het meegecommitte
     `CNAME`-bestand gepakt, dus normaal staat 'ie er al)
   - **Enforce HTTPS**: aanvinken (GitHub wacht netjes als het cert nog niet
     klaar is — mediaan 5–15 min, p95 4 uur).

---

## 4. DNS in Cloudflare zetten

Cloudflare-dashboard → `harmsen.nl` → **DNS → Records → Add record**:

| Field        | Value                  |
|--------------|------------------------|
| Type         | `CNAME`                |
| Name         | `geo`                  |
| Target       | `hpharmsen.github.io`  |
| Proxy status | **DNS only** (grijze wolk) |
| TTL          | Auto                   |

> ⚠️ **Proxy uit zetten is verplicht.** Op "Proxied" (oranje wolk) onderschept
> Cloudflare TLS-handshakes en faalt GitHub Pages' cert-uitgifte stilzwijgend
> — symptoom: "Your site is being published" blijft 24u hangen en `geo.harmsen.nl`
> serveert een Cloudflare 522/525.

Verificatie (1–10 min):

```bash
dig geo.harmsen.nl CNAME +short
# verwacht: hpharmsen.github.io.
```

Als er een rij IP-adressen verschijnt in plaats van de CNAME-target, staat de
proxy nog aan — zet 'm uit.

---

## 5. Wachten op het HTTPS-certificaat

Op GH Pages onder **Settings → Pages** verschijnt na enkele minuten:

> ✅ Your site is published at https://geo.harmsen.nl

Mediaan 5–15 min, p95 4 uur. Als het na 24 uur nog steeds faalt: terug naar
stap 0 (CAA) of contact GitHub Support.

---

## 6. E2E-smoke

In een **incognito**-browser:

1. Open `https://geo.harmsen.nl`.
2. Vul een minimale meting in: 1 prompt, 1 run, kale modus.
3. Open DevTools → Network.
4. Verwacht: alle calls naar `https://harmsen.nl/api/geo/*`, response 200,
   **geen** CORS-fouten in de console.
5. Trigger een echte meting (met API-keys actief op Heroku) → rapport
   download-link verschijnt.

---

## 7. Pas dán: Fase 6 cleanup

Pas als bovenstaande E2E groen is, mag `~/proj/geo/` opgeschoond worden
(FastAPI-Python eruit, `static/*` naar root, README herschrijven). Zie het
plan, § Fase 6.
