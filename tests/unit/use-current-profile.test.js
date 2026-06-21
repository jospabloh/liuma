import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

test('useCurrentProfile reuses the shared cache keys', () => {
  const src = read('src/hooks/useCurrentProfile.js');
  // Same keys the inline boilerplate used, so the cache stays shared.
  assert.match(src, /queryKey: \['currentUser'\]/);
  assert.match(src, /queryKey: \['userProfile', user\?\.id\]/);
  assert.match(src, /enabled: !!user/);
  assert.match(src, /export function useCurrentProfile/);
});

test('the Avisos/Pagos/Soporte pages adopt the shared hook', () => {
  for (const page of [
    'Avisos', 'AvisosMaestro', 'AvisosAdmin',
    'Pagos', 'PagosAdmin',
    'Soporte', 'SoporteAdmin',
  ]) {
    const src = read(`src/pages/${page}.jsx`);
    assert.match(src, /useCurrentProfile/, `${page} should import the hook`);
    assert.match(src, /const \{ user, userProfile \} = useCurrentProfile\(\);/, `${page} should use the hook`);
    // The copy-pasted boilerplate should be gone.
    assert.doesNotMatch(src, /queryKey: \['currentUser'\]/, `${page} should no longer inline the currentUser query`);
  }
});
