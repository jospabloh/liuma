// In-memory stand-in for the Base44 service-role client with the bulk
// operations deleteMyAccount uses (updateMany with $set/$pull, deleteMany),
// for tests/unit/account-deletion.test.js and consent-gate.test.js.
//
// Query semantics follow MongoDB where they differ from plain equality: a
// condition on an ARRAY field matches when any element matches (that is how
// `{ notified_parent_emails: { $in: emails } }` finds a diary entry), and
// `$ne` matches a missing field. Anything not modelled THROWS, so code that
// starts relying on another operator fails here instead of passing against a
// permissive fake.
//
// `failOn` makes one operation throw, to test what a failure part-way leaves.

const OPS = new Set(['$eq', '$ne', '$in', '$nin']);

function scalarMatches(value, cond) {
  if (cond === null || typeof cond !== 'object' || Array.isArray(cond)) {
    return Array.isArray(value) ? value.includes(cond) : value === cond;
  }
  return Object.entries(cond).every(([op, operand]) => {
    if (!OPS.has(op)) throw new Error(`fake mongo: unsupported operator ${op}`);
    const values = Array.isArray(value) ? value : [value];
    switch (op) {
      case '$eq': return values.includes(operand);
      case '$ne': return !values.includes(operand);
      case '$in': return values.some((v) => operand.includes(v));
      case '$nin': return !values.some((v) => operand.includes(v));
    }
    return false;
  });
}

export function rowMatches(row, query) {
  return Object.entries(query || {}).every(([field, cond]) => {
    if (field.startsWith('$')) throw new Error(`fake mongo: unsupported root operator ${field}`);
    return scalarMatches(row[field], cond);
  });
}

function applyUpdate(row, data) {
  for (const [op, fields] of Object.entries(data || {})) {
    if (op === '$set') {
      Object.assign(row, fields);
    } else if (op === '$pull') {
      for (const [field, cond] of Object.entries(fields)) {
        if (!Array.isArray(row[field])) continue;
        row[field] = row[field].filter((v) => !scalarMatches(v, cond));
      }
    } else {
      throw new Error(`fake mongo: unsupported update operator ${op}`);
    }
  }
}

export function makeFakeMongoDb(tables, { failOn = null, integrations = null } = {}) {
  const writes = [];
  const calls = [];
  const entities = {};
  let nextId = 1;
  const maybeFail = (entity, op) => {
    if (failOn && failOn.entity === entity && failOn.op === op) throw Object.assign(new Error(failOn.message || 'boom'), { status: failOn.status });
  };
  const table = (name) => {
    if (!tables[name]) tables[name] = [];
    return tables[name];
  };
  const handler = (name) => ({
    async filter(query, sort = '-created_date', limit = 5000) {
      calls.push({ entity: name, op: 'filter', query });
      maybeFail(name, 'filter');
      const desc = String(sort || '').startsWith('-');
      const key = String(sort || '').replace(/^[-+]/, '');
      return table(name).filter((r) => rowMatches(r, query))
        .sort((a, b) => {
          const av = String(a[key] ?? '');
          const bv = String(b[key] ?? '');
          return desc ? bv.localeCompare(av) : av.localeCompare(bv);
        })
        .slice(0, limit)
        .map((r) => structuredClone(r));
    },
    async get(id) {
      calls.push({ entity: name, op: 'get', id });
      const row = table(name).find((r) => r.id === id);
      if (!row) throw new Error('not found');
      return structuredClone(row);
    },
    async create(data) {
      maybeFail(name, 'create');
      const row = { id: `new-${name}-${nextId++}`, created_date: `2026-10-02T12:00:${String(nextId).padStart(2, '0')}.000Z`, ...structuredClone(data) };
      table(name).push(row);
      writes.push({ entity: name, op: 'create', id: row.id, data: structuredClone(data) });
      return structuredClone(row);
    },
    async update(id, patch) {
      maybeFail(name, 'update');
      const row = table(name).find((r) => r.id === id);
      if (!row) throw new Error('not found');
      Object.assign(row, structuredClone(patch));
      writes.push({ entity: name, op: 'update', id, data: structuredClone(patch) });
      return structuredClone(row);
    },
    async delete(id) {
      maybeFail(name, 'delete');
      const rows = table(name);
      const index = rows.findIndex((r) => r.id === id);
      if (index < 0) throw new Error('not found');
      rows.splice(index, 1);
      writes.push({ entity: name, op: 'delete', id });
    },
    async updateMany(query, data) {
      maybeFail(name, 'updateMany');
      const hits = table(name).filter((r) => rowMatches(r, query));
      for (const row of hits) applyUpdate(row, data);
      writes.push({ entity: name, op: 'updateMany', query: structuredClone(query), data: structuredClone(data), count: hits.length });
      return { success: true, updated: hits.length, has_more: false };
    },
    async deleteMany(query) {
      maybeFail(name, 'deleteMany');
      const rows = table(name);
      const keep = rows.filter((r) => !rowMatches(r, query));
      const count = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      writes.push({ entity: name, op: 'deleteMany', query: structuredClone(query), count });
      return { success: true, deleted: count };
    },
  });
  for (const name of Object.keys(tables)) entities[name] = handler(name);
  // Entities the code touches that a test did not seed still exist (empty).
  const proxy = new Proxy(entities, {
    get(target, prop) {
      if (typeof prop === 'string' && !(prop in target)) target[prop] = handler(prop);
      return target[prop];
    },
  });
  return { entities: proxy, integrations, writes, calls, tables };
}
