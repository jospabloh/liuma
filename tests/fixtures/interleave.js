// Cooperative scheduler for interleaving tests: each actor's DB call waits
// for its turn in `schedule`; an actor that finished is skipped; past the end
// of the schedule, everyone runs free. Same harness as the one inside
// tests/unit/account-deletion.test.js, shared for new tests.
import { makeFakeMongoDb } from './fake-mongo-db.js';

export function scheduler(schedule) {
  let pos = 0;
  const waiting = new Map();
  const done = new Set();
  const pump = () => {
    while (pos < schedule.length && done.has(schedule[pos])) pos += 1;
    const next = pos < schedule.length ? schedule[pos] : null;
    for (const [actor, resolve] of [...waiting]) {
      if (next === null || actor === next) {
        waiting.delete(actor);
        resolve();
        if (next !== null) break;
      }
    }
  };
  return {
    before: (actor) => new Promise((resolve) => { waiting.set(actor, resolve); pump(); }),
    after: () => { pos += 1; pump(); },
    finish: (actor) => { done.add(actor); pump(); },
  };
}

export function scheduledDb(tables, actor, sched, opts = {}) {
  const db = makeFakeMongoDb(tables, { idPrefix: actor, integrations: { Core: { SendEmail: async () => {} } }, ...opts });
  const entities = new Proxy({}, {
    get(_, name) {
      const handler = db.entities[name];
      return new Proxy(handler, {
        get(target, op) {
          const fn = target[op];
          if (typeof fn !== 'function') return fn;
          return async (...args) => {
            if (sched) await sched.before(actor);
            try { return await fn.apply(target, args); } finally { if (sched) sched.after(actor); }
          };
        },
      });
    },
  });
  return { entities, integrations: db.integrations, writes: db.writes };
}

/** Every non-decreasing choice of k values from `slots`. */
export function multisets(slots, k) {
  const out = [];
  const walk = (start, acc) => {
    if (acc.length === k) { out.push(acc); return; }
    for (let i = start; i < slots.length; i += 1) walk(i, [...acc, slots[i]]);
  };
  walk(0, []);
  return out;
}
