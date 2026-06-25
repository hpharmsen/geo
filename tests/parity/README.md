# Parity-test: Python `report.py` vs JS `report.js`

Bewijst dat `static/analyze.js` + `static/report.js` byte-identieke output
produceren als `geo/analyze.py` + `geo/report.py`, op echte LLM-antwoorden.

## Hoe

1. **`run.py`** doet 10 echte calls naar `http://127.0.0.1:8080/api/geo/run`
   (5 prompts × 2 providers: openai, anthropic, `max_tokens=200` per call,
   ~$0.015 totaal). Het schrijft:
   - `raw.json` — config + 10 raw antwoorden zonder analysis
   - `python_report.md` — rendering door `geo/analyze.py` + `geo/report.py`
2. **`run.mjs`** leest `raw.json`, run de pipeline door `static/analyze.js` +
   `static/report.js`, schrijft `js_report.md`.
3. `cmp python_report.md js_report.md` moet exit 0 geven.

## Voorwaarden

- Django-backend draait (`cd ~/Sites/harmsen.nl-geo && bash runlocal.sh`).
- `OPENAI_API_KEY` en `ANTHROPIC_API_KEY` gezet (in `.env` van de backend).
- `GEO_IP_HOURLY_LIMIT` ≥ 10 (default 5 is te laag voor 10 calls).
- Python venv heeft `httpx` (de backend-venv volstaat).

## Uitvoeren

```bash
cd ~/proj/geo
/Users/hp/Sites/harmsen.nl-geo/.venv/bin/python tests/parity/run.py
node tests/parity/run.mjs
cmp tests/parity/python_report.md tests/parity/js_report.md && echo "parity OK"
```

## Wanneer opnieuw

Loop deze parity-test elke keer als:

- `analyze.py` of `analyze.js` aangepast wordt
- `report.py` of `report.js` aangepast wordt
- Een bug ontdekt wordt waardoor de twee implementaties uit elkaar lopen

Na Fase 6 (FastAPI weggegooid) is deze test obsoleet — verwijderen samen
met `geo/` en `run.py`.

## Bekend gedrag

- Python `round(x, n)` doet half-naar-even (banker's); JS `Math.round`
  doet half-naar-boven. `analyze.js` heeft een eigen `_pyRound()` die
  het Python-gedrag matched.
- `report.py` leest `GEO_ANALYSE_TITEL` env-var; `report.js` heeft die
  als string-default 'Diepte-analyses'. Als je de env-var gebruikt, geef
  hem dan ook mee in `result.analyse_titel` in JS.
