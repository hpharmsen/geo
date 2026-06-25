#!/usr/bin/env python3
"""Parity-test stap 1: doe 10 echte LLM-calls naar de Django-API, render
het markdown-rapport via geo/analyze.py + geo/report.py, en schrijf:

  - raw.json          : 10 antwoorden (geen analysis), plus de config-metadata
                        zodat run.mjs identiek dezelfde state opbouwt.
  - python_report.md  : output van geo/report.py op de analyzed result.

Daarna runt run.mjs hetzelfde door static/analyze.js + static/report.js
en levert js_report.md op. Diff moet leeg zijn.

Gebruik:
  cd ~/proj/geo
  source ~/Sites/harmsen.nl-geo/.venv/bin/activate  # of zet PYTHONPATH zelf
  python tests/parity/run.py
"""

import json
import os
import sys
from datetime import date
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from geo import analyze as analyze_mod
from geo import report as report_mod

API = os.environ.get('GEO_API_BASE', 'http://127.0.0.1:8080/api/geo')
OUT = Path(__file__).resolve().parent

CONFIG = {
    'merknaam': 'Acme Marketing',
    'url': 'https://acme-marketing.example',
    'categorie': 'marketingbureau',
    'markt': 'Utrecht',
    'taal': 'nl',
    'concurrenten': ['BureauX', 'BureauY'],
    'modus': 'kaal',
    'runs_per_prompt': 2,
    # Vaste promptset zodat dezelfde tekst → zelfde teksten (deterministisch m.b.t. selectie).
    'prompts': [
        'Wat is de beste marketingbureau in Utrecht?',
        'Welke marketingbureau raad je aan?',
        'Wat zijn de top 5 aanbieders van marketingbureau?',
        'Wat is een goed alternatief voor BureauX?',
        'Vergelijk de belangrijkste aanbieders van marketingbureau.',
    ],
    'providers': ['openai', 'anthropic'],  # bewust 2 betalende providers
}


def call_run(client, provider, prompt):
    resp = client.post(API + '/run', json={
        'provider': provider, 'prompt': prompt, 'search': False,
        'max_tokens': 200,  # bescheiden voor parity-kosten
        'merknaam': CONFIG['merknaam'],
        'concurrenten': CONFIG['concurrenten'],
    }, timeout=60.0)
    resp.raise_for_status()
    return resp.json()


def main():
    raw_answers = []
    # Plan: 5 prompts × 2 runs = 10 calls. Alterneer providers zodat we beide
    # in de fixture hebben.
    plan = []
    for prompt in CONFIG['prompts']:
        for run_i in range(CONFIG['runs_per_prompt']):
            provider = CONFIG['providers'][run_i % len(CONFIG['providers'])]
            plan.append((provider, prompt))
    print(f'Plan: {len(plan)} calls naar {API}')

    with httpx.Client() as client:
        for i, (provider, prompt) in enumerate(plan, 1):
            print(f'  [{i:2d}/10] {provider:10s} | {prompt[:50]}...', end=' ', flush=True)
            r = call_run(client, provider, prompt)
            print(f"\\${r.get('cost_usd'):.5f}  is_demo={r.get('is_demo')}")
            raw_answers.append({
                'provider': provider,
                'modus': CONFIG['modus'],
                'prompt': prompt,
                'text': (r.get('text') or '')[:4000],
                'sources': r.get('sources') or [],
                'is_demo': r.get('is_demo', False),
                'error': r.get('error'),
            })

    # Datum vastpinnen zodat JS dezelfde gebruikt.
    fixed_date = date.today().isoformat()

    # Bouw per_run met Python analyze.py.
    per_run = []
    for a in raw_answers:
        analysis = analyze_mod.analyze_answer(
            a['text'], CONFIG['merknaam'], CONFIG['concurrenten'],
            CONFIG['url'], sources=a['sources'])
        per_run.append({**a, 'analysis': analysis})

    rows = analyze_mod.rows_per_provider_modus(per_run)
    totaal = analyze_mod.totals_per_modus(per_run)
    concs = analyze_mod.competitor_shares_per_modus(per_run, CONFIG['concurrenten'])
    antwoorden = analyze_mod.answers_drilldown(per_run)

    result = {
        'merknaam': CONFIG['merknaam'],
        'url': CONFIG['url'],
        'categorie': CONFIG['categorie'],
        'markt': CONFIG['markt'],
        'taal': CONFIG['taal'],
        'datum': fixed_date,
        'demo_modus': any(a.get('is_demo') for a in raw_answers),
        'runs_per_prompt': CONFIG['runs_per_prompt'],
        'promptset': CONFIG['prompts'],
        'modus': CONFIG['modus'],
        'modi': [CONFIG['modus']],
        'modus_labels': {'kaal': 'Uit het geheugen'},
        'heeft_concurrenten': bool(CONFIG['concurrenten']),
        'rows': rows,
        'totaal_per_modus': totaal,
        'concurrenten_per_modus': concs,
        'antwoorden': antwoorden,
        'boek_analyses': [],
        'boek_model': None,
    }

    rapport = report_mod.build_report(result)

    (OUT / 'raw.json').write_text(json.dumps({
        'config': CONFIG,
        'datum': fixed_date,
        'raw_answers': raw_answers,
    }, ensure_ascii=False, indent=2))
    (OUT / 'python_report.md').write_text(rapport, encoding='utf-8')
    print(f'\nGeschreven: raw.json ({len(raw_answers)} antwoorden), python_report.md ({len(rapport)} bytes)')


if __name__ == '__main__':
    main()
