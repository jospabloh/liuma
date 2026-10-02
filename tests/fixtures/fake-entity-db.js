// In-memory stand-in for the Base44 service-role client (`sr.entities.X`),
// just enough of the query language for base44/functions/*/_scope.ts:
// equality, array shorthand, and $eq/$ne/$in/$nin/$gt/$gte/$lt/$lte; sort by
// one field ('-' for descending), limit, skip. Anything else THROWS — so a
// planner that starts emitting $or/$regex/nested logic fails the tests
// instead of silently passing against a permissive fake.

const OPS = new Set(['$eq', '$ne', '$in', '$nin', '$gt', '$gte', '$lt', '$lte']);

function matchCond(value, cond) {
  if (cond === null || typeof cond !== 'object') return value === cond;
  if (Array.isArray(cond)) return cond.includes(value);
  return Object.entries(cond).every(([op, operand]) => {
    if (!OPS.has(op)) throw new Error(`fake db: unsupported operator ${op}`);
    switch (op) {
      case '$eq': return value === operand;
      case '$ne': return value !== operand;
      case '$in': return operand.includes(value);
      case '$nin': return !operand.includes(value);
      case '$gt': return value != null && value > operand;
      case '$gte': return value != null && value >= operand;
      case '$lt': return value != null && value < operand;
      case '$lte': return value != null && value <= operand;
    }
    return false;
  });
}

function matches(row, query) {
  return Object.entries(query || {}).every(([field, cond]) => {
    if (field.startsWith('$')) throw new Error(`fake db: unsupported root operator ${field}`);
    return matchCond(row[field], cond);
  });
}

// The world these fixtures model is one where every member has accepted the
// CURRENT Aviso de Privacidad and Términos (v1.9.0): schoolRead and the write
// paths refuse a profile without that stamp (CONSENT_REQUIRED). A UserProfile
// row that does not mention the stamp gets it; a test about the consent rule
// itself sets `consent_notice_version` explicitly (even to undefined) and is
// left alone. The versions come from the one client source.
import { PRIVACY_NOTICE_VERSION, SERVICE_TERMS_VERSION } from '../../src/lib/consent/privacyNotice.js';

export function withConsentStamp(profile) {
  if (!profile || typeof profile !== 'object' || 'consent_notice_version' in profile) return profile;
  return { ...profile, consent_notice_version: PRIVACY_NOTICE_VERSION, consent_terms_version: SERVICE_TERMS_VERSION };
}

export function makeFakeDb(tables) {
  if (Array.isArray(tables?.UserProfile)) {
    // In place: a test may hold the very row objects it seeded.
    for (const row of tables.UserProfile) Object.assign(row, withConsentStamp(row));
  }
  const calls = [];
  // Every create/update/delete, in order (P10b write-path tests).
  const writes = [];
  const entities = {};
  let nextId = 1;
  for (const [name, rows] of Object.entries(tables)) {
    entities[name] = {
      async filter(query, sort = '-created_date', limit = 5000, skip = 0) {
        calls.push({ entity: name, query, sort, limit, skip });
        const desc = String(sort || '').startsWith('-');
        const key = String(sort || '').replace(/^[-+]/, '');
        const out = rows.filter((row) => matches(row, query))
          .sort((a, b) => {
            const av = String(a[key] ?? '');
            const bv = String(b[key] ?? '');
            return desc ? bv.localeCompare(av) : av.localeCompare(bv);
          });
        return out.slice(skip, skip + limit).map((row) => ({ ...row }));
      },
      async get(id) {
        const row = rows.find((r) => r.id === id);
        if (!row) throw new Error('not found');
        return { ...row };
      },
      async create(data) {
        const row = { id: `new-${name}-${nextId++}`, created_date: '2026-09-29T12:00:00.000Z', ...data };
        rows.push(row);
        writes.push({ entity: name, op: 'create', data: { ...data }, id: row.id });
        return { ...row };
      },
      async bulkCreate(list) {
        const out = [];
        for (const data of list) out.push(await this.create(data));
        return out;
      },
      async update(id, patch) {
        const row = rows.find((r) => r.id === id);
        if (!row) throw new Error('not found');
        Object.assign(row, patch);
        writes.push({ entity: name, op: 'update', id, data: { ...patch } });
        return { ...row };
      },
      async delete(id) {
        const index = rows.findIndex((r) => r.id === id);
        if (index < 0) throw new Error('not found');
        rows.splice(index, 1);
        writes.push({ entity: name, op: 'delete', id });
      },
    };
  }
  return { entities, calls, writes };
}
