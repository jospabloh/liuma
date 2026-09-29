// What `base44.functions.invoke()` actually resolves to.
//
// The SDK builds its functions client with `interceptResponses: false`
// (node_modules/@base44/sdk/dist/client.js), so unlike `base44.entities.*`
// the promise resolves to the whole axios RESPONSE — `{ data, status,
// headers, … }` — and the function's JSON body is `response.data` (the SDK's
// own doc example reads `result.data.total`). Reading `result.subscription`
// straight off it is always undefined, which here would have meant every
// school resolving to "no license" → read-only.
//
// This accepts either shape, so a call site keeps working if the SDK ever
// starts unwrapping, and a test double may return the bare body.
export function unwrapFunctionResponse(response) {
  if (
    response &&
    typeof response === 'object' &&
    'data' in response &&
    ('status' in response || 'headers' in response || 'config' in response)
  ) {
    return response.data;
  }
  return response;
}
