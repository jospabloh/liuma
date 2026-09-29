// The school join code (audit F27, owner decision 2026-09-29): short, typed on
// a phone by parents, resolved only on the server.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  buildJoinLink,
  buildJoinShareMessage,
  formatJoinCode,
  generateJoinCode,
  isLegacySchoolId,
  isValidJoinCode,
  normalizeJoinCode,
  readJoinCodeFromSearch,
} from '../../src/lib/onboarding/joinCode.js';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('the alphabet has no look-alike characters a parent could mistype', () => {
  for (const ch of ['0', 'O', '1', 'I', 'L']) assert.equal(JOIN_CODE_ALPHABET.includes(ch), false, `${ch} is ambiguous`);
  assert.equal(new Set(JOIN_CODE_ALPHABET).size, JOIN_CODE_ALPHABET.length, 'no duplicates (would bias generation)');
  // Enough space that guessing is impractical (and a guess only yields a PENDING request).
  assert.ok(JOIN_CODE_ALPHABET.length ** JOIN_CODE_LENGTH > 1e11);
});

test('codes are accepted however the parent types them', () => {
  assert.equal(normalizeJoinCode(' abcd-efgh '), 'ABCDEFGH');
  assert.equal(isValidJoinCode('abcd efgh'), true);
  assert.equal(isValidJoinCode('ABCD-EFG0'), false, '0 is not in the alphabet');
  assert.equal(isValidJoinCode('ABCDEFG'), false);
  assert.equal(formatJoinCode('abcdefgh'), 'ABCD-EFGH');
});

test('the legacy 24-hex school id is recognised as a fallback, nothing else is', () => {
  assert.equal(isLegacySchoolId('696e9b34b4402eca67ec8612'), true);
  assert.equal(isLegacySchoolId('ABCDEFGH'), false);
  assert.equal(isLegacySchoolId('696e9b34b4402eca67ec861'), false);
});

test('generation always yields a valid code, and uses rejection sampling (no modulo bias)', () => {
  for (let i = 0; i < 200; i += 1) assert.ok(isValidJoinCode(generateJoinCode()));
  // Bytes >= 248 (= 256 - 256 % 31) must be skipped, not wrapped around.
  const feed = [255, 250, 248, 0, 1, 2, 3, 4, 5, 6, 7];
  const code = generateJoinCode((n) => feed.splice(0, n).concat(Array(n).fill(0)).slice(0, n));
  assert.equal(code, 'ABCDEFGH');
});

test('the invitation link pre-fills the code the onboarding screen reads back', () => {
  const link = buildJoinLink('https://liuma.example/', 'abcdefgh');
  assert.equal(link, 'https://liuma.example/?codigo=ABCD-EFGH');
  assert.equal(readJoinCodeFromSearch(new URL(link).search), 'ABCD-EFGH');
  assert.equal(readJoinCodeFromSearch('?otra=1'), '');
  const msg = buildJoinShareMessage({ schoolName: 'Colegio', code: 'ABCDEFGH', link });
  assert.match(msg, /ABCD-EFGH/);
  assert.match(msg, /aprobará/);
});

test('the two server copies use the same alphabet and length as the client', () => {
  for (const fn of ['provisionOnboardingProfile', 'getMySubscription']) {
    const src = read(`base44/functions/${fn}/entry.ts`);
    assert.match(src, new RegExp(`const JOIN_CODE_ALPHABET = '${JOIN_CODE_ALPHABET}';`), `${fn} alphabet drifted`);
    assert.match(src, new RegExp(`const JOIN_CODE_LENGTH = ${JOIN_CODE_LENGTH};`), `${fn} length drifted`);
  }
});

test('the admin home shows the short code with copy/share, not the raw school id', () => {
  const home = read('src/components/home/AdminHome.jsx');
  assert.doesNotMatch(home, /\{school\.id\}/);
  assert.match(home, /<JoinCodeCard/);
  const card = read('src/components/school/JoinCodeCard.jsx');
  assert.match(card, /Copiar código/);
  assert.match(card, /WhatsApp/);
});
