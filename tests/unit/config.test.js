import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

// Support email is public app config: read from VITE_SUPPORT_EMAIL with the
// ACACIA address as the default fallback.
test('config exposes the support email with a sane default', () => {
  const source = read('src/lib/config.js');
  assert.match(source, /VITE_SUPPORT_EMAIL/);
  assert.match(source, /soporte@acaciaco\.com\.mx/);
  assert.match(source, /export const SUPPORT_EMAIL\b/);
  assert.match(source, /export const SUPPORT_EMAIL_HREF/);
});

// SECURITY: the platform-owner identity must not be shipped in the client
// bundle. config.js must not embed an owner email or a VITE_ owner var.
test('config does not embed an owner email in the client bundle', () => {
  const source = read('src/lib/config.js');
  assert.doesNotMatch(source, /VITE_OWNER_EMAIL/);
  assert.doesNotMatch(source, /@gmail\.com/);
  assert.doesNotMatch(source, /OWNER_EMAIL\s*=/);
});

// The help desk surfaces the configured support email.
test('Soporte page renders the configured support email', () => {
  const source = read('src/pages/Soporte.jsx');
  assert.match(source, /from '@\/lib\/config'/);
  assert.match(source, /SUPPORT_EMAIL_HREF/);
});

// .env.example documents the public var and keeps the owner email server-side.
test('.env.example documents config without committing the owner email', () => {
  const source = read('.env.example');
  assert.match(source, /VITE_SUPPORT_EMAIL=soporte@acaciaco\.com\.mx/);
  assert.doesNotMatch(source, /@gmail\.com/);
});
