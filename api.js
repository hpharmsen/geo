// Dunne wrapper rond /api/geo/*. Vertaalt fetch-resultaten naar CallError
// volgens classifyResponse, zodat queue.js één tabel kent.

import { CallError, classifyResponse } from './queue.js';

const cfg = () => window.GEO_CONFIG;

async function postJSON(path, body, { timeoutMs } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || cfg().RUN_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(cfg().BACKEND_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(t);
    if (err.name === 'AbortError') throw new CallError('transient', 'timeout (30s)', 0);
    throw new CallError('transient', err.message || 'netwerk', 0);
  }
  clearTimeout(t);
  let parsed = null;
  try { parsed = await resp.json(); } catch { parsed = null; }
  const cls = classifyResponse(resp.status, parsed);
  if (cls.kind !== 'ok') throw new CallError(cls.kind, cls.message, resp.status);
  return parsed;
}

async function getJSON(path) {
  const resp = await fetch(cfg().BACKEND_URL + path);
  if (!resp.ok) throw new CallError('fail', `GET ${path} → ${resp.status}`, resp.status);
  return resp.json();
}

export const api = {
  config: () => getJSON('/config'),
  prompts: (body) => postJSON('/prompts', body, { timeoutMs: 15000 }),
  run: (body) => postJSON('/run', body),
};
