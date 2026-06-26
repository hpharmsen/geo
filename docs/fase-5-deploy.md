# Fase 5 — Online zetten op `geo.harmsen.nl`

Eenmalige setup. Volg de volgorde — anders verstrikken DNS, cert en CORS elkaar.

Plan-referentie: `docs/plans/2026-06-24-002-geo-django-static-v1-minimal-plan.md` (§ Fase 5).

Legenda: ✅ = al gedaan (door Claude), 🟡 = jij moet dit nog.

---

## ✅ 0. Voorbereiding (klaar)

- ✅ CAA-record op `harmsen.nl` is leeg → Let's Encrypt mag certs uitgeven.
- ✅ `~/proj/geo/CNAME` bevat `geo.harmsen.nl`.
- ✅ Backend CORS-tests groen (22/22).
- ✅ GitHub-repo `hpharmsen/geo` aangemaakt (public, beschrijving + homepage).
- ✅ Local remote `origin` → `https://github.com/hpharmsen/geo.git` ingesteld.
- ✅ `~/Sites/harmsen.nl/.env` heeft al `GEO_DAILY_USD_CAP`, `GEO_IP_PEPPER`,
  `GEO_CORS_ORIGINS`, `GEO_IP_HOURLY_LIMIT` (geverifieerd, values intact).
- ✅ Twee commits klaar: `apps/geo: CORS-preflight tests …` op `feat/geo-api`,
  en `Fase 5: CNAME + deploy-instructies` op `main` van geo.

> ℹ️ `harmsen.nl` staat op **Cloudflare**-nameservers. DNS-records zet je dus
> in het Cloudflare-dashboard (stap 3), niet bij je domein-registrar.

---

## 🟡 1. (Optioneel) Perplexity- en Gemini-keys aan `.env` toevoegen

In `~/Sites/harmsen.nl/.env` staan al `OPENAI_API_KEY` en `ANTHROPIC_API_KEY`.
`PERPLEXITY_API_KEY` en `GEMINI_API_KEY` ontbreken — die vallen straks terug
op demo-modus. Wil je over alle 4 providers meten, voeg dan toe:

```env
PERPLEXITY_API_KEY=pplx-...
GEMINI_API_KEY=AIza...
```

(Slaan op zonder commit; `.env` staat in `.gitignore`.)

---

## 🟡 2. Frontend pushen naar GitHub

```bash
cd ~/proj/geo
git push -u origin main
```

> Hierna staat de frontend (HTML + JS + CNAME) op `hpharmsen/geo`, klaar voor
> GH Pages.

---

## 🟡 3. Backend mergen naar `master` + deployen

```bash
cd ~/Sites/harmsen.nl
git checkout master
git merge feat/geo-api
./publish.sh
```

`publish.sh` synct `.env` naar Heroku-config, doet `collectstatic`, en pusht
naar Heroku. De Procfile-release-stap maakt `geo_cache_table` (DB-cache voor
de USD kill-switch) aan vóór de webdyno start.

**Smoke-test backend** (1 minuut na deploy):

```bash
curl -s https://harmsen.nl/api/geo/config | jq
```

Verwacht: JSON met `available_providers`, `available: true`, `max_runs_per_prompt: 10`.

---

## 🟡 4. GitHub Pages aanzetten

Browse naar https://github.com/hpharmsen/geo/settings/pages en zet:

- **Source**: Deploy from a branch
- **Branch**: `main` / **root** → Save
- **Custom domain**: wordt automatisch op `geo.harmsen.nl` gezet uit de
  meegecommitte `CNAME`-file (anders handmatig invullen → Save).
- **Enforce HTTPS**: aanvinken (mag al; GH wacht netjes als het cert nog niet
  klaar is).

---

## 🟡 5. Cloudflare DNS zetten

Cloudflare-dashboard → `harmsen.nl` → **DNS → Records → Add record**:

| Field        | Value                       |
|--------------|-----------------------------|
| Type         | `CNAME`                     |
| Name         | `geo`                       |
| Target       | `hpharmsen.github.io`       |
| Proxy status | **DNS only** (grijze wolk)  |
| TTL          | Auto                        |

> ⚠️ **Proxy uit zetten is verplicht.** Op "Proxied" (oranje wolk) onderschept
> Cloudflare de TLS-handshake en faalt GH Pages' cert-uitgifte stilzwijgend —
> symptoom: GH Pages blijft 24u op "Your site is being published" en
> `geo.harmsen.nl` serveert een Cloudflare 522/525.

Verificatie (1–10 min):

```bash
dig geo.harmsen.nl CNAME +short
# verwacht: hpharmsen.github.io.
```

Als er een rij IP-adressen verschijnt in plaats van de CNAME-target, staat de
proxy nog aan — zet 'm uit.

---

## 🟡 6. Wachten op het HTTPS-certificaat

In GitHub onder **Settings → Pages** verschijnt na een paar minuten:

> ✅ Your site is published at https://geo.harmsen.nl

Mediaan 5–15 min, p95 4 uur. Faalt het na 24 uur, dan ligt het meestal aan
DNS (Cloudflare-proxy) of CAA. Terug naar stap 5 / 0.

Wil je tussentijds testen via `https://hpharmsen.github.io/geo/`? Voeg die
origin dan tijdelijk toe in `~/Sites/harmsen.nl/.env`:

```env
GEO_CORS_ORIGINS=https://geo.harmsen.nl,https://hpharmsen.github.io
```

En `./publish.sh` opnieuw. Tijdelijke origin er weer afhalen zodra
`geo.harmsen.nl` werkt (Fase 6).

---

## 🟡 7. E2E-smoke

In een **incognito**-browser:

1. Open `https://geo.harmsen.nl`.
2. Vul een minimale meting in: 1 prompt, 1 run, kale modus.
3. Open DevTools → Network.
4. Verwacht: alle calls naar `https://harmsen.nl/api/geo/*`, response 200,
   **geen** CORS-fouten in de console.
5. Trigger een echte meting (met API-keys actief op Heroku) → rapport
   download-link verschijnt.

---

## ⏭️ 8. Pas dán: Fase 6 cleanup

Pas als bovenstaande E2E groen is, mag `~/proj/geo/` opgeschoond worden
(FastAPI-Python eruit, `static/*` naar root, README herschrijven). Zie het
plan, § Fase 6 — Claude doet dat dan in één pass.
