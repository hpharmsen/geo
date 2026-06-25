# GEO-meter online zetten (op Railway)

We zetten de tool online op **Railway** — dat kan Python aan, is goedkoop, en je
keys bewaar je daar veilig als "Variables" (nooit in de code).

**Geen database nodig.** De app toont elke meting direct en het rapport kun je
kopiëren/downloaden. Bij een herstart verdwijnen oude metingen — dat mag.

> 💡 Laat je dit liever door de AI-assistent doen? Open deze map in Claude Code
> en zeg: *"help me deze GEO-meter op Railway zetten."* Hij doet de stappen en
> stopt alleen om je te laten inloggen of een key te plakken.

---

## 0. Wat je nodig hebt
- Een **GitHub**-account (gratis) — om de code te bewaren.
- Een **Railway**-account (gratis) — https://railway.app (inloggen met GitHub kan).
- Je **API-keys** (zie `docs/ACCOUNTS-EN-KEYS.md`) — bij voorkeur alle vier.

> ⚠️ Je keys gaan **nooit** mee in de code. `.env` en `API-keys-hier-invullen.txt`
> staan in `.gitignore` en worden niet meegestuurd. Op Railway zet je ze als
> Variables (stap 3).

---

## 1. Code naar GitHub
Open een terminal in deze map en voer uit:

```bash
git init
git add .
git commit -m "GEO-meter"
```

Maak op github.com een nieuwe (lege) repository aan en koppel:

```bash
git remote add origin https://github.com/<jouw-naam>/geo-meter.git
git branch -M main
git push -u origin main
```

> Geen zin in de terminal? Op github.com kun je ook **"uploading an existing
> file"** gebruiken en de bestanden erin slepen. Sleep dan **niet** `.env` of
> `API-keys-hier-invullen.txt` mee.

Controleer op GitHub dat `.env` en `API-keys-hier-invullen.txt` er **niet** staan.

---

## 2. Project aanmaken op Railway
1. Railway → **New Project** → **Deploy from GitHub repo** → kies je repo.
2. Railway detecteert Python automatisch (`Procfile` + `runtime.txt` staan klaar).
   Je hoeft build-/startcommando's meestal niet zelf in te stellen.
   - *Mocht het nodig zijn:* Start command = `uvicorn app:app --host 0.0.0.0 --port $PORT`

---

## 3. Je API-keys als Variables zetten
1. Open je service → tabblad **Variables** → **New Variable**.
2. Voeg toe wat je hebt (alleen de keys die je gebruikt):
   - `OPENAI_API_KEY` = `sk-...`
   - `PERPLEXITY_API_KEY` = `pplx-...`
   - `GEMINI_API_KEY` = `...`
   - `ANTHROPIC_API_KEY` = `sk-ant-...`
   - *(optioneel)* `GEO_ANALYSE_TITEL` = een eigen kopje boven de analyses.
3. Railway redeployt automatisch na het opslaan.

---

## 4. Een webadres aanzetten
1. Service → **Settings** → **Networking** → **Generate Domain**.
2. Je krijgt een URL als `https://geo-meter-production-xxxx.up.railway.app`.
3. Test:
   - `/` → het formulier verschijnt.
   - `/api/health` → laat zien welke providers actief zijn (de keys die je zette).

> Eigen (sub)domein koppelen kan ook: **Settings → Networking → Custom Domain**.
> Railway geeft je een CNAME-doel dat je bij je domeinprovider invult.

---

## 5. Goed om te weten
- **Demo-modus:** zonder keys (of voor providers zonder key) toont de app
  nep-cijfers — handig om te demonstreren zonder kosten.
- **Logs bekijken:** in Railway onder **Deployments → Logs**, of open `…/api/logs`
  in de browser. Er staan **geen** API-keys in de logs.
- **Kosten temmen:** meet met minder providers/runs, en stel uitgavenlimieten in
  bij elke AI-provider.
- **Keys wisselen:** verander gewoon de Variable in Railway; de oude key kun je
  bij de provider intrekken.
