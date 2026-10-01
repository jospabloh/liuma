import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Live QA of v1.8.3: Home kept `user` in local state set from inside the
// profiles queryFn. On an in-app return to Inicio React Query serves cached
// profiles without running that queryFn, so `user` stayed null and
// TeacherHome/ParentHome crashed on `user.id` (error boundary every time).
// The user must come from its own query, not from a queryFn side effect.
test('Home derives the user from a query, never from a side effect in a queryFn', () => {
  const src = readFileSync(new URL('../../src/pages/Home.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /setUser\(/);
  assert.match(src, /queryKey: \['currentUser'\]/);
  assert.match(src, /enabled: Boolean\(user\?\.id\)/);
});
