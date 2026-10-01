#!/usr/bin/env node
// Load test for the read path, against a mock of Base44 (v1.8.3).
//
//   npm run test:load            # prints the tables below
//   node scripts/load-test-reads.mjs --json
//
// WHAT IT RUNS. The REAL code on both ends, wired through a mock platform:
//   - client: src/lib/data/schoolReadCore.js (the reader, with and without
//     auto-batching / the shared context), src/lib/functionResponse.js
//     (invokeFunction, with and without retry), src/lib/queryErrorPolicy.js
//     (React Query's retry policy);
//   - server: base44/functions/schoolRead/_answer.ts + _scope.ts (the whole
//     request path: profile pick, scope derivation, single read, batch,
//     context), against tests/fixtures/fake-entity-db.js with one school's
//     worth of rows. Every entity call is counted.
// The mock platform enforces what production showed on 2026-10-01: one
// app-wide budget for SERVICE-ROLE entity calls, ~150 per rolling minute, and
// "Rate limit exceeded" past it. A read made with the caller's own token (the
// UserProfile lookup since v1.8.3) is counted separately, ASSUMING it draws
// on a per-user budget. Nothing Base44 publishes confirms that (see "Not
// verified" in docs/rate-limit-v1.8.3.md); if it counts against the app
// budget, each "after" figure is about one call per invocation optimistic.
//
// WHAT A "SCREEN" IS. The queries each screen fires when it mounts, copied
// from the page source (keys, filters, limits, and which query waits for
// which). A tiny React Query stand-in serves them: one cache, staleTime,
// dedupe by key, retry policy. "before" is v1.8.2: no batching, no shared
// context, staleTime 0, retry: 1 after 1 s, no retry inside invokeFunction,
// the rate limit answered as 500, the profile read with the service role,
// getMySubscription fresh for 2 min in memory only. "after" is this release.
//
// Time is virtual (SCALE × faster than real) so a minute of three people
// browsing runs in about a second.

import { pathToFileURL } from 'node:url';
import { makeSchoolReader, SCHOOL_READ_ALL } from '../src/lib/data/schoolReadCore.js';
import { invokeFunction } from '../src/lib/functionResponse.js';
import { makeCooldown } from '../src/lib/functionRetry.js';
import { shouldRetryQuery, queryRetryDelay, QUERY_STALE_TIME_MS } from '../src/lib/queryErrorPolicy.js';
import { SUBSCRIPTION_FRESH_MS } from '../src/lib/license/subscriptionSession.js';
import { answerSchoolRead, isRateLimitError } from '../base44/functions/schoolRead/_answer.ts';
import { makeFakeDb } from '../tests/fixtures/fake-entity-db.js';

const SCALE = 50;
const TODAY = '2026-10-01';

// --- A school --------------------------------------------------------------

export function buildWorld() {
  const t = (i) => `2026-09-${String(1 + (i % 28)).padStart(2, '0')}T12:00:00Z`;
  const tables = {
    School: [{ id: 'A', name: 'Escuela A', created_date: t(0) }],
    SchoolSubscription: [{ id: 'subA', school_id: 'A', subscription_status: 'active', license_tier: 'basic', created_date: t(0) }],
    UserProfile: [], Classroom: [], TeacherClassroom: [], Student: [], ParentStudent: [],
    Notice: [], NoticeDelivery: [], Event: [], ChargeItem: [], Attendance: [], DiaryEntry: [],
    AbsenceNotification: [], EmergencyContact: [], SchoolSetupGuide: [], Homework: [],
  };
  const profile = (user_id, app_role) => tables.UserProfile.push({
    id: `p-${user_id}`, user_id, school_id: 'A', app_role, status: 'ACTIVE', onboarding_completed: true, created_date: t(1),
  });
  profile('director', 'ADMIN');
  for (let c = 1; c <= 6; c += 1) {
    tables.Classroom.push({ id: `c${c}`, school_id: 'A', name: `Salón ${c}`, is_active: true, created_date: t(c) });
    profile(`teacher${c}`, 'TEACHER');
    tables.TeacherClassroom.push({ id: `tc${c}`, school_id: 'A', teacher_id: `teacher${c}`, classroom_id: `c${c}`, is_active: true, created_date: t(c) });
  }
  for (let s = 1; s <= 120; s += 1) {
    const classroom_id = `c${1 + (s % 6)}`;
    tables.Student.push({ id: `s${s}`, school_id: 'A', classroom_id, first_name: `Alumno${s}`, last_name: 'Prueba', is_active: true, created_date: t(s) });
    const parent = `parent${1 + Math.floor((s - 1) / 2)}`;
    if (s % 2 === 1) profile(parent, 'PARENT');
    tables.ParentStudent.push({ id: `ps${s}`, school_id: 'A', parent_id: parent, student_id: `s${s}`, status: 'ACTIVE', created_date: t(s) });
    tables.EmergencyContact.push({ id: `ec${s}`, school_id: 'A', student_id: `s${s}`, name: 'Contacto', phone: '1', created_date: t(s) });
    for (let k = 0; k < 3; k += 1) {
      tables.ChargeItem.push({ id: `ch${s}-${k}`, school_id: 'A', student_id: `s${s}`, amount: 1000, status: k === 0 ? 'PENDING' : 'PAID', due_date: `2026-10-${10 + k}`, created_date: t(k) });
    }
    for (let d = 0; d < 15; d += 1) {
      const date = `2026-09-${String(16 + d).padStart(2, '0')}`;
      tables.Attendance.push({ id: `at${s}-${d}`, school_id: 'A', student_id: `s${s}`, classroom_id, date, status: 'PRESENT', created_date: t(d) });
      if (d % 3 === 0) tables.DiaryEntry.push({ id: `de${s}-${d}`, school_id: 'A', student_id: `s${s}`, classroom_id, date, sent_to_parents: true, created_date: t(d) });
    }
  }
  for (let n = 1; n <= 60; n += 1) {
    const scoped = n % 3 === 0 ? { scope: 'CLASSROOM', classroom_id: `c${1 + (n % 6)}` } : { scope: 'SCHOOL' };
    tables.Notice.push({ id: `n${n}`, school_id: 'A', title: `Aviso ${n}`, priority: n % 5 === 0 ? 'URGENT' : 'NORMAL', author_id: n % 2 ? 'director' : 'teacher1', created_date: t(n), ...scoped });
  }
  for (let p = 1; p <= 60; p += 1) {
    for (let n = 55; n <= 60; n += 1) {
      tables.NoticeDelivery.push({ id: `nd${p}-${n}`, school_id: 'A', notice_id: `n${n}`, recipient_user_id: `parent${p}`, student_id: `s${p * 2 - 1}`, status: 'SENT', created_date: t(n) });
    }
  }
  for (let e = 1; e <= 30; e += 1) {
    tables.Event.push({ id: `ev${e}`, school_id: 'A', scope: 'SCHOOL', title: `Evento ${e}`, date: `2026-${e > 15 ? '10' : '09'}-${String(1 + (e % 28)).padStart(2, '0')}`, requires_confirmation: e % 2 === 0, created_date: t(e) });
  }
  for (let a = 1; a <= 20; a += 1) {
    tables.AbsenceNotification.push({ id: `ab${a}`, school_id: 'A', parent_id: `parent${a}`, student_id: `s${a * 2 - 1}`, date: '2026-10-05', status: 'PENDING', created_date: t(a) });
  }
  for (let g = 1; g <= 8; g += 1) tables.SchoolSetupGuide.push({ id: `g${g}`, school_id: 'A', step: g, is_completed: g < 5, created_date: t(g) });
  return tables;
}

// --- The mock platform -----------------------------------------------------

/** Base44's app-wide rolling-window budget for service-role entity calls. */
function makeBudget({ limit = 150, windowMs = 60000, now }) {
  const stamps = [];
  return {
    take() {
      const t = now();
      while (stamps.length && t - stamps[0] >= windowMs) stamps.shift();
      if (stamps.length >= limit) {
        const err = new Error('Rate limit exceeded');
        err.status = 429;
        throw err;
      }
      stamps.push(t);
    },
  };
}

/** A db handle that charges every entity call to `budget` and counts it. */
function meteredDb(db, budget, counter) {
  const entities = {};
  for (const [name, h] of Object.entries(db.entities)) {
    entities[name] = {
      async filter(...args) { budget.take(); counter.ops += 1; return h.filter(...args); },
      async get(...args) { budget.take(); counter.ops += 1; return h.get(...args); },
    };
  }
  return { entities };
}

function httpError(status, body, headers = {}) {
  const err = new Error(`Request failed with status code ${status}`);
  err.response = { status, data: body, headers };
  return err;
}

function makePlatform({ mode, now, sleep }) {
  const db = makeFakeDb(buildWorld());
  const budget = makeBudget({ now });
  const unmetered = { take() {} };
  const stats = { invocations: 0, serviceOps: 0, userOps: 0, rateLimited: 0, byFunction: {} };
  const service = meteredDb(db, budget, { get ops() { return stats.serviceOps; }, set ops(v) { stats.serviceOps = v; } });
  const own = meteredDb(db, unmetered, { get ops() { return stats.userOps; }, set ops(v) { stats.userOps = v; } });

  async function run(name, userId, payload) {
    // Invocation latency: the function's cold path is not free either.
    await sleep(120);
    const profileDb = mode === 'before' ? service : own;
    const profiles = await profileDb.entities.UserProfile.filter({ user_id: userId }, '-created_date', 50);
    if (name === 'schoolRead') return answerSchoolRead(service, userId, profiles, payload);
    if (name === 'getMySubscription') {
      const profile = profiles[0];
      const subs = await service.entities.SchoolSubscription.filter({ school_id: profile.school_id }, '-created_date', 1);
      const school = await service.entities.School.get(profile.school_id);
      return { status: 200, body: { ok: true, subscription: subs[0] || null, school, effective: { isReadOnly: false } } };
    }
    throw new Error(`mock: unknown function ${name}`);
  }

  return {
    stats,
    client(userId) {
      return {
        functions: {
          async invoke(name, payload) {
            stats.invocations += 1;
            stats.byFunction[name] = (stats.byFunction[name] || 0) + 1;
            let answer;
            try {
              answer = await run(name, userId, payload);
            } catch (e) {
              if (!isRateLimitError(e)) throw e;
              stats.rateLimited += 1;
              // v1.8.2 answered the limit as 500 INTERNAL (schoolRead) or a
              // 500 with the raw message (getMySubscription); v1.8.3 as 429.
              if (mode === 'before') throw httpError(500, { ok: false, code: 'INTERNAL', error: name === 'schoolRead' ? 'INTERNAL' : 'Rate limit exceeded' });
              throw httpError(429, { ok: false, code: 'RATE_LIMITED', error: 'RATE_LIMITED' }, { 'retry-after': '3' });
            }
            if (answer.status >= 400) throw httpError(answer.status, answer.body);
            return { data: answer.body, status: answer.status, headers: {}, config: {} };
          },
        },
      };
    },
  };
}

// --- A minimal React Query --------------------------------------------------

function makeQueryCache({ mode, now, sleep }) {
  const cache = new Map();
  const inFlight = new Map();
  const staleTime = (key) => {
    if (key[0] === 'mySubscription') return mode === 'before' ? 2 * 60 * 1000 : SUBSCRIPTION_FRESH_MS;
    return mode === 'before' ? 0 : QUERY_STALE_TIME_MS;
  };
  const outcome = { fetched: 0, cacheHits: 0, failedQueries: 0, failures: [] };

  async function attempt(fn) {
    for (let n = 0; ; n += 1) {
      try {
        return await fn();
      } catch (error) {
        const retry = mode === 'before' ? n < 1 : shouldRetryQuery(n, error);
        if (!retry) throw error;
        await sleep(mode === 'before' ? 1000 : queryRetryDelay(n));
      }
    }
  }

  return {
    outcome,
    /** Resolve one query as a mounting component would: cached, deduped or fetched. */
    async use(key, fn) {
      const id = JSON.stringify(key);
      const hit = cache.get(id);
      if (hit && now() - hit.at < staleTime(key)) {
        outcome.cacheHits += 1;
        return hit.data;
      }
      if (inFlight.has(id)) return inFlight.get(id);
      outcome.fetched += 1;
      const p = attempt(fn)
        .then((data) => { cache.set(id, { data, at: now() }); return data; })
        .catch((error) => { outcome.failedQueries += 1; outcome.failures.push(key[0]); return undefined; })
        .finally(() => inFlight.delete(id));
      inFlight.set(id, p);
      return p;
    },
    /** A full page load: React Query's memory is gone. */
    clear() { cache.clear(); },
  };
}

// --- Screens (from the page source) ------------------------------------------

const UNPAID = ['PENDING', 'OVERDUE', 'PARTIAL'];

function screens({ q, read, readMany, context, user, chained, school = 'A' }) {
  const linked = () => q.use(['linkedStudents', user], () => context());
  return {
    // src/components/home/ParentHome.jsx
    ParentHome: async () => {
      const [ctx] = await Promise.all([
        linked(),
        q.use(['urgentNotices', school], () => read('Notice', { school_id: school }, '-created_date', 10)),
        q.use(['unreadUrgentDeliveries', user, school], () => read('NoticeDelivery', { school_id: school, recipient_user_id: user, status: 'SENT' }, '-created_date', 50)),
        q.use(['upcomingEvents', school], () => read('Event', { school_id: school, date: { $gte: TODAY } }, 'date', 5)),
      ]);
      const ids = ctx?.studentIds || [];
      if (ids.length) await q.use(['pendingCharges', ids], () => read('ChargeItem', { school_id: school, status: { $in: UNPAID } }));
    },
    // src/pages/Avisos.jsx
    Avisos: async () => {
      await Promise.all([
        q.use(['notices', school], () => read('Notice', { school_id: school }, '-created_date', 50)),
        q.use(['noticeDeliveries', user, school], () => read('NoticeDelivery', { school_id: school, recipient_user_id: user }, '-created_date', 100)),
      ]);
    },
    // src/pages/MisHijos.jsx
    MisHijos: async () => { await linked(); },
    // src/pages/Pagos.jsx
    Pagos: async () => {
      const ctx = await linked();
      const ids = ctx?.studentIds || [];
      if (ids.length) await q.use(['charges', ids], () => read('ChargeItem', { school_id: school, student_id: { $in: ids } }, '-due_date'));
    },
    // src/pages/SolicitarAusencia.jsx
    SolicitarAusencia: async () => {
      await Promise.all([
        linked(),
        q.use(['absenceNotifications', user], () => read('AbsenceNotification', { parent_id: user }, '-created_date')),
      ]);
    },
    // src/components/home/TeacherHome.jsx
    TeacherHome: async () => {
      // v1.8.2 waited for the scope before asking for the lists; v1.8.3 asks
      // for both at mount (the server scopes the lists itself).
      const scope = q.use(['teacherScope', user], () => context());
      if (chained && !(await scope)) return;
      await Promise.all([scope, q.use(['todayDiaries', 'teacherHome', TODAY, user, school], () => readMany({
        diaries: ['DiaryEntry', { school_id: school, date: TODAY }],
        events: ['Event', { school_id: school, date: { $gte: TODAY } }, 'date', 3],
        deliveries: ['NoticeDelivery', { school_id: school, status: 'SENT' }, '-created_date', 100],
        urgent: ['Notice', { school_id: school, priority: 'URGENT' }, '-created_date', 50],
      }))]);
    },
    // src/pages/AvisosMaestro.jsx (+ src/lib/notifications/readInbox.js)
    AvisosMaestro: async () => {
      await Promise.all([
        q.use(['linkedClassrooms', user], () => context()),
        q.use(['teacherNotices', user], () => read('Notice', { author_id: user }, '-created_date', 20)),
        q.use(['noticeDeliveries', 'teacherInbox', user, school], () => Promise.all([
          read('NoticeDelivery', { school_id: school, recipient_user_id: user }, '-created_date', 50),
          read('Notice', { school_id: school }, '-created_date', 50),
        ])),
      ]);
    },
    // src/pages/CrearBitacora.jsx
    CrearBitacora: async () => {
      const ctx = await q.use(['teacherClassrooms', user], () => context());
      const room = ctx?.classroomIds?.[0];
      if (!room) return;
      await Promise.all([
        q.use(['students', room], () => read('Student', { classroom_id: room, is_active: true }, 'first_name')),
        q.use(['todayDiaries', room, TODAY], () => read('DiaryEntry', { classroom_id: room, date: TODAY })),
      ]);
    },
    // src/components/home/AdminHome.jsx
    AdminHome: async () => {
      await Promise.all([
        q.use(['pendingUsers', school], () => read('UserProfile', { school_id: school, status: 'PENDING' })),
        q.use(['allProfiles', school], () => read('UserProfile', { school_id: school })),
        q.use(['allClassrooms', school], () => read('Classroom', { school_id: school, is_active: true })),
        q.use(['schoolStudents', school, 'active'], () => read('Student', { school_id: school, is_active: true })),
        q.use(['overdueCharges', school], () => read('ChargeItem', { school_id: school, status: { $in: UNPAID } })),
        q.use(['homeSetupGuide', school], () => read('SchoolSetupGuide', { school_id: school })),
        q.use(['homeTeacherAssignments', school], () => read('TeacherClassroom', { school_id: school, is_active: true })),
        q.use(['homeParentLinks', school], () => read('ParentStudent', { school_id: school, status: 'ACTIVE' })),
        q.use(['homeEmergencyContacts', school], () => read('EmergencyContact', { school_id: school }, undefined, 5000)),
        q.use(['adminUnreadUrgentNotices', school], async () => {
          // v1.8.2 read these one after the other; v1.8.3 at once.
          if (chained) {
            await read('Notice', { school_id: school, priority: 'URGENT' }, '-created_date', 50);
            return read('NoticeDelivery', { school_id: school, status: 'SENT' }, '-created_date', 200);
          }
          return Promise.all([
            read('Notice', { school_id: school, priority: 'URGENT' }, '-created_date', 50),
            read('NoticeDelivery', { school_id: school, status: 'SENT' }, '-created_date', 200),
          ]);
        }),
      ]);
    },
    // src/pages/AvisosAdmin.jsx
    AvisosAdmin: async () => {
      await Promise.all([
        q.use(['allClassrooms', school], () => read('Classroom', { school_id: school, is_active: true })),
        q.use(['schoolStudents', school, 'active'], () => read('Student', { school_id: school, is_active: true })),
        q.use(['adminNotices', school], () => read('Notice', { school_id: school }, '-created_date', 30)),
      ]);
    },
    // src/pages/Reportes.jsx
    Reportes: async () => {
      const range = { school_id: school, date: { $gte: '2026-09-16', $lte: TODAY } };
      await Promise.all([
        q.use(['allStudents', school], () => read('Student', { school_id: school })),
        q.use(['allClassrooms', school], () => read('Classroom', { school_id: school, is_active: true })),
        q.use(['attendanceReport', school], () => read('Attendance', range, 'date', SCHOOL_READ_ALL)),
        q.use(['diariesReport', school], () => read('DiaryEntry', range, 'date', SCHOOL_READ_ALL)),
        q.use(['unpaidChargesReport', school], () => read('ChargeItem', { school_id: school, status: { $in: UNPAID } })),
        q.use(['notices', school, 'report'], () => read('Notice', { school_id: school }, '-created_date', 100)),
        q.use(['upcomingEvents', school], () => read('Event', { school_id: school, date: { $gte: TODAY } }, 'date', 10)),
      ]);
    },
  };
}

export const ROUTES = {
  director: { home: 'AdminHome', visits: ['AvisosAdmin', 'Reportes'] },
  teacher1: { home: 'TeacherHome', visits: ['AvisosMaestro', 'CrearBitacora'] },
  parent1: { home: 'ParentHome', visits: ['Avisos', 'Pagos', 'MisHijos', 'SolicitarAusencia'] },
};

// --- One person browsing -----------------------------------------------------

function makeSession({ mode, platform, user, now, sleep }) {
  const client = platform.client(user);
  const retryOpts = { retry: { sleep, cooldown: makeCooldown({ now }) } };
  const call = (payload) => (mode === 'before'
    ? invokeFunction(client, 'schoolRead', payload, { idempotent: false })
    : invokeFunction(client, 'schoolRead', payload, retryOpts));
  const reader = makeSchoolReader(call, mode === 'before'
    ? {}
    : { batch: true, contextTtlMs: 30000, now, schedule: (fn, ms) => setTimeout(fn, ms / SCALE) });
  const q = makeQueryCache({ mode, now, sleep });
  let storedSubscription = null; // this tab's sessionStorage (after only)
  const shell = async () => {
    if (mode === 'after' && storedSubscription && now() - storedSubscription.at < SUBSCRIPTION_FRESH_MS) return;
    await q.use(['mySubscription', user, 'A'], async () => {
      const body = mode === 'before'
        ? await invokeFunction(client, 'getMySubscription', {}, { idempotent: false })
        : await invokeFunction(client, 'getMySubscription', {}, retryOpts);
      storedSubscription = { at: now() };
      return body;
    });
  };
  const s = screens({ q, read: reader.read, readMany: reader.readMany, context: reader.context, user, chained: mode === 'before' });
  return {
    q,
    async visit(name, { reload = false } = {}) {
      if (reload) q.clear();
      await Promise.all([shell(), s[name]()]);
    },
  };
}

// --- Measurements --------------------------------------------------------------

function clock() {
  const t0 = Date.now();
  return {
    now: () => (Date.now() - t0) * SCALE,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms) / SCALE)),
  };
}

/** One cold visit of one screen, alone: invocations and service-role calls. */
export async function measureScreen(mode, user, screen) {
  const { now, sleep } = clock();
  const platform = makePlatform({ mode, now, sleep });
  const session = makeSession({ mode, platform, user, now, sleep });
  await session.visit(screen);
  return { invocations: platform.stats.invocations, serviceOps: platform.stats.serviceOps, userOps: platform.stats.userOps };
}

export async function measureAllScreens() {
  const rows = [];
  for (const [user, route] of Object.entries(ROUTES)) {
    for (const screen of [route.home, ...route.visits]) {
      const before = await measureScreen('before', user, screen);
      const after = await measureScreen('after', user, screen);
      rows.push({ user, screen, before, after });
    }
  }
  return rows;
}

/**
 * Three people (director, teacher, parent) browsing at once: home, a screen,
 * home, the next screen… with `thinkMs` between screens, `rounds` times.
 * `reload` makes every screen a full page load (what the live QA harness did).
 */
export async function measureConcurrent(mode, { rounds = 3, thinkMs = 1500, reload = false } = {}) {
  const { now, sleep } = clock();
  const platform = makePlatform({ mode, now, sleep });
  const sessions = Object.entries(ROUTES).map(([user, route]) => ({
    user, route, session: makeSession({ mode, platform, user, now, sleep }),
  }));
  await Promise.all(sessions.map(async ({ route, session }) => {
    for (let r = 0; r < rounds; r += 1) {
      for (const screen of route.visits) {
        await session.visit(route.home, { reload });
        await sleep(thinkMs);
        await session.visit(screen, { reload });
        await sleep(thinkMs);
      }
    }
  }));
  const failedQueries = sessions.reduce((n, s) => n + s.session.q.outcome.failedQueries, 0);
  return {
    invocations: platform.stats.invocations,
    serviceOps: platform.stats.serviceOps,
    rateLimitedInvocations: platform.stats.rateLimited,
    failedQueries,
    virtualSeconds: Math.round(now() / 1000),
  };
}

// --- CLI ------------------------------------------------------------------------

function pct(before, after) {
  return before ? `${Math.round((1 - after / before) * 100)}%` : '—';
}

export const SCENARIOS = [
  // The live QA harness on 2026-10-01: a full page load every ~1.5 s per person.
  { name: 'QA pace, reloads', thinkMs: 1500, reload: true },
  { name: 'QA pace, in-app', thinkMs: 1500, reload: false },
  { name: 'brisk, reloads', thinkMs: 5000, reload: true },
  { name: 'brisk, in-app', thinkMs: 5000, reload: false },
  // A person reading each screen for ~15 s before moving on.
  { name: 'human, reloads', thinkMs: 15000, reload: true },
  { name: 'human, in-app', thinkMs: 15000, reload: false },
];

async function main() {
  const json = process.argv.includes('--json');
  const screensTable = await measureAllScreens();
  const concurrent = [];
  for (const scenario of SCENARIOS) {
    const before = await measureConcurrent('before', scenario);
    const after = await measureConcurrent('after', scenario);
    concurrent.push({ ...scenario, before, after });
  }
  if (json) {
    console.log(JSON.stringify({ screens: screensTable, concurrent }, null, 2));
    return;
  }
  console.log('Per screen, one cold visit (function invocations / service-role entity calls):\n');
  console.log('screen               | before inv | after inv | before ops | after ops | ops saved');
  console.log('---------------------|-----------:|----------:|-----------:|----------:|---------:');
  const total = { bi: 0, ai: 0, bo: 0, ao: 0 };
  for (const { screen, before, after } of screensTable) {
    total.bi += before.invocations; total.ai += after.invocations; total.bo += before.serviceOps; total.ao += after.serviceOps;
    console.log(`${screen.padEnd(20)} | ${String(before.invocations).padStart(10)} | ${String(after.invocations).padStart(9)} | ${String(before.serviceOps).padStart(10)} | ${String(after.serviceOps).padStart(9)} | ${pct(before.serviceOps, after.serviceOps).padStart(8)}`);
  }
  console.log(`${'TOTAL'.padEnd(20)} | ${String(total.bi).padStart(10)} | ${String(total.ai).padStart(9)} | ${String(total.bo).padStart(10)} | ${String(total.ao).padStart(9)} | ${pct(total.bo, total.ao).padStart(8)}`);
  console.log('\nDirector + teacher + parent browsing at once (3 rounds of their routes),');
  console.log('150 service-role calls per rolling minute. "failed" = queries that reached');
  console.log('the screen as a failure after every retry (before: rendered as an empty list):\n');
  console.log('scenario          | inv before | inv after | ops/min before | ops/min after | rate-limited before | after | failed before | after');
  console.log('------------------|-----------:|----------:|---------------:|--------------:|--------------------:|------:|--------------:|------:');
  for (const { name, before, after } of concurrent) {
    const perMin = (r) => Math.round(r.serviceOps / Math.max(1, r.virtualSeconds / 60));
    console.log(`${name.padEnd(17)} | ${String(before.invocations).padStart(10)} | ${String(after.invocations).padStart(9)} | ${String(perMin(before)).padStart(14)} | ${String(perMin(after)).padStart(13)} | ${String(before.rateLimitedInvocations).padStart(19)} | ${String(after.rateLimitedInvocations).padStart(5)} | ${String(before.failedQueries).padStart(13)} | ${String(after.failedQueries).padStart(5)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
