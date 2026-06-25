import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runQueue, CallError, classifyResponse } from '../static/queue.js';

// Hulpje: maak een mock runCall die een script afspeelt (één entry per call).
// Elke entry is een object met {ok, data?, kind?, status?, delay?}.
function mockRunCall(scriptByTaskId) {
  const callCount = {};
  const order = [];
  return async (task) => {
    order.push(task.id);
    const script = scriptByTaskId[task.id];
    if (!script) throw new Error('geen script voor task ' + task.id);
    const attempt = callCount[task.id] = (callCount[task.id] || 0) + 1;
    const step = Array.isArray(script) ? script[attempt - 1] : script;
    if (!step) throw new Error('te veel attempts voor task ' + task.id);
    if (step.delay) await new Promise(r => setTimeout(r, step.delay));
    if (step.ok) return step.data ?? { provider: task.provider };
    throw new CallError(step.kind, step.message || step.kind, step.status);
  };
}

// --- basis ------------------------------------------------------------------

test('basis_volgorde: 10 calls, 6 parallel, allen slagen', async () => {
  const tasks = Array.from({ length: 10 }, (_, i) => ({ id: i, provider: 'openai' }));
  const script = Object.fromEntries(tasks.map(t => [t.id, { ok: true }]));
  let maxConcurrent = 0, active = 0;
  const runCall = async (task) => {
    active++; maxConcurrent = Math.max(maxConcurrent, active);
    await new Promise(r => setTimeout(r, 5));
    active--;
    return { provider: task.provider };
  };
  const res = await runQueue({ tasks, concurrency: 6, runCall, retryDelayMs: 0 });
  assert.equal(res.total, 10);
  assert.equal(res.ok, 10);
  assert.equal(res.fail, 0);
  assert.equal(res.stopped, false);
  assert.ok(maxConcurrent <= 6, `max concurrent was ${maxConcurrent}`);
  assert.ok(maxConcurrent >= 2, 'verwacht echte parallel-uitvoering');
});

// --- retry-gedrag -----------------------------------------------------------

test('retry_op_504: één 504 dan 200 -> 1 retry, succesvol', async () => {
  const tasks = [{ id: 'a', provider: 'openai' }];
  const runCall = mockRunCall({
    a: [{ ok: false, kind: 'transient', status: 504 }, { ok: true }],
  });
  const res = await runQueue({ tasks, concurrency: 1, runCall, retryDelayMs: 0 });
  assert.equal(res.ok, 1);
  assert.equal(res.fail, 0);
  assert.equal(res.results[0].attempts, 2);
});

test('h12_max_1_retry: 2× transient -> 1 retry, daarna failed (geen 3+)', async () => {
  const tasks = [{ id: 'a', provider: 'openai' }];
  const runCall = mockRunCall({
    a: [
      { ok: false, kind: 'transient', status: 504 },
      { ok: false, kind: 'transient', status: 504 },
      { ok: false, kind: 'transient', status: 504 },  // mag niet worden bereikt
    ],
  });
  const res = await runQueue({ tasks, concurrency: 1, runCall, retryDelayMs: 0 });
  assert.equal(res.ok, 0);
  assert.equal(res.fail, 1);
  assert.equal(res.results[0].attempts, 2,
    'transient errors mogen maximaal 1 retry doen (totaal 2 attempts)');
});

test('4xx krijgt geen retry', async () => {
  const tasks = [{ id: 'a', provider: 'openai' }];
  const runCall = mockRunCall({
    a: [{ ok: false, kind: 'fail', status: 400 }],
  });
  const res = await runQueue({ tasks, concurrency: 1, runCall, retryDelayMs: 0 });
  assert.equal(res.ok, 0);
  assert.equal(res.fail, 1);
  assert.equal(res.results[0].attempts, 1);
});

// --- stop-condities ---------------------------------------------------------

test('429_modal: 429 -> queue stopt, onStop("rate_limited") wordt geroepen', async () => {
  // 5 tasks: eerste resulteert in 429. Resterende mogen niet worden geroepen.
  const tasks = Array.from({ length: 5 }, (_, i) => ({ id: i, provider: 'openai' }));
  const seen = [];
  const runCall = async (task) => {
    seen.push(task.id);
    if (task.id === 0) throw new CallError('rate_limited', 'IP rate-limit', 429);
    return { provider: task.provider };
  };
  let stopReason = null;
  const res = await runQueue({
    tasks, concurrency: 1, runCall, retryDelayMs: 0,
    onStop: (r) => { stopReason = r; },
  });
  assert.equal(stopReason, 'rate_limited');
  assert.equal(res.stopped, true);
  assert.equal(res.stopReason, 'rate_limited');
  // Met concurrency 1 mag alleen task 0 zijn geprobeerd.
  assert.deepEqual(seen, [0]);
});

test('daily_budget_stopt_alles: 503 budget -> stop + onStop("budget")', async () => {
  const tasks = Array.from({ length: 5 }, (_, i) => ({ id: i, provider: 'openai' }));
  const seen = [];
  const runCall = async (task) => {
    seen.push(task.id);
    if (task.id === 0) throw new CallError('budget', 'Dagbudget bereikt', 503);
    return { provider: task.provider };
  };
  let stopReason = null;
  const res = await runQueue({
    tasks, concurrency: 1, runCall, retryDelayMs: 0,
    onStop: (r) => { stopReason = r; },
  });
  assert.equal(stopReason, 'budget');
  assert.equal(res.stopped, true);
  assert.deepEqual(seen, [0]);
});

// --- partial failure --------------------------------------------------------

test('partial_failure_telt_op: 50 calls, 5 falen permanent -> done=50, ok=45, fail=5', async () => {
  const tasks = Array.from({ length: 50 }, (_, i) => ({ id: i, provider: 'openai' }));
  const failing = new Set([3, 7, 19, 31, 44]);
  const runCall = async (task) => {
    if (failing.has(task.id)) throw new CallError('fail', 'provider-fout', 200);
    return { provider: task.provider };
  };
  const res = await runQueue({ tasks, concurrency: 6, runCall, retryDelayMs: 0 });
  assert.equal(res.total, 50);
  assert.equal(res.done, 50);
  assert.equal(res.ok, 45);
  assert.equal(res.fail, 5);
  assert.equal(res.stopped, false);
});

// --- offline / pauze --------------------------------------------------------

test('offline_pauze: queue wacht op online-event voordat hij verder gaat', async () => {
  const tasks = Array.from({ length: 3 }, (_, i) => ({ id: i }));
  let online = false;
  const waiters = [];
  const awaitOnline = () => online
    ? Promise.resolve()
    : new Promise(resolve => waiters.push(resolve));
  const seen = [];
  const runCall = async (task) => { seen.push(task.id); return { ok: true }; };

  // Start de queue offline; geen task mag worden uitgevoerd.
  const promise = runQueue({ tasks, concurrency: 1, runCall, awaitOnline, retryDelayMs: 0 });
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(seen, [], 'offline -> geen calls');

  // Ga online: alle wachters vrijgeven en kennen toekomstige Promise.resolve toe.
  online = true;
  while (waiters.length) waiters.shift()();
  const res = await promise;
  assert.equal(res.ok, 3);
  assert.deepEqual(seen, [0, 1, 2]);
});

// --- classifyResponse helper -----------------------------------------------

test('classifyResponse: maps status + body naar kind', () => {
  assert.equal(classifyResponse(200, {}).kind, 'ok');
  assert.equal(classifyResponse(200, { error: 'iets mis' }).kind, 'fail',
    '200 met error-body is provider-fout (geen retry)');
  assert.equal(classifyResponse(429, { error: 'te veel' }).kind, 'rate_limited');
  assert.equal(classifyResponse(503, { error: 'Dagbudget bereikt' }).kind, 'budget');
  assert.equal(classifyResponse(503, { error: 'heroku h12' }).kind, 'transient');
  assert.equal(classifyResponse(504, {}).kind, 'transient');
  assert.equal(classifyResponse(502, {}).kind, 'transient');
  assert.equal(classifyResponse(500, {}).kind, 'transient');
  assert.equal(classifyResponse(400, {}).kind, 'fail');
  assert.equal(classifyResponse(404, {}).kind, 'fail');
});
