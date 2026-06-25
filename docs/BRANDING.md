# Branding — jouw huisstijl op de GEO-meter

Je hebt drie keuzes:

- **A. Het standaard-design overnemen** — niets doen, of alleen je naam/teksten
  aanpassen. Snel klaar.
- **B. Je eigen huisstijl** — eigen kleuren, lettertype en teksten.
- **C. Een design uit Claude Design overnemen** — heb je al een design gemaakt in
  Claude Design? Stuur het met één klik naar Claude Code, dan neemt die de look in
  één keer over (zie onderaan). Dit is de snelste route naar je eigen stijl.

Er zijn maar **twee bestanden** die de look bepalen:

| Wat | Bestand |
|---|---|
| Teksten (naam, titel, introzin, voorbeelden) | `static/brand.js` |
| Kleuren & lettertype | `static/theme.css` |

---

## A. Standaard-design overnemen

Open `static/brand.js` en pas alleen de teksten aan tussen de "aanhalingstekens":

- `eyebrow` — klein label bovenaan (bv. je bureaunaam). Leeg = verbergen.
- `titel` + `titelAccent` — de grote kop. `titelAccent` krijgt je accentkleur.
- `tagline` — de introzin onder de titel.
- `paginaTitel` — wat in de browser-tab staat.
- `voorbeeldMerk` / `voorbeeldWebsite` — de grijze hint-tekst in de velden.

Sla op en herlaad de pagina. Klaar.

> Wil je ook het rapport-kopje aanpassen? Zet op de server (Railway) een variable
> `GEO_ANALYSE_TITEL` met de gewenste titel (bv. "Mijn GEO-analyses").

---

## B. Je eigen huisstijl

### Snelste manier: laat Claude het doen
Plak deze prompt in je AI-assistent (in deze map), en vul je eigen gegevens in:

```
Pas de huisstijl van deze GEO-meter aan naar mijn merk.
- Merknaam: <jouw merknaam>
- Accentkleur (knoppen/links): <hex, bv. #E71674>
- Donkere kleur (header): <hex, bv. #19008F>
- Lettertype koppen: <bv. Poppins>
- Lettertype tekst: <bv. Inter>
- Introzin: <optioneel jouw eigen zin>

Werk hiervoor `static/theme.css` (kleuren + lettertype, ook de Google Fonts-
import bovenin) en `static/brand.js` (teksten) bij. Houd het contrast goed
leesbaar. Toon me daarna het resultaat lokaal.
```

### Of zelf, met de hand
In `static/theme.css`:
- **Kleuren:** pas onder "Brand colors" de `--indigo-*` (donker) en `--pink-*`
  (accent) waarden aan naar jouw hex-codes. De rest van de app gebruikt deze
  automatisch.
- **Lettertype:** verander de `@import`-regel bovenaan (de Google Fonts-link) en
  de `--font-display` / `--font-body` waarden.

In `static/brand.js`: je teksten (zie deel A).

### Een logo gebruiken?
Standaard is de header tekst-gebaseerd (geen logo nodig). Wil je een logo-afbeelding
tonen, vraag dat dan aan de AI-assistent — die voegt het netjes in de header toe.
Vervang ook `static/favicon.png` door je eigen favicon (klein vierkant icoontje).

---

## C. Een design uit Claude Design overnemen

Heb je je huisstijl al uitgewerkt in **Claude Design**? Dan hoef je niets over te
typen — je stuurt het design naar je AI-assistent en die neemt het over.

### Gebruik je Claude Code? (de makkelijkste manier)
1. Open je design in **Claude Design**.
2. Klik rechtsboven op **Share → Send to… → Claude Code**
   ("Hand off the project to your terminal").
3. Je design komt nu bij Claude Code binnen. Zeg dan tegen de assistent:

   ```
   Neem de huisstijl van dit Claude Design-project over in de GEO-meter:
   vertaal de kleuren, het lettertype en de stijl naar static/theme.css, en de
   naam/teksten/logo naar static/brand.js. Toon me daarna het resultaat lokaal.
   ```

### Gebruik je Codex of een andere assistent?
Claude Design en de "Send to… → Claude Code"-knop horen bij Claude Code — werk je
met Codex, dan heb je Claude Design waarschijnlijk niet. Gebruik dan gewoon
**route B** hierboven: geef je merkkleuren, lettertype en logo aan je assistent,
dan bouwt die het design in `static/theme.css` + `static/brand.js`.

## Controleren
Start lokaal (`uvicorn app:app --reload --port 8000`), open `http://localhost:8000`
en bekijk of kleuren, lettertype en teksten kloppen — ook op een smal
(telefoon-)scherm.
