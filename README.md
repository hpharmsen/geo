# GEO-meter

Een webapp die meet hoe vindbaar een merk is in AI-modellen (ChatGPT, Perplexity,
Gemini, Claude). Je vult merkgegevens in → de app stelt schone vragen via de
AI-API's (meerdere runs per vraag) → je ziet **mention share**, **citatie share**
en **positie t.o.v. concurrenten**, plus een markdown-rapport.

👉 **Nieuw hier? Begin bij [`START-HIER.md`](START-HIER.md).**

**Eerlijk meten:** via de API (het "kale" model, schoon en reproduceerbaar),
zonder inloghistorie of geheugen. Elke vraag wordt meerdere keren gesteld en
gerapporteerd als frequentie ("genoemd in 4 van 5 runs").

## In het kort opzetten

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # vul je API-keys in (bij voorkeur alle vier)
uvicorn app:app --reload --port 8000
```

Open http://localhost:8000

Vul bij voorkeur **alle vier** de keys in — dan meet de app over alle grote AI's
(ChatGPT, Perplexity, Gemini, Claude) en krijg je het volledige beeld. Providers
zonder key vallen terug op demo (nep-antwoorden), en helemaal zonder keys draait
alles in demo-modus zodat je de interface kunt zien.

## Documentatie
- [`START-HIER.md`](START-HIER.md) — begin hier (ook zonder ervaring).
- [`docs/ACCOUNTS-EN-KEYS.md`](docs/ACCOUNTS-EN-KEYS.md) — API-keys regelen + kosten.
- [`docs/BRANDING.md`](docs/BRANDING.md) — eigen huisstijl of design overnemen.
- [`DEPLOY.md`](DEPLOY.md) — online zetten op Railway.
- [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md) — instructies voor de AI-assistent.

## Branding (in het kort)
- Teksten (naam, titel, introzin): `static/brand.js`
- Kleuren & lettertype: `static/theme.css`

## Structuur

```
app.py             FastAPI: endpoints + serveren frontend
geo/
  prompts.py       promptset genereren (categorie-gericht, geen merknaam)
  book_prompts.py  6 uitgebreide diepte-analyses
  providers.py     OpenAI / Perplexity / Gemini / Anthropic, met demo-fallback
  analyze.py       detectie per antwoord + aggregatie
  report.py        rapport.md bouwen
  engine.py        orkestratie: runs draaien, aggregeren, wegschrijven
static/
  index.html       frontend (formulier + resultaat)
  brand.js         jouw teksten/merknaam
  theme.css        kleuren + lettertype (het design)
data/              meetresultaten per meting-id (wordt automatisch aangemaakt)
```

## Veiligheid
Zet API-keys nooit in de code. Lokaal in `.env` (staat in `.gitignore`), online
als Railway-variable. `.env` en `API-keys-hier-invullen.txt` worden nooit
meegecommit.
