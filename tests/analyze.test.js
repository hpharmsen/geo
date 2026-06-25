import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeAnswer,
  rowsPerProviderModus,
  totalsPerModus,
  answersDrilldown,
  competitorSharesPerModus,
  _internal,
} from '../static/analyze.js';

const { _norm, _domain, _namePresent, _pyRound } = _internal;

// --- detectie ---------------------------------------------------------------

test('mention_detection_eenvoudig: merknaam in tekst -> mentioned=true', () => {
  const r = analyzeAnswer(
    'Acme is een goede keuze in deze categorie.',
    'Acme', [], 'https://acme.nl');
  assert.equal(r.mentioned, true);
  assert.equal(r.position, 1);
});

test('mention_detection_negatief: merknaam ontbreekt -> mentioned=false', () => {
  const r = analyzeAnswer(
    'Er zijn vele aanbieders, maar geen specifieke uitspringer.',
    'Acme', [], 'https://acme.nl');
  assert.equal(r.mentioned, false);
  assert.equal(r.position, null);
});

test('mention is hele-woord (geen substring-match)', () => {
  const r = analyzeAnswer('Academia is iets anders', 'Aca', [], '');
  assert.equal(r.mentioned, false);
});

test('mention case-insensitief', () => {
  const r = analyzeAnswer('ACME levert prima diensten.', 'acme', [], '');
  assert.equal(r.mentioned, true);
});

test('mention met spaties in merknaam', () => {
  const r = analyzeAnswer('Bij Ad Architect kun je goed terecht.',
    'Ad Architect', [], '');
  assert.equal(r.mentioned, true);
});

// --- positie ---------------------------------------------------------------

test('positie 2 wanneer concurrent eerst genoemd is', () => {
  const r = analyzeAnswer(
    'BureauX is bekend, en ook Acme is een optie.',
    'Acme', ['BureauX'], '');
  assert.equal(r.mentioned, true);
  assert.equal(r.position, 2);
  assert.deepEqual(r.competitors_present, ['BureauX']);
});

test('positie 1 wanneer merk eerst genoemd is', () => {
  const r = analyzeAnswer(
    'Acme komt eerst, daarna BureauX en BureauY.',
    'Acme', ['BureauX', 'BureauY'], '');
  assert.equal(r.position, 1);
  assert.deepEqual(r.competitors_present, ['BureauX', 'BureauY']);
});

// --- citation -------------------------------------------------------------

test('citation_share_url_match: bron-URL matcht merk-URL -> cited=true', () => {
  const r = analyzeAnswer(
    'Acme heeft een goede dienst.', 'Acme', [],
    'https://acme.nl', ['https://www.acme.nl/diensten']);
  assert.equal(r.cited, true);
});

test('citation false wanneer domein nergens voorkomt', () => {
  const r = analyzeAnswer(
    'Acme heeft een goede dienst.', 'Acme', [],
    'https://acme.nl', ['https://andere.nl/diensten']);
  assert.equal(r.cited, false);
});

test('citation via domein in tekst zelf', () => {
  const r = analyzeAnswer(
    'Zie https://acme.nl/over-ons voor meer info.', 'Acme', [],
    'https://acme.nl');
  assert.equal(r.cited, true);
});

// --- helpers ------------------------------------------------------------

test('_domain strip www. prefix', () => {
  assert.equal(_domain('https://www.acme.nl/x'), 'acme.nl');
  assert.equal(_domain('acme.nl'), 'acme.nl');
  assert.equal(_domain('https://acme.nl'), 'acme.nl');
  assert.equal(_domain(''), '');
});

test('_norm: lowercase + collapse whitespace', () => {
  assert.equal(_norm('  HELLO  \n\tWorld '), 'hello world');
  assert.equal(_norm(null), '');
});

test('_pyRound: half-naar-even zoals Python', () => {
  // Klassieke banker's-rounding voorbeelden
  assert.equal(_pyRound(0.5, 0), 0);
  assert.equal(_pyRound(1.5, 0), 2);
  assert.equal(_pyRound(2.5, 0), 2);
  // Veelvoorkomende deelresultaten
  assert.equal(_pyRound(1 / 3, 3), 0.333);
  assert.equal(_pyRound(2 / 3, 3), 0.667);
  // 0.5 → 0.5 (geen wijziging)
  assert.equal(_pyRound(0.5, 3), 0.5);
});

// --- aggregatie ---------------------------------------------------------

test('rows_aggregatie: mention/citation share over geslaagde runs', () => {
  const perRun = [
    // ChatGPT (openai), kaal, 3 runs: 2 mentions, 1 cite
    { provider: 'openai', modus: 'kaal', prompt: 'p1', text: 'Acme is goed.',
      analysis: { mentioned: true, position: 1, competitors_present: [], cited: true } },
    { provider: 'openai', modus: 'kaal', prompt: 'p1', text: 'Acme weer.',
      analysis: { mentioned: true, position: 1, competitors_present: [], cited: false } },
    { provider: 'openai', modus: 'kaal', prompt: 'p1', text: 'Geen genoemd.',
      analysis: { mentioned: false, position: null, competitors_present: [], cited: false } },
    // Anthropic, kaal: 1 ok + 1 fail
    { provider: 'anthropic', modus: 'kaal', prompt: 'p1', text: 'Acme.',
      analysis: { mentioned: true, position: 1, competitors_present: [], cited: false } },
    { provider: 'anthropic', modus: 'kaal', prompt: 'p1', error: 'timeout' },
  ];
  const rows = rowsPerProviderModus(perRun);
  assert.equal(rows.length, 2);

  const openai = rows.find(r => r.provider === 'openai');
  assert.equal(openai.runs, 3);
  assert.equal(openai.errors, 0);
  assert.equal(openai.mention_share, 0.667);
  assert.equal(openai.citatie_share, 0.333);

  const anthropic = rows.find(r => r.provider === 'anthropic');
  assert.equal(anthropic.runs, 1);
  assert.equal(anthropic.errors, 1);
  assert.equal(anthropic.mention_share, 1.0);
});

test('totals_per_modus: aggregeert over providers per modus', () => {
  const perRun = [
    { provider: 'openai', modus: 'kaal', prompt: 'p1',
      analysis: { mentioned: true, position: 1, competitors_present: [], cited: false } },
    { provider: 'openai', modus: 'zoeken', prompt: 'p1',
      analysis: { mentioned: false, position: null, competitors_present: [], cited: false } },
    { provider: 'anthropic', modus: 'kaal', prompt: 'p1',
      analysis: { mentioned: true, position: 1, competitors_present: [], cited: false } },
  ];
  const tot = totalsPerModus(perRun);
  assert.equal(tot.kaal.runs, 2);
  assert.equal(tot.kaal.mention_share, 1.0);
  assert.equal(tot.zoeken.mention_share, 0.0);
});

test('answers_drilldown kiest representatief antwoord waar merk genoemd is', () => {
  const perRun = [
    { provider: 'openai', modus: 'kaal', prompt: 'p1', text: 'geen',
      analysis: { mentioned: false, position: null, competitors_present: [], cited: false } },
    { provider: 'openai', modus: 'kaal', prompt: 'p1', text: 'WEL Acme',
      analysis: { mentioned: true, position: 1, competitors_present: [], cited: false } },
  ];
  const dd = answersDrilldown(perRun);
  assert.equal(dd.length, 1);
  assert.equal(dd[0].runs, 2);
  assert.equal(dd[0].mentioned_count, 1);
  assert.equal(dd[0].voorbeeld_text, 'WEL Acme');
  assert.equal(dd[0].voorbeeld_mentioned, true);
});

test('competitor_shares_per_modus: per concurrent per modus', () => {
  const perRun = [
    { provider: 'openai', modus: 'kaal', prompt: 'p1',
      analysis: { mentioned: false, competitors_present: ['BureauX'] } },
    { provider: 'openai', modus: 'kaal', prompt: 'p1',
      analysis: { mentioned: false, competitors_present: ['BureauX', 'BureauY'] } },
    { provider: 'openai', modus: 'kaal', prompt: 'p1',
      analysis: { mentioned: false, competitors_present: [] } },
  ];
  const shares = competitorSharesPerModus(perRun, ['BureauX', 'BureauY']);
  assert.equal(shares.kaal.BureauX, 0.667);
  assert.equal(shares.kaal.BureauY, 0.333);
});

test('lege input -> nul-aggregatie', () => {
  const tot = totalsPerModus([]);
  assert.deepEqual(tot, {});
  const rows = rowsPerProviderModus([]);
  assert.deepEqual(rows, []);
});

test('_namePresent: lege merknaam -> false', () => {
  assert.equal(_namePresent('elke tekst', ''), false);
  assert.equal(_namePresent('elke tekst', null), false);
});
