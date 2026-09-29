// The body a backend function returned, from what `base44.functions.invoke`
// resolves to.
//
// @base44/sdk builds its functions client with `interceptResponses: false`
// (node_modules/@base44/sdk/dist/client.js), so `invoke()` resolves to the
// whole axios response — `{ data, status, headers, config }` — and the
// function's JSON is under `.data` (functions.types.d.ts: "The `data`
// property contains the data returned by the function"). Reading
// `result.record` straight off it is always undefined: guardedCreate /
// guardedUpdate returned undefined for every caller, so e.g. Asistencia's
// absence notice (`record.id`) never fired.
//
// Accepts a bare body too, so a test double or a future SDK that unwraps
// keeps working. Import-free so `node --test` loads it.
export function invokeBody(result) {
  if (
    result
    && typeof result === 'object'
    && 'data' in result
    && 'status' in result
    && 'headers' in result
  ) {
    return result.data;
  }
  return result;
}
