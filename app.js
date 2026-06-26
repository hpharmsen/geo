// Glue: formulier → /api/geo/prompts → queue (6 parallel) → analyse → rapport.
// Houdt index.html dom; alle LLM-tekst gaat via textContent (XSS).

import { runQueue, CallError } from './queue.js';
import { api } from './api.js';
import {
  analyzeAnswer,
  rowsPerProviderModus,
  totalsPerModus,
  answersDrilldown,
  competitorSharesPerModus,
} from './analyze.js';
import { buildReport } from './report.js';

const PROVIDER_LABEL = {
  openai: 'ChatGPT (OpenAI)',
  perplexity: 'Perplexity',
  gemini: 'Gemini (Google)',
  anthropic: 'Claude (Anthropic)',
};
const MODUS_LABELS = { kaal: 'Uit het geheugen', zoeken: 'Met live zoeken' };
const MODUS_PLAN = {
  kaal: [['kaal', false]],
  zoeken: [['zoeken', true]],
  beide: [['kaal', false], ['zoeken', true]],
};
const BOOK_PROVIDER_ORDER = ['openai', 'anthropic', 'perplexity', 'gemini'];
const BOOK_LABEL = {
  openai: 'ChatGPT', anthropic: 'Claude', perplexity: 'Perplexity', gemini: 'Gemini',
};

const $ = (id) => document.getElementById(id);

// ---- branding (uit brand.js) ----
function applyBrand() {
  const b = window.BRAND || {};
  if (b.paginaTitel) document.title = b.paginaTitel;
  const eyebrow = $('brand-eyebrow');
  if (eyebrow) {
    if (b.eyebrow) eyebrow.textContent = b.eyebrow;
    else eyebrow.style.display = 'none';
  }
  const titel = $('brand-titel');
  if (titel) {
    titel.textContent = b.titel || 'GEO-';
    if (b.titelAccent) {
      const span = document.createElement('span');
      span.className = 'pink';
      span.textContent = b.titelAccent;
      titel.appendChild(span);
    }
  }
  const tagline = $('brand-tagline');
  if (tagline && b.tagline) tagline.textContent = b.tagline;
  if (b.voorbeeldMerk) $('merknaam').placeholder = b.voorbeeldMerk;
  if (b.voorbeeldWebsite) {
    $('url').placeholder = b.voorbeeldWebsite;
    $('landingspagina').placeholder = b.voorbeeldWebsite.replace(/\/?$/, '/');
  }
}

// ---- offline-detector voor de queue ----
function makeOnlineGate() {
  let waiters = [];
  const flush = () => { while (waiters.length) waiters.shift()(); };
  window.addEventListener('online', flush);
  return () => navigator.onLine === false
    ? new Promise((res) => waiters.push(res))
    : Promise.resolve();
}

// ---- modal helpers ----
function showModal(titel, tekst) {
  const wrap = $('modal');
  wrap.querySelector('.modal-title').textContent = titel;
  wrap.querySelector('.modal-body').textContent = tekst;
  wrap.classList.remove('hidden');
  wrap.querySelector('.modal-close').onclick = () => wrap.classList.add('hidden');
}

// ---- voortgangs-rendering ----
function setProgress({ done, ok, fail, total, stopped, fase }) {
  const pct = total ? Math.round(100 * done / total) : 0;
  $('progress-fill').style.width = pct + '%';
  const faseLabel = fase ? `[${fase}] ` : '';
  let txt = `${faseLabel}${done} van ${total} klaar (${pct}%) · ✓ ${ok} · ⚠ ${fail}`;
  if (stopped) txt += ' — gestopt';
  $('progress-text').textContent = txt;
}

// ---- meting starten ----
async function startMeting() {
  const merknaam = $('merknaam').value.trim();
  const categorie = $('categorie').value.trim();
  if (!merknaam || !categorie) {
    showModal('Velden ontbreken', 'Vul minimaal merknaam en categorie in.');
    return;
  }
  const config = {
    merknaam,
    url: $('url').value.trim(),
    categorie,
    markt: $('markt').value.trim() || 'Nederland',
    taal: $('taal').value,
    concurrenten: $('concurrenten').value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 3),
    doelgroep: $('doelgroep').value.trim(),
    runs_per_prompt: parseInt($('runs').value, 10),
    boek_analyses: $('boek').checked,
    landingspagina: $('landingspagina').value.trim(),
    modus: $('modus').value,
  };

  $('start').disabled = true;
  $('form-card').classList.add('hidden');
  $('result').classList.add('hidden');
  $('result').replaceChildren();
  $('progress-card').classList.remove('hidden');
  $('progress-note').classList.add('hidden');

  try {
    await runMeting(config);
  } catch (err) {
    console.error(err);
    showModal('Er ging iets mis', err.message || String(err));
    $('start').disabled = false;
    $('form-card').classList.remove('hidden');
    $('progress-card').classList.add('hidden');
  }
}

async function runMeting(config) {
  // 1. Promptset ophalen.
  setProgress({ done: 0, ok: 0, fail: 0, total: 0, fase: 'promptset' });
  const pr = await api.prompts({
    categorie: config.categorie,
    markt: config.markt,
    taal: config.taal,
    concurrenten: config.concurrenten,
    doelgroep: config.doelgroep,
    merknaam: config.merknaam,
    landingspagina: config.landingspagina || config.url,
  });
  const promptset = pr.prompts || [];
  const bookPrompts = config.boek_analyses ? (pr.book_prompts || []) : [];

  // 2. Wie meten we? Vraag /config welke providers backend kent.
  const beBackendConfig = await api.config();
  const providers = Object.keys(beBackendConfig.available_providers || {
    openai: true, perplexity: true, gemini: true, anthropic: true,
  });

  // 3. Bouw takenlijst: modus × provider × prompt × run.
  const plan = MODUS_PLAN[config.modus] || MODUS_PLAN.zoeken;
  const modi = plan.map(([m]) => m);
  const tasks = [];
  for (const [modus, search] of plan) {
    for (const provider of providers) {
      for (const prompt of promptset) {
        for (let r = 0; r < config.runs_per_prompt; r++) {
          tasks.push({
            id: `${modus}|${provider}|${tasks.length}`,
            provider, prompt, search, modus,
            max_tokens: 800,
            merknaam: config.merknaam,
            concurrenten: config.concurrenten,
          });
        }
      }
    }
  }

  // 4. Run queue.
  const onlineGate = makeOnlineGate();
  const perRun = [];
  let demoSeen = false;
  let stopReason = null;

  const runCall = async (task) => {
    const data = await api.run({
      provider: task.provider,
      prompt: task.prompt,
      search: task.search,
      max_tokens: task.max_tokens,
      merknaam: task.merknaam,
      concurrenten: task.concurrenten,
    });
    if (data.is_demo) demoSeen = true;
    perRun.push({
      provider: task.provider,
      modus: task.modus,
      prompt: task.prompt,
      text: (data.text || '').slice(0, 4000),
      is_demo: !!data.is_demo,
      error: data.error || null,
      analysis: analyzeAnswer(data.text, config.merknaam, config.concurrenten, config.url, data.sources),
    });
    return data;
  };

  const queueRes = await runQueue({
    tasks,
    concurrency: window.GEO_CONFIG.CONCURRENCY,
    concurrencyPerProvider: window.GEO_CONFIG.CONCURRENCY_PER_PROVIDER || 2,
    runCall,
    retryDelayMs: window.GEO_CONFIG.RETRY_DELAY_MS,
    awaitOnline: onlineGate,
    onProgress: (p) => setProgress({ ...p, fase: 'meten' }),
    onStop: (reason, err) => {
      stopReason = reason;
      if (reason === 'rate_limited') {
        showModal('Te veel metingen vanaf jouw IP',
          'Wacht ongeveer een uur voor je opnieuw een meting probeert. Per IP-adres mag de tool 5 metingen per uur doen.');
      } else if (reason === 'budget') {
        showModal('Dagelijks AI-budget op',
          'De tool heeft vandaag al voor het dagbudget aan AI-calls gedaan. Probeer het morgen opnieuw (reset om 01:00 NL-tijd).');
      }
    },
  });

  // 4b. Failed/error per task aan per_run toevoegen zodat aggregatie klopt.
  for (let i = 0; i < queueRes.results.length; i++) {
    const r = queueRes.results[i];
    if (!r || r.ok) continue;
    const task = tasks[i];
    perRun.push({
      provider: task.provider,
      modus: task.modus,
      prompt: task.prompt,
      text: '',
      is_demo: false,
      error: (r.error && r.error.message) || 'fout',
      analysis: { mentioned: false, position: null, competitors_present: [], cited: false },
    });
  }

  // 5. Boek-analyses (optioneel, los van hoofdqueue).
  let boekResults = [];
  let boekModel = null;
  if (config.boek_analyses && bookPrompts.length && !queueRes.stopped) {
    const beschikbaar = beBackendConfig.available_providers || {};
    const boekProvider = BOOK_PROVIDER_ORDER.find(p => beschikbaar[p]) || 'openai';
    boekModel = BOOK_LABEL[boekProvider] || 'de AI';
    const boekSearch = config.modus !== 'kaal';
    setProgress({ done: 0, ok: 0, fail: 0, total: bookPrompts.length, fase: 'diepte' });
    const boekTasks = bookPrompts.map((item, idx) => ({
      id: `boek-${idx}`,
      provider: boekProvider,
      ...item,
      search: boekSearch,
      max_tokens: 800,
      merknaam: config.merknaam,
      concurrenten: config.concurrenten,
    }));
    const boekRunCall = async (task) => {
      const data = await api.run({
        provider: task.provider,
        prompt: task.prompt,
        search: task.search,
        max_tokens: task.max_tokens,
        merknaam: task.merknaam,
        concurrenten: task.concurrenten,
      });
      if (data.is_demo) demoSeen = true;
      return data;
    };
    const boekQueue = await runQueue({
      tasks: boekTasks,
      concurrency: 3,
      runCall: boekRunCall,
      retryDelayMs: window.GEO_CONFIG.RETRY_DELAY_MS,
      awaitOnline: onlineGate,
      onProgress: (p) => setProgress({ ...p, fase: 'diepte' }),
      onStop: (reason) => { stopReason = reason; },
    });
    boekResults = boekTasks.map((task, i) => {
      const r = boekQueue.results[i];
      if (r && r.ok) {
        return {
          id: task.id, titel: task.titel, uitleg: task.uitleg, prompt: task.prompt,
          antwoord: r.data.text || '', error: null, is_demo: !!r.data.is_demo,
        };
      }
      return {
        id: task.id, titel: task.titel, uitleg: task.uitleg, prompt: task.prompt,
        antwoord: '', error: r && r.error ? r.error.message : 'mislukt', is_demo: false,
      };
    });
  }

  // 6. Aggregatie + result-object.
  const result = {
    merknaam: config.merknaam,
    url: config.url,
    categorie: config.categorie,
    markt: config.markt,
    taal: config.taal,
    datum: new Date().toISOString().slice(0, 10),
    demo_modus: demoSeen,
    runs_per_prompt: config.runs_per_prompt,
    promptset,
    modi,
    modus_labels: Object.fromEntries(modi.map(m => [m, MODUS_LABELS[m] || m])),
    heeft_concurrenten: config.concurrenten.length > 0,
    rows: rowsPerProviderModus(perRun),
    totaal_per_modus: totalsPerModus(perRun),
    concurrenten_per_modus: competitorSharesPerModus(perRun, config.concurrenten),
    antwoorden: answersDrilldown(perRun),
    boek_analyses: boekResults,
    boek_model: boekModel,
    analyse_titel: (window.BRAND && window.BRAND.analyseTitel) || 'Diepte-analyses',
  };

  const rapportMd = buildReport(result);
  render(result, rapportMd, stopReason);
}

// ---- rendering ----------------------------------------------------------

function el(tag, attrs = {}, kinderen = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const k of [].concat(kinderen)) {
    if (k == null) continue;
    e.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
  }
  return e;
}

function pct(x) { return x == null ? 'n.v.t.' : Math.round(x * 100) + '%'; }

function highlightInto(target, text, merk, concurrenten) {
  // Renders text into target, wrapping merk/concurrenten in <mark>.
  // Werkt via textContent + DOM-construction (geen innerHTML).
  target.replaceChildren();
  const naden = [merk, ...(concurrenten || [])].filter(Boolean);
  if (!naden.length) { target.textContent = text || ''; return; }
  const escRe = naden.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp('(' + escRe + ')', 'gi');
  let last = 0;
  const src = text || '';
  for (const m of src.matchAll(re)) {
    if (m.index > last) target.appendChild(document.createTextNode(src.slice(last, m.index)));
    const isMerk = m[0].toLowerCase() === (merk || '').toLowerCase();
    target.appendChild(el('mark', { class: isMerk ? 'hl-merk' : 'hl-conc', text: m[0] }));
    last = m.index + m[0].length;
  }
  if (last < src.length) target.appendChild(document.createTextNode(src.slice(last)));
}

function kpiNode(top, big, sub) {
  return el('div', { class: 'kpi' }, [
    el('div', { class: 'top', text: top }),
    el('div', { class: 'big', text: String(big) }),
    el('div', { class: 'sub', text: sub }),
  ]);
}

function antwoordenBlokNode(result, modus) {
  const items = (result.antwoorden || []).filter(a => a.modus === modus);
  if (!items.length) return null;
  const order = {};
  (result.promptset || []).forEach((p, i) => { order[p] = i; });
  const prompts = [...new Set(items.map(a => a.prompt))].sort(
    (a, b) => (order[a] ?? 99) - (order[b] ?? 99));
  const concNamen = Object.keys((result.concurrenten_per_modus || {})[modus] || {});

  const root = el('details', { class: 'analyse', style: 'margin-top:var(--s-5)' });
  root.appendChild(el('summary', { text: 'Bekijk de antwoorden (wat de AI echt zei)' }));
  const body = el('div', { class: 'analyse-body' });
  for (const prompt of prompts) {
    body.appendChild(el('p', {
      style: 'font-weight:700;color:var(--indigo-900);margin:var(--s-4) 0 6px',
      text: prompt,
    }));
    const provItems = items.filter(x => x.prompt === prompt)
      .sort((a, b) => (b.mentioned_count || 0) - (a.mentioned_count || 0));
    for (const a of provItems) {
      const n = a.mentioned_count || 0;
      const klasse = !a.runs ? 'miss' : (n > 0 ? 'hit' : 'miss');
      const det = el('details', { class: `prompt-toggle ${klasse}` });
      const sum = el('summary');
      sum.appendChild(document.createTextNode((PROVIDER_LABEL[a.provider] || a.provider) + ' — '));
      if (a.runs) {
        const b = el('b', { text: `${n}/${a.runs}` });
        sum.appendChild(document.createTextNode('genoemd in '));
        sum.appendChild(b);
        sum.appendChild(document.createTextNode(' runs'));
      } else {
        sum.appendChild(document.createTextNode('geen geslaagde runs'));
      }
      det.appendChild(sum);
      const txt = el('div', { class: 'prompt-text', style: 'font-family:var(--font-body)' });
      if (a.voorbeeld_error) {
        txt.appendChild(el('span', { class: 'muted', text: '(call mislukt)' }));
      } else {
        const schoon = (a.voorbeeld_text || '').replace(/\*\*/g, '').replace(/^#+\s/gm, '');
        highlightInto(txt, schoon, result.merknaam, concNamen);
      }
      det.appendChild(txt);
      body.appendChild(det);
    }
  }
  root.appendChild(body);
  return root;
}

function modusBlokNode(result, modus) {
  const t = (result.totaal_per_modus || {})[modus] || {};
  const rows = (result.rows || []).filter(r => r.modus === modus);
  const conc = (result.concurrenten_per_modus || {})[modus] || {};
  const toonPositie = !!result.heeft_concurrenten;
  const out = el('div');

  const grid = el('div', { class: 'kpi-grid' });
  grid.appendChild(kpiNode('Mention share', pct(t.mention_share), 'spontaan genoemd'));
  grid.appendChild(kpiNode('Citatie share', pct(t.citatie_share), 'eigen site als bron'));
  if (toonPositie) grid.appendChild(kpiNode('Gemiddelde positie',
    t.gem_positie == null ? '—' : t.gem_positie, 'volgorde t.o.v. concurrenten'));
  out.appendChild(grid);

  const tbl = el('table', { style: 'margin-top:var(--s-5)' });
  const header = ['AI-model', 'Mention', 'Citatie'];
  if (toonPositie) header.push('Gemiddelde positie');
  const trh = el('tr');
  for (const h of header) trh.appendChild(el('th', { text: h }));
  tbl.appendChild(trh);
  for (const agg of rows) {
    const tr = el('tr');
    tr.appendChild(el('td', { text: PROVIDER_LABEL[agg.provider] || agg.provider }));
    tr.appendChild(el('td', { text: pct(agg.mention_share) }));
    tr.appendChild(el('td', { text: pct(agg.citatie_share) }));
    if (toonPositie) tr.appendChild(el('td', { text: agg.gem_positie == null ? '—' : String(agg.gem_positie) }));
    tbl.appendChild(tr);
  }
  out.appendChild(tbl);

  const totFout = rows.reduce((s, r) => s + (r.errors || 0), 0);
  if (totFout > 0) {
    const wie = rows.filter(r => r.errors > 0)
      .map(r => `${PROVIDER_LABEL[r.provider] || r.provider} (${r.errors})`).join(', ');
    out.appendChild(el('p', {
      class: 'meet-notitie',
      text: `Let op: ${totFout} losse meting${totFout > 1 ? 'en zijn' : ' is'} na herhaald proberen niet gelukt en tel${totFout > 1 ? 'len' : 't'} niet mee in de cijfers — bij ${wie}. De rest van de meting is gewoon geldig.`,
    }));
  }

  const compRows = [[result.merknaam, t.mention_share || 0, true],
    ...Object.entries(conc).map(([k, v]) => [k, v, false])];
  compRows.sort((a, b) => b[1] - a[1]);
  if (compRows.length > 1) {
    out.appendChild(el('h3', { style: 'margin-top:var(--s-5)', text: 'Positie t.o.v. concurrenten' }));
    const ctbl = el('table');
    const cth = el('tr');
    cth.appendChild(el('th', { text: 'Merk' }));
    cth.appendChild(el('th', { style: 'width:55%', text: 'Mention share' }));
    ctbl.appendChild(cth);
    for (const [naam, share, isMerk] of compRows) {
      const w = Math.round((share || 0) * 100);
      const tr = el('tr');
      const tdNaam = el('td');
      if (isMerk) {
        tdNaam.appendChild(el('b', { text: naam }));
        tdNaam.appendChild(el('span', { class: 'tag-you', text: 'jij' }));
      } else {
        tdNaam.textContent = naam;
      }
      tr.appendChild(tdNaam);
      const tdBar = el('td');
      tdBar.appendChild(el('span', {
        class: isMerk ? 'bar self' : 'bar',
        style: `width:${Math.max(w, 2)}%`,
      }));
      tdBar.appendChild(document.createTextNode(' ' + w + '%'));
      tr.appendChild(tdBar);
      ctbl.appendChild(tr);
    }
    out.appendChild(ctbl);
  }

  const ant = antwoordenBlokNode(result, modus);
  if (ant) out.appendChild(ant);
  return out;
}

// Minimale, veilige markdown-renderer voor de boek-analyses op het scherm.
// CSP-vrij: geen externe libs. Markdown wordt eerst HTML-geëscapeed.
function renderMdSafe(text) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let s = esc(text || '');
  s = s.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  s = s.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^# (.+)$/gm, '<h2>$1</h2>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/^- (.+)$/gm, '<li>$1</li>');
  s = s.replace(/(?:<li>[^<]+<\/li>\n?)+/g, m => '<ul>' + m.replace(/\n/g, '') + '</ul>');
  s = s.split(/\n{2,}/).map(p => /^<(h\d|ul|ol|pre|table|details)/.test(p.trim()) ? p : `<p>${p}</p>`).join('');
  s = s.replace(/\n/g, '<br>');
  const wrap = document.createElement('div');
  wrap.innerHTML = s;
  return wrap;
}

function render(result, md, stopReason) {
  $('progress-card').classList.add('hidden');
  $('start').disabled = false;
  $('form-card').classList.remove('hidden');

  const box = $('result');
  box.replaceChildren();

  if (stopReason) {
    const banner = el('div', {
      class: 'strip strip-yellow',
      text: stopReason === 'budget'
        ? 'De meting is voortijdig gestopt omdat het dagelijkse AI-budget bereikt is. Onderstaande cijfers gaan over de calls die nog wél geslaagd zijn.'
        : 'De meting is voortijdig gestopt door de IP-rate-limit. Onderstaande cijfers gaan over de calls die nog wél geslaagd zijn.',
    });
    box.appendChild(banner);
  }

  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', { text: 'Resultaat — ' + result.merknaam }));
  card.appendChild(el('p', {
    class: 'section-meta',
    text: `Meting van ${result.datum} · ${result.runs_per_prompt} runs per vraag · ${result.promptset.length} vragen`,
  }));

  if (result.demo_modus) {
    card.appendChild(el('div', {
      class: 'strip strip-yellow',
      text: 'Demo-modus: niet alle API-keys waren aanwezig, dus (een deel van) deze cijfers komt uit nep-antwoorden. Illustratief, niet representatief.',
    }));
  }

  const uitleg = el('div', { class: 'explain' });
  uitleg.appendChild(el('div', { class: 'explain-item' }, [
    el('b', { text: 'Mention share — hoe vaak word je spontaan genoemd?' }),
    el('br'),
    'We stellen vragen over je categorie zonder je merknaam erin. Het aandeel van de metingen waarin de AI je merk uit zichzelf noemt.',
  ]));
  uitleg.appendChild(el('div', { class: 'explain-item' }, [
    el('b', { text: 'Citatie share — gebruikt de AI je site als bron?' }),
    el('br'),
    'Aandeel van de antwoorden waarin de AI naar jouw eigen website verwijst (link of vermelding van je domein), niet alleen je naam.',
  ]));
  if (result.heeft_concurrenten) {
    uitleg.appendChild(el('div', { class: 'explain-item' }, [
      el('b', { text: 'Gemiddelde positie — vóór of na je concurrenten?' }),
      el('br'),
      'De volgorde waarin je verschijnt t.o.v. de concurrenten die jíj hebt opgegeven. 1,0 = steevast vóór je concurrenten genoemd.',
    ]));
  }
  card.appendChild(uitleg);

  for (const m of result.modi) {
    if (result.modi.length > 1) card.appendChild(el('h2', { text: result.modus_labels[m] || m }));
    else card.appendChild(el('h2', { text: 'Per AI-model' }));
    card.appendChild(modusBlokNode(result, m));
  }
  box.appendChild(card);

  // Boek-analyses
  if (result.boek_analyses && result.boek_analyses.length) {
    const c2 = el('div', { class: 'card' });
    c2.appendChild(el('h2', { text: result.analyse_titel || 'Diepte-analyses' }));
    c2.appendChild(el('p', {
      class: 'section-meta',
      text: `Zes uitgebreide GEO-analyses, uitgevoerd door ${result.boek_model || 'de AI'} voor ${result.merknaam}.`,
    }));
    for (const a of result.boek_analyses) {
      const det = el('details', { class: 'analyse' });
      det.appendChild(el('summary', { text: a.titel }));
      const body = el('div', { class: 'analyse-body' });
      if (a.uitleg) body.appendChild(el('p', { class: 'analyse-uitleg', text: a.uitleg }));
      if (a.prompt) {
        const promptDet = el('details', { class: 'prompt-toggle' });
        promptDet.appendChild(el('summary', { text: 'Toon de exacte vraag aan de AI' }));
        promptDet.appendChild(el('div', { class: 'prompt-text', text: a.prompt }));
        body.appendChild(promptDet);
      }
      body.appendChild(el('hr'));
      if (a.error) {
        body.appendChild(el('div', {
          class: 'strip strip-error',
          style: 'display:block',
          text: 'Niet gelukt: ' + a.error,
        }));
      } else {
        body.appendChild(renderMdSafe(a.antwoord || ''));
      }
      det.appendChild(body);
      c2.appendChild(det);
    }
    box.appendChild(c2);
  }

  // Rapport
  const c3 = el('div', { class: 'card' });
  c3.appendChild(el('h2', { text: 'Rapport voor de klant' }));
  c3.appendChild(el('p', {
    class: 'section-meta',
    text: 'Het markdown-rapport hieronder kun je als prompt plakken om er een gebrand PDF van te maken.',
  }));
  const tb = el('div', { class: 'toolbar' });
  const copyBtn = el('button', {
    class: 'btn btn-ghost',
    text: 'Kopieer rapport',
    onclick: () => navigator.clipboard.writeText(md).then(() => { copyBtn.textContent = 'Gekopieerd ✓'; }),
  });
  const dlBtn = el('button', {
    class: 'btn btn-ghost',
    text: 'Download .md',
    onclick: () => {
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = el('a', {
        href: url, download: `rapport-${result.merknaam.replace(/\W+/g, '-').toLowerCase()}-${result.datum}.md`,
      });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });
  const toggleBtn = el('button', {
    class: 'btn btn-ghost',
    text: 'Toon/verberg tekst',
    onclick: () => mdArea.classList.toggle('hidden'),
  });
  tb.appendChild(copyBtn); tb.appendChild(dlBtn); tb.appendChild(toggleBtn);
  c3.appendChild(tb);
  const mdArea = el('textarea', { class: 'hidden', readonly: 'readonly' });
  mdArea.value = md;
  c3.appendChild(mdArea);
  box.appendChild(c3);

  box.appendChild(el('div', { style: 'margin-top:32px' }, [
    el('button', {
      class: 'btn btn-ghost',
      text: 'Nieuwe meting',
      onclick: () => location.reload(),
    }),
  ]));

  box.classList.remove('hidden');
  box.scrollIntoView({ behavior: 'smooth' });
}

// ---- init ---------------------------------------------------------------
function init() {
  applyBrand();
  $('start').addEventListener('click', startMeting);
  const boekToggle = () => { $('boek-extra').style.display = $('boek').checked ? 'block' : 'none'; };
  $('boek').addEventListener('change', boekToggle); boekToggle();
  const lpDefault = $('landingspagina').placeholder;
  const syncLp = () => {
    const v = $('url').value.trim();
    $('landingspagina').placeholder = v || lpDefault;
  };
  $('url').addEventListener('input', syncLp); syncLp();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
