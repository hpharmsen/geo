// Parallel-queue met retry/stop-condities. Pure logica zonder DOM-afhankelijkheid,
// zodat hij in node --test geladen kan worden.
//
// Foutsoorten (kind):
//   'transient'    → tijdelijke fout (504/502/500/abort/netwerk). 1× retry.
//   'fail'         → permanente fout (4xx, provider-fout in body). Geen retry.
//   'rate_limited' → 429: queue stopt direct, onStop('rate_limited').
//   'budget'       → 503 met daily-budget tekst: queue stopt, onStop('budget').

export class CallError extends Error {
  constructor(kind, message, status) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

// Classifier: gebruikt door de fetch-laag in app.js, en in tests.
export function classifyResponse(status, body) {
  if (status === 200 || status === 201) {
    if (body && typeof body === 'object' && body.error) {
      return { kind: 'fail', message: String(body.error) };
    }
    return { kind: 'ok' };
  }
  if (status === 429) {
    return { kind: 'rate_limited', message: (body && body.error) || 'IP rate-limit' };
  }
  if (status === 503) {
    const msg = String((body && body.error) || '');
    if (/dagbudget|daily budget|budget bereikt/i.test(msg)) {
      return { kind: 'budget', message: msg };
    }
    return { kind: 'transient', message: msg || 'service unavailable' };
  }
  if (status >= 500 && status < 600) {
    return { kind: 'transient', message: (body && body.error) || `${status}` };
  }
  return { kind: 'fail', message: (body && body.error) || `${status}` };
}

export async function runQueue({
  tasks,
  concurrency = 6,
  concurrencyPerProvider = Infinity,
  runCall,
  retryDelayMs = 3000,
  awaitOnline,
  onProgress,
  onResult,
  onStop,
}) {
  const total = tasks.length;
  const results = new Array(total);
  const inProgress = new Array(total).fill(false);
  const inFlight = {};
  let done = 0, ok = 0, fail = 0;
  let stopped = false, stopReason = null;

  // Notify-pattern: workers wachten op `notifyPromise` als geen task beschikbaar
  // is (provider gecapped) en alle andere workers nog bezig. Bij elke release
  // (= slot vrij) wordt het notify gefired zodat wachtenden opnieuw proberen.
  let notifyResolve;
  let notifyPromise = new Promise(r => { notifyResolve = r; });
  const notify = () => {
    const r = notifyResolve;
    notifyPromise = new Promise(res => { notifyResolve = res; });
    r();
  };

  const tick = () => {
    onProgress && onProgress({ done, ok, fail, total, stopped, stopReason });
  };

  // Eerste vrije task waar provider nog slot heeft. -1 als geen pakbaar.
  const findAvailable = () => {
    for (let i = 0; i < total; i++) {
      if (inProgress[i] || results[i]) continue;
      const p = tasks[i].provider;
      if ((inFlight[p] || 0) >= concurrencyPerProvider) continue;
      return i;
    }
    return -1;
  };

  // Is er nog wat te doen (lopend of niet)?
  const hasRemaining = () => {
    for (let i = 0; i < total; i++) {
      if (!results[i]) return true;
    }
    return false;
  };

  async function attempt(task, attemptNo) {
    if (awaitOnline) await awaitOnline();
    try {
      const data = await runCall(task);
      return { ok: true, data, attempts: attemptNo };
    } catch (err) {
      const kind = err && err.kind ? err.kind : 'transient';
      if (kind === 'rate_limited' || kind === 'budget') {
        if (!stopped) {
          stopped = true;
          stopReason = kind;
          onStop && onStop(kind, err);
        }
        return { ok: false, error: err, attempts: attemptNo, stop: kind };
      }
      if (kind === 'transient' && attemptNo === 1) {
        if (retryDelayMs > 0) await new Promise(r => setTimeout(r, retryDelayMs));
        return attempt(task, attemptNo + 1);
      }
      return { ok: false, error: err, attempts: attemptNo };
    }
  }

  async function worker() {
    while (true) {
      if (stopped) return;
      const i = findAvailable();
      if (i === -1) {
        if (!hasRemaining()) return;
        await notifyPromise;
        continue;
      }
      inProgress[i] = true;
      const task = tasks[i];
      inFlight[task.provider] = (inFlight[task.provider] || 0) + 1;
      const outcome = await attempt(task, 1);
      inFlight[task.provider]--;
      results[i] = {
        task,
        ok: outcome.ok,
        data: outcome.data,
        error: outcome.error,
        attempts: outcome.attempts,
      };
      done++;
      if (outcome.ok) ok++; else fail++;
      onResult && onResult(i, results[i]);
      tick();
      notify();
    }
  }

  tick();
  const n = Math.min(concurrency, total);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return { results, done, ok, fail, total, stopped, stopReason };
}
