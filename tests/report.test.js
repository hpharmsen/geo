import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, aanbevelingen, _internal } from '../src/report.js';

const { _pct, _providerLabel, _boldMerk } = _internal;

const baseResult = () => ({
  merknaam: 'Acme',
  datum: '2026-06-25',
  modi: ['kaal'],
  modus_labels: { kaal: 'Kaal' },
  heeft_concurrenten: false,
  rows: [
    { provider: 'openai', modus: 'kaal', runs: 10, errors: 0,
      mention_share: 0.5, citatie_share: 0.2, gem_positie: null },
  ],
  totaal_per_modus: {
    kaal: { runs: 10, errors: 0, mention_share: 0.5, citatie_share: 0.2, gem_positie: null },
  },
  concurrenten_per_modus: { kaal: {} },
  antwoorden: [],
  promptset: [],
  runs_per_prompt: 5,
});

test('_pct: formats fractions als hele percentages', () => {
  assert.equal(_pct(0.5), '50%');
  assert.equal(_pct(0), '0%');
  assert.equal(_pct(1), '100%');
  assert.equal(_pct(null), 'n.v.t.');
  assert.equal(_pct(undefined), 'n.v.t.');
});

test('_providerLabel: bekende keys gemapped', () => {
  assert.equal(_providerLabel('openai'), 'ChatGPT (OpenAI)');
  assert.equal(_providerLabel('anthropic'), 'Claude (Anthropic)');
  assert.equal(_providerLabel('onbekend'), 'onbekend');
});

test('_boldMerk: wrapt elke voorkomende variant in **', () => {
  assert.equal(_boldMerk('Acme is goed, ACME ook.', 'Acme'),
    '**Acme** is goed, **ACME** ook.');
  assert.equal(_boldMerk('niets hier', 'Acme'), 'niets hier');
});

test('buildReport: bevat merknaam, datum en sectiekoppen', () => {
  const md = buildReport(baseResult());
  assert.match(md, /# GEO-zichtbaarheidsrapport — Acme/);
  assert.match(md, /Meting uitgevoerd op 2026-06-25/);
  assert.match(md, /## Wat is gemeten/);
  assert.match(md, /## Resultaat/);
  assert.match(md, /## Methodische noot/);
  assert.match(md, /Elke prompt is 5× schoon opnieuw gesteld/);
});

test('buildReport: demo-banner verschijnt alleen bij demo_modus', () => {
  const r = baseResult();
  assert.doesNotMatch(buildReport(r), /demo-modus/);
  r.demo_modus = true;
  assert.match(buildReport(r), /demo-modus/);
});

test('buildReport: zonder concurrenten geen positie-kolom in tabel', () => {
  const md = buildReport(baseResult());
  assert.match(md, /\| AI-model \| Runs \| Mention share \| Citatie share \|/);
  assert.doesNotMatch(md, /Gemiddelde positie/);
});

test('buildReport: met concurrenten positie-kolom + concurrenten-tabel', () => {
  const r = baseResult();
  r.heeft_concurrenten = true;
  r.rows[0].gem_positie = 1.5;
  r.totaal_per_modus.kaal.gem_positie = 1.5;
  r.concurrenten_per_modus.kaal = { BureauX: 0.3 };
  const md = buildReport(r);
  assert.match(md, /Gemiddelde positie/);
  assert.match(md, /Positie t\.o\.v\. concurrenten/);
  assert.match(md, /\| BureauX \| 30% \|/);
  assert.match(md, /\| Acme \*\(jij\)\* \| 50% \|/);
});

test('buildReport: meerdere modi geven sectiekoppen per modus', () => {
  const r = baseResult();
  r.modi = ['kaal', 'zoeken'];
  r.modus_labels = { kaal: 'Kaal', zoeken: 'Met zoeken' };
  r.totaal_per_modus.zoeken = { runs: 5, errors: 0, mention_share: 0.4, citatie_share: 0.1, gem_positie: null };
  r.concurrenten_per_modus.zoeken = {};
  r.rows.push({ provider: 'openai', modus: 'zoeken', runs: 5, errors: 0,
    mention_share: 0.4, citatie_share: 0.1, gem_positie: null });
  const md = buildReport(r);
  assert.match(md, /## Kaal/);
  assert.match(md, /## Met zoeken/);
});

test('buildReport: book-analyses verschijnen als boek_analyses gevuld is', () => {
  const r = baseResult();
  r.boek_analyses = [
    { titel: '1. GEO-profiel', uitleg: 'check', prompt: 'analyseer X', antwoord: 'hier komt antwoord' },
  ];
  r.boek_model = 'gpt-4o (OpenAI)';
  const md = buildReport(r);
  assert.match(md, /## Diepte-analyses/);
  assert.match(md, /### 1\. GEO-profiel/);
  assert.match(md, /uitgevoerd door gpt-4o voor Acme/);
  assert.match(md, /hier komt antwoord/);
});

test('aanbevelingen: lage mention share -> entiteit-signaal advies', () => {
  const out = aanbevelingen(
    { mention_share: 0.1, citatie_share: 0.1 }, {}, 'Acme');
  assert.match(out[0], /Vergroot je entiteit-signaal/);
  assert.match(out[1], /Maak je content citeerbaar/);
});

test('aanbevelingen: sterkste concurrent benoemd als die boven mention zit', () => {
  const out = aanbevelingen(
    { mention_share: 0.3, citatie_share: 0.5 },
    { BureauX: 0.6, BureauY: 0.2 }, 'Acme');
  const text = out.join('\n');
  assert.match(text, /Analyseer BureauX/);
  assert.doesNotMatch(text, /Analyseer BureauY/);
});
