# 👋 Start hier

Welkom! Met dit pakket zet je je eigen **GEO-meter** op: een tool die meet hoe
vaak AI-modellen (ChatGPT, Perplexity, Gemini, Claude) een merk noemen. Je kunt
het je eigen huisstijl geven en online zetten voor jezelf of je klanten.

Je hebt **geen programmeerervaring nodig.** Een AI-assistent doet het werk; jij
hoeft alleen wat te klikken en je eigen sleutels te plakken.

---

## De makkelijkste manier (aanbevolen): laat een AI het doen

1. **Pak deze map uit** (als je een ZIP hebt gekregen) op je computer.
2. Open de map in **Claude Code** (of Codex / Cursor — een AI-assistent die mee
   kan kijken in bestanden).
3. Typ in het gesprek:

   > *"Lees START-HIER en CLAUDE.md en help me deze GEO-meter stap voor stap
   > opzetten. Ik heb weinig technische ervaring."*

4. De AI leidt je dan door alles heen: installeren, je merk erop zetten, testen,
   en online zetten. Hij stopt alleen om jóu te vragen: een account aanmaken,
   inloggen, of een sleutel plakken.

> Heb je nog geen Claude Code? Het is een gratis te installeren hulpmiddel —
> zoek op "Claude Code installeren". Daarna open je deze map en begin je het
> gesprek hierboven.

---

## Wat je onderweg nodig hebt

- **AI-sleutels (API-keys)** om te meten — bij voorkeur alle vier (OpenAI,
  Perplexity, Gemini, Claude), want dan meet je over alle grote AI's en krijg je
  het volledige beeld. Aanmaken kost een paar minuten; uitleg in
  [`docs/ACCOUNTS-EN-KEYS.md`](docs/ACCOUNTS-EN-KEYS.md). *Nog geen sleutel? Dan
  bekijk je de tool in "demo-modus" (nep-cijfers, gratis) om te oefenen.*
- **Een gratis Railway-account** om de tool online te zetten (stap-voor-stap in
  [`DEPLOY.md`](DEPLOY.md)).

## Wat het ongeveer kost
- De tool zelf is gratis. Railway heeft een gratis/goedkope start.
- Je betaalt alleen klein AI-verbruik per meting (een paar (euro)centen tot enkele
  tientjes per maand, afhankelijk van hoeveel je meet). Details in
  [`docs/ACCOUNTS-EN-KEYS.md`](docs/ACCOUNTS-EN-KEYS.md).

## Liever zelf, zonder AI?
Dat kan ook — lees dan in deze volgorde: [`README.md`](README.md) →
[`docs/ACCOUNTS-EN-KEYS.md`](docs/ACCOUNTS-EN-KEYS.md) →
[`docs/BRANDING.md`](docs/BRANDING.md) → [`DEPLOY.md`](DEPLOY.md).

---

### 🔒 Belangrijk over je sleutels
Je API-sleutels zijn als wachtwoorden. Zet ze **nooit** in de code of online op
een openbare plek. In dit pakket horen ze alleen in `.env` (lokaal) of als
"Variable" in Railway. De AI-assistent let hier ook op.
