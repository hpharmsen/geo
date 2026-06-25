# Accounts & API-keys — stap voor stap

Om te meten heeft de tool **API-keys** nodig — bij voorkeur alle vier. Een key is
een soort wachtwoord waarmee de tool namens jou een AI-model mag bevragen. Je
betaalt dan per gebruik (een paar centen per meting).

> **Aanrader: regel alle vier.** De tool meet over de vier grote AI's — ChatGPT
> (OpenAI), Perplexity, Gemini en Claude. Met alle vier krijg je het volledige,
> eerlijke beeld van je AI-zichtbaarheid; dat is precies de kracht van deze tool.
>
> Mist een key? Dan valt alleen díe provider terug op demo (nep-cijfers) en blijft
> de rest gewoon werken — handig om eerst te oefenen, maar voor echte cijfers wil
> je ze alle vier. Helemaal zonder key draait alles in demo-modus.

Goed om te weten: **Google Gemini** heeft een gratis niveau; bij OpenAI,
Perplexity en Anthropic waardeer je wat tegoed op.

---

## 🔑 Waar vind je elke key?

### 1. OpenAI (ChatGPT) — `OPENAI_API_KEY`
1. Ga naar **platform.openai.com** en log in (of maak een account).
2. Klik rechtsboven op je naam → **View API keys** (of ga naar
   *platform.openai.com/api-keys*).
3. **Create new secret key** → geef 'm een naam → kopieer de key (begint met `sk-`).
   > Je ziet de key maar één keer — kopieer 'm meteen.
4. Zorg dat er **tegoed** staat: *Settings → Billing → Add credits* (bv. €5–10).

### 2. Perplexity — `PERPLEXITY_API_KEY`
1. Ga naar **perplexity.ai** en log in.
2. **Settings → API** (of *perplexity.ai/settings/api*).
3. Koop wat tegoed en klik **Generate** → kopieer de key (begint met `pplx-`).

### 3. Google Gemini — `GEMINI_API_KEY`  *(heeft gratis niveau)*
1. Ga naar **aistudio.google.com** en log in met je Google-account.
2. Klik **Get API key** → **Create API key**.
3. Kopieer de key.

### 4. Anthropic (Claude) — `ANTHROPIC_API_KEY`
1. Ga naar **console.anthropic.com** en log in (of maak een account).
2. **Settings → API Keys** → **Create Key** → kopieer de key (begint met `sk-ant-`).
3. Voeg tegoed toe onder **Billing** (bv. €5).

---

## Waar zet je de keys?

**Lokaal testen (op je eigen computer):** in een bestand `.env` in deze map.
Kopieer `.env.example` naar `.env` en vul je key(s) in. (Of gebruik het
zichtbare bestand `API-keys-hier-invullen.txt` — ook prima. Beide blijven op je
computer en gaan nooit naar GitHub.)

**Online (Railway):** als **Variables** in je Railway-project — zie `DEPLOY.md`.
Nooit in de code zetten.

> Laat de AI-assistent dit gerust voor je doen; je hoeft alleen de key te plakken.

---

## Wat kost het?

- **De tool en de software:** gratis.
- **Railway (hosting):** een gratis/goedkoop startniveau; voor een drukke
  trainingsdag kun je tijdelijk een betaald niveau (~$5–7) kiezen zodat het snel
  blijft.
- **AI-verbruik per meting:** afhankelijk van het aantal vragen, runs en
  providers. Reken op grofweg **enkele centen tot een paar tientjes per maand**
  bij normaal gebruik. De tool gebruikt waar mogelijk goedkope, snelle modellen.
- **Tip:** wil je kosten laag houden zónder providers te laten vallen? Zet "runs
  per vraag" op 3 i.p.v. 5, meet wat minder vaak, en gebruik de demo-modus om de
  interface te demonstreren.

> Stel bij elke provider een **uitgavenlimiet** in (in hun billing-instellingen),
> dan kun je nooit voor verrassingen komen te staan.
