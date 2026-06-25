// Parity-test stap 2: lees tests/parity/raw.json (gemaakt door run.py),
// run dezelfde pipeline door static/analyze.js + static/report.js, en
// schrijf tests/parity/js_report.md. Vergelijk daarna met python_report.md.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeAnswer,
  rowsPerProviderModus,
  totalsPerModus,
  competitorSharesPerModus,
  answersDrilldown,
} from '../../static/analyze.js';
import { buildReport } from '../../static/report.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(join(HERE, 'raw.json'), 'utf-8'));
const { config, datum, raw_answers } = raw;

const perRun = raw_answers.map(a => ({
  ...a,
  analysis: analyzeAnswer(a.text, config.merknaam, config.concurrenten, config.url, a.sources),
}));

const result = {
  merknaam: config.merknaam,
  url: config.url,
  categorie: config.categorie,
  markt: config.markt,
  taal: config.taal,
  datum,
  demo_modus: raw_answers.some(a => a.is_demo),
  runs_per_prompt: config.runs_per_prompt,
  promptset: config.prompts,
  modus: config.modus,
  modi: [config.modus],
  modus_labels: { kaal: 'Uit het geheugen' },
  heeft_concurrenten: config.concurrenten.length > 0,
  rows: rowsPerProviderModus(perRun),
  totaal_per_modus: totalsPerModus(perRun),
  concurrenten_per_modus: competitorSharesPerModus(perRun, config.concurrenten),
  antwoorden: answersDrilldown(perRun),
  boek_analyses: [],
  boek_model: null,
};

const md = buildReport(result);
writeFileSync(join(HERE, 'js_report.md'), md);
console.log(`Geschreven: js_report.md (${md.length} bytes)`);
