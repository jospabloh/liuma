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

export function makeFakeDb(tables) {
  const calls = [];
  const entities = {};
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
    };
  }
  return { entities, calls };
}
