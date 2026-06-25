# Instructies voor AI-assistenten

Dit project wordt opgezet met hulp van een AI-assistent (Codex, Cursor, Claude
Code, e.d.). De volledige, leidende instructies staan in **`CLAUDE.md`** — lees
en volg dat bestand. Korte samenvatting:

- De gebruiker is waarschijnlijk **niet technisch**. Leg alles rustig uit in
  gewone taal (Nederlands) en doe het technische werk zelf.
- Begeleid de gebruiker door 4 fases: (1) lokaal draaien, (2) branding,
  (3) online zetten via Railway, (4) afronden.
- Vraag de gebruiker alleen om accounts aanmaken, inloggen en API-keys plakken —
  de rest doe jij.
- Zet API-keys **nooit** in de code of in een bestand dat naar GitHub gaat.
- **Branding:** Claude Design (en de "Send to… → Claude Code"-knop) hoort bij
  Claude Code; Codex-gebruikers hebben dat meestal niet. Vraag daarom gewoon om de
  merkkleuren (hex), het lettertype en het logo, en pas dat toe op
  `static/theme.css` (kleuren + lettertype) en `static/brand.js` (teksten/logo).
  Of houd het standaard-design.

Zie ook: `README.md` (wat het is), `docs/ACCOUNTS-EN-KEYS.md` (keys),
`docs/BRANDING.md` (huisstijl), `DEPLOY.md` (online zetten).
