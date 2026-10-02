// Fake Base44 for onboarding tests — with the two sides kept APART on purpose.
//
//   client.entities  = what the browser can do under the DEPLOYED RLS: School,
//                      SchoolSubscription and ConsentRecord writes/reads are
//                      platform-only, so they throw 403 here, exactly like
//                      production did. A test that passes only because the
//                      client wrote those rows would be testing a world that
//                      never existed (that was the old suite's blind spot).
//   server (sr)      = the service role provisionOnboardingProfile runs with;
//                      the stubbed functions.invoke runs the real algorithm
//                      (runOnboardingProvision) against it.
import { runOnboardingProvision } from '../../src/lib/authorization/onboardingProvision.js';
import { PRIVACY_NOTICE_VERSION } from '../../src/lib/consent/privacyNotice.js';

export function createFakeEntity(seed = [], { name = 'Entity' } = {}) {
  const rows = seed.map((r) => ({ ...r }));
  let seq = 0;
  return {
    name,
    rows,
    createCalls: [],
    updateCalls: [],
    failCreate: null,
    async filter(query = {}, order) {
      const result = rows.filter((row) => Object.entries(query).every(([k, v]) => row[k] === v));
      if (order === '-created_date') {
        return [...result].sort((a, b) => String(b.created_date || '').localeCompare(String(a.created_date || '')));
      }
      return result;
    },
    async get(id) {
      const row = rows.find((r) => r.id === id);
      if (!row) throw Object.assign(new Error('not found'), { status: 404 });
      return row;
    },
    async create(payload) {
      if (this.failCreate) throw this.failCreate;
      this.createCalls.push(payload);
      seq += 1;
      const row = { id: `${name.toLowerCase()}-${seq}`, created_date: new Date(Date.UTC(2026, 8, 29, 0, 0, seq)).toISOString(), ...JSON.parse(JSON.stringify(payload)) };
      rows.push(row);
      return row;
    },
    async update(id, payload) {
      this.updateCalls.push({ id, payload });
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows[i] = { ...rows[i], ...payload };
      return rows[i];
    },
    async list() {
      return rows;
    },
  };
}

function rlsDenied(entity) {
  const deny = async () => {
    throw Object.assign(new Error(`${entity}: permission denied`), { status: 403, data: { code: 'forbidden' } });
  };
  return { filter: deny, get: deny, create: deny, update: deny, list: deny };
}

export function createOnboardingBackend(seed = {}, actingUser, { now = new Date('2026-09-29T15:00:00Z') } = {}) {
  const sr = {
    entities: {
      School: createFakeEntity(seed.schools, { name: 'School' }),
      SchoolSubscription: createFakeEntity(seed.subscriptions, { name: 'Sub' }),
      UserProfile: createFakeEntity(seed.profiles, { name: 'Profile' }),
      ConsentRecord: createFakeEntity(seed.consents, { name: 'Consent' }),
      User: createFakeEntity(seed.users, { name: 'User' }),
    },
  };
  const invokeCalls = [];
  const client = {
    // v1.9.0: the browser never calls Core.UploadFile; the logo goes through
    // the uploadSchoolFile function (answered below).
    integrations: { Core: { UploadFile: async () => { throw new Error('browser must not call Core.UploadFile'); } } },
    entities: {
      School: rlsDenied('School'),
      SchoolSubscription: rlsDenied('SchoolSubscription'),
      ConsentRecord: rlsDenied('ConsentRecord'),
      // A PENDING joiner cannot read the admins' profiles or users either.
      UserProfile: rlsDenied('UserProfile'),
      User: rlsDenied('User'),
    },
    functions: {
      async invoke(name, body) {
        invokeCalls.push({ name, body });
        if (name === 'uploadSchoolFile') {
          return { data: { ok: true, file_url: 'https://cdn.test/logo.png', content_type: 'image/png', size: 10 }, status: 200, headers: {} };
        }
        if (name !== 'provisionOnboardingProfile') throw new Error(`unexpected function ${name}`);
        // Same shapes as the real SDK: its functions client does NOT unwrap
        // responses (interceptResponses: false), so success resolves to the
        // axios response ({ data, status, headers }) and a non-2xx rejects
        // with an AxiosError whose body is `response.data`.
        try {
          const data = await runOnboardingProvision({ user: actingUser, body, sr, now, userAgent: 'node-test' });
          return { data, status: 200, headers: {} };
        } catch (e) {
          const status = e.status || 500;
          throw Object.assign(new Error(`Request failed with status code ${status}`), {
            code: 'ERR_BAD_REQUEST',
            status,
            response: { status, data: { ok: false, code: e.code, error: e.message }, headers: {} },
          });
        }
      },
    },
  };
  return { client, sr, invokeCalls };
}

export const FULL_CONSENT = Object.freeze({
  acceptances: { general: true, sensitive: true },
  noticeVersion: PRIVACY_NOTICE_VERSION,
});
