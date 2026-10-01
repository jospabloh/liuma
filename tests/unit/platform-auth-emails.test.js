import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PLATFORM_EMAILS, verifyEmailHint, resetRequestedNotice } from '../../src/lib/platformEmails.js';

// v1.8.2 live QA (2026-09-29/30): the verification-code and password-reset
// e-mails are sent by Base44 and arrive in English ("Verify your email for
// LIUMA", "Reset your password for LIUMA"). No platform setting translates them
// (see src/lib/platformEmails.js), so the Spanish login screen has to warn
// people what to look for. These tests pin that warning in place.

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

// Strip the quoted English (subject, button) the hint is SUPPOSED to contain,
// then make sure nothing else in it is English.
const withoutQuotes = (s) => s.replace(/«[^»]*»/g, '');
const ENGLISH_LEFTOVERS = /\b(the|your|email|code|password|reset|verify|click|link|expires?)\b/i;

test('verification hint names the real subject, code length and expiry, in Spanish', () => {
  const hint = verifyEmailHint();
  assert.ok(hint.includes(`«${PLATFORM_EMAILS.verify.subject}»`));
  assert.match(hint, /en inglés/);
  assert.match(hint, /6 dígitos/);
  assert.match(hint, /10 minutos/);
  assert.doesNotMatch(withoutQuotes(hint), ENGLISH_LEFTOVERS);
});

test('reset notice names the real subject and button, and keeps the no-enumeration wording', () => {
  const notice = resetRequestedNotice('mama@ejemplo.mx');
  // Must read the same whether or not the account exists.
  assert.match(notice, /^Si hay una cuenta con mama@ejemplo\.mx,/);
  assert.ok(notice.includes(`«${PLATFORM_EMAILS.reset.subject}»`));
  assert.ok(notice.includes(`«${PLATFORM_EMAILS.reset.button}»`));
  assert.match(notice, /1 hora/);
  assert.match(notice, /spam/);
  assert.doesNotMatch(withoutQuotes(notice).replace('mama@ejemplo.mx', ''), ENGLISH_LEFTOVERS);
});

test('the subjects are the ones Base44 actually sent, not a translation', () => {
  // Searching the inbox for a Spanish subject that never arrives is worse than
  // no hint at all.
  assert.equal(PLATFORM_EMAILS.verify.subject, 'Verify your email for LIUMA');
  assert.equal(PLATFORM_EMAILS.reset.subject, 'Reset your password for LIUMA');
});

test('the sender address is not quoted (a custom e-mail domain would change it)', () => {
  const src = read('src/lib/platformEmails.js');
  const code = src.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /base44-apps\.com/);
  assert.doesNotMatch(verifyEmailHint(), /@/);
});

test('Login shows both hints where the e-mail is sent', () => {
  const login = read('src/pages/Login.jsx');
  assert.match(login, /import \{ resetRequestedNotice, verifyEmailHint \} from "@\/lib\/platformEmails"/);
  assert.match(login, /setNotice\(resetRequestedNotice\(email\.trim\(\)\)\)/);
  assert.match(login, /\{verifyEmailHint\(\)\}/);
  // The old reset notice promised a plain "correo con el enlace" without
  // saying it arrives in English.
  assert.doesNotMatch(login, /te llegará un correo con el enlace para crear una contraseña nueva/);
});
