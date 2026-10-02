// v1.9.0 — "Hola, h.josepablo+qa-padre". Live QA of v1.8.5 greeted a parent
// with the email handle, because the greeting read `full_name` and signup had
// left the handle there. These pin the rule (a handle is never shown as a
// name), the one place the person fixes it ("¿Cómo te llamas?", saved to the
// User custom field display_name — the SDK's updateMe cannot write
// full_name), and that the server stamps the chosen name as author.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DISPLAY_NAME_MAX, dismissNamePrompt, greetingFor, isHandleLikeName, namePromptDismissed,
  shouldPromptForName, userDisplayName, userFirstName, validateDisplayName, welcomeMayStillShow,
} from '../../src/lib/userDisplayName.js';
// The REAL server code (Node 22 strips the TS types).
import { displayUserName } from '../../base44/functions/lumiQuery/_lumiCore.ts';
import { callerDisplayName as entityCallerName, isHandleLikeName as entityHandleLike } from '../../base44/functions/guardedEntityWrite/_policy.ts';
import { callerDisplayName as familyCallerName } from '../../base44/functions/guardedFamilyWrite/_policy.ts';
import { emergencyAuthorName } from '../../base44/functions/sendBulkNotification/_fanout.ts';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}
const stripJsonc = (s) => s.replace(/^\s*\/\/.*$/gm, '');

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
}

// ------------------------------------------------------------ the rule --

const HANDLE_CASES = [
  ['h.josepablo+qa-padre', 'h.josepablo+qa-padre@gmail.com'],
  ['h.josepablo+qa-padre', ''],
  ['ana@example.com', ''],
  ['ana.lopez', 'ana.lopez@example.com'],
  ['ana', 'ana@example.com'],
  ['', ''],
  ['   ', 'x@y.z'],
  ['Ana López', 'ana@example.com'],
  ['Ana', 'otra@example.com'],
  ['María José Pérez', ''],
  ['Ma. José', ''],
  ['juan_perez', ''],
  ['laura2', ''],
];

test('isHandleLikeName answers exactly what Lumi\'s displayUserName answers', () => {
  for (const [name, email] of HANDLE_CASES) {
    assert.equal(isHandleLikeName(name, email), displayUserName(name, email) === '', `${JSON.stringify(name)} / ${email}`);
  }
});

test('the greeting never shows a handle: "Hola, Ana" or just "Hola"', () => {
  assert.equal(greetingFor({ full_name: 'h.josepablo+qa-padre', email: 'h.josepablo+qa-padre@gmail.com' }), 'Hola');
  assert.equal(greetingFor({ full_name: '', email: 'ana@example.com' }), 'Hola');
  assert.equal(greetingFor(null), 'Hola');
  assert.equal(greetingFor({ full_name: 'Ana López' }), 'Hola, Ana');
  // The name the person chose wins over signup's full_name…
  assert.equal(greetingFor({ full_name: 'h.josepablo+qa-padre', display_name: 'José Pablo' }), 'Hola, José');
  assert.equal(greetingFor({ full_name: 'Ana López', display_name: '  Anita  ' }), 'Hola, Anita');
  // …wherever this SDK version puts custom fields.
  assert.equal(greetingFor({ full_name: 'x.y', data: { display_name: 'Lucía' } }), 'Hola, Lucía');
  assert.equal(userFirstName({ display_name: 'Ana   María' }), 'Ana');
  assert.equal(userDisplayName({ display_name: 'A'.repeat(90) }).length, DISPLAY_NAME_MAX);
});

test('every place that greets or names the signed-in user goes through the helper', () => {
  for (const file of ['src/components/home/ParentHome.jsx', 'src/components/home/TeacherHome.jsx']) {
    const src = read(file);
    assert.match(src, /title=\{greetingFor\(user\)\}/, file);
    assert.doesNotMatch(src, /full_name\?\.split/, `${file} still splits full_name`);
  }
  assert.match(read('src/components/nav/SideNav.jsx'), /const personName = userDisplayName\(user\);/);
  assert.match(read('src/lib/lastIdentity.js'), /name: userDisplayName\(user\) \|\| null/);
  // An older build's remembered "Hola de nuevo, <handle>" is cleaned on read.
  assert.match(read('src/lib/lastIdentity.js'), /isHandleLikeName\(id\.name, id\.email\)/);
  // No greeting anywhere in src/ is built from full_name by hand.
  const offenders = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = `${dir}/${name}`;
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (/\.(js|jsx)$/.test(name) && /Hola[^'"`]*\$\{[^}]*full_name/.test(fs.readFileSync(full, 'utf8'))) offenders.push(full);
    }
  };
  walk(new URL('../../src', import.meta.url).pathname);
  assert.deepEqual(offenders, []);
});

// ------------------------------------------------------ "¿Cómo te llamas?" --

test('validateDisplayName accepts names and says what is wrong with anything else', () => {
  assert.deepEqual(validateDisplayName('  Ana   López '), { ok: true, value: 'Ana López' });
  assert.deepEqual(validateDisplayName("Renée O'Connor-Díaz"), { ok: true, value: "Renée O'Connor-Díaz" });
  assert.equal(validateDisplayName('Ana').ok, true);
  for (const [input, error] of [
    ['', 'Escribe tu nombre.'],
    ['   ', 'Escribe tu nombre.'],
    ['A', 'Escribe al menos 2 letras.'],
    ['A'.repeat(DISPLAY_NAME_MAX + 1), `Usa máximo ${DISPLAY_NAME_MAX} caracteres.`],
    ['ana@example.com', 'Escribe tu nombre, no tu correo.'],
    ['<script>', 'Usa solo letras, espacios, guiones y apóstrofos.'],
    ['12345', 'Escribe tu nombre con letras.'],
    ['h.josepablo+qa', 'Parece un usuario de correo. Escribe tu nombre como quieres que te veamos.'],
  ]) {
    assert.deepEqual(validateDisplayName(input), { ok: false, error }, JSON.stringify(input));
  }
  // What it accepts the greeting shows: a valid name is never hidden again.
  for (const name of ['Ana', 'Ana López', "O'Connor", 'José-Luis']) {
    assert.equal(userDisplayName({ display_name: validateDisplayName(name).value }), name);
  }
});

test('the question is asked once: no name, not dismissed on this device', () => {
  const storage = memoryStorage();
  const nameless = { id: 'u1', full_name: 'h.josepablo+qa-padre', email: 'h.josepablo+qa-padre@gmail.com' };
  assert.equal(shouldPromptForName(nameless, storage), true);
  assert.equal(shouldPromptForName({ ...nameless, display_name: 'José' }, storage), false);
  assert.equal(shouldPromptForName({ id: 'u2', full_name: 'Ana López' }, storage), false);
  assert.equal(shouldPromptForName(null, storage), false);
  dismissNamePrompt('u1', storage);
  assert.equal(namePromptDismissed('u1', storage), true);
  assert.equal(shouldPromptForName(nameless, storage), false, '"Ahora no" sticks');
  assert.equal(shouldPromptForName({ ...nameless, id: 'u3' }, storage), true, 'per user');
  // Blocked storage never breaks the app: it just may ask again.
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.doesNotThrow(() => dismissNamePrompt('u1', throwing));
  assert.equal(shouldPromptForName(nameless, throwing), true);
});

test('the dialog saves display_name through updateMe — never full_name', () => {
  const dialog = read('src/components/account/DisplayNameDialog.jsx');
  assert.match(dialog, /base44\.auth\.updateMe\(\{ display_name: checked\.value \}\)/);
  assert.doesNotMatch(dialog, /updateMe\([^)]*full_name/);
  assert.match(dialog, /validateDisplayName\(value\)/);
  assert.match(dialog, /queryKey: \['currentUser'\]/, 'refreshes the one user query every screen reads');
  assert.match(dialog, /'Ahora no'/);
  // The SDK this repo ships says full_name cannot be changed with updateMe;
  // if that ever changes, this is the place to reconsider the custom field.
  const sdkTypes = read('node_modules/@base44/sdk/dist/modules/auth.types.d.ts');
  assert.match(sdkTypes, /`id`, `email`, `full_name`/);

  const nav = read('src/components/nav/NavContext.jsx');
  assert.match(nav, /shouldPromptForName\(user\)/);
  assert.match(nav, /welcomePending\) return;/, 'never stacked on the trial welcome');
  assert.match(nav, /<DisplayNameDialog/);
  assert.match(nav, /openNameDialog/);
  // Editable afterwards: SideNav footer (desktop) and the palette (phone).
  assert.match(read('src/components/nav/SideNav.jsx'), /onClick=\{openNameDialog\}/);
  assert.match(read('src/components/nav/CommandPalette.jsx'), /Cambiar mi nombre/);
});

test('User.display_name is self-writable; school_id and app_role stay locked', () => {
  const schema = JSON.parse(stripJsonc(read('base44/entities/User.jsonc')));
  assert.equal(schema.properties.display_name?.type, 'string');
  assert.equal(schema.properties.display_name?.rls, undefined, 'the user writes it with updateMe');
  assert.deepEqual(schema.properties.school_id.rls, { write: false });
  assert.deepEqual(schema.properties.app_role.rls, { write: false });
  // No RLS rule anywhere reads it: it names, it never grants.
  for (const file of fs.readdirSync(new URL('../../base44/entities/', import.meta.url))) {
    const src = read(`base44/entities/${file}`);
    assert.doesNotMatch(src, /user\.data\.display_name/, file);
  }
});

// ------------------------------------------------------------ the server --

test('the server stamps the chosen name as author, full_name as before without one', () => {
  const cases = [
    [{ full_name: 'h.josepablo+qa-maestro', display_name: 'Laura Gómez' }, 'Laura Gómez'],
    [{ full_name: 'Laura', data: { display_name: ' Lau  G. ' } }, 'Lau G.'],
    [{ full_name: 'Laura Gómez' }, 'Laura Gómez'],
    [{ full_name: 'Laura Gómez', display_name: '   ' }, 'Laura Gómez'],
    [{ display_name: 'B'.repeat(80) }, 'B'.repeat(60)],
    // Self-written with updateMe: an address that skipped the dialog is not a name.
    [{ full_name: 'Laura Gómez', display_name: 'laura@example.com' }, 'Laura Gómez'],
    [{}, ''],
    [null, ''],
  ];
  for (const [user, expected] of cases) {
    assert.equal(entityCallerName(user), expected, JSON.stringify(user));
    assert.equal(familyCallerName(user), expected, JSON.stringify(user));
  }
  // The two copies are the same code, rule and labels included (functions
  // cannot import across directories).
  const fnText = (p) => read(p).match(/\/\/ The author name a write stamps[\s\S]*?export function callerDisplayName[\s\S]*?\n}\n/)[0];
  assert.equal(fnText('base44/functions/guardedEntityWrite/_policy.ts'), fnText('base44/functions/guardedFamilyWrite/_policy.ts'));

  // Every stamp passes the caller's role, so a missing name becomes the role.
  assert.match(read('base44/functions/guardedEntityWrite/entry.ts'), /data\[attribution\.name\] = callerDisplayName\(user, profile\?\.app_role \|\| \(isPlatformOwner \? 'ADMIN' : ''\)\);/);
  assert.match(read('base44/functions/guardedEntityWrite/_schoolWrite.ts'), /userName: callerDisplayName\(user, appRole\),/);
  assert.match(read('base44/functions/guardedFamilyWrite/entry.ts'), /userName: callerDisplayName\(user, isAdmin \? 'ADMIN' : 'PARENT'\),/);
  assert.doesNotMatch(read('base44/functions/guardedEntityWrite/_policy.ts'), /requester_name: [^\n]*userEmail/, 'a ticket never names its requester by address');
  assert.match(read('base44/functions/lumiQuery/entry.ts'), /user_name: displayUserName\(user\.display_name \|\| user\.data\?\.display_name, user\.email\) \|\| displayUserName\(user\.full_name, user\.email\)/);
  assert.match(read('base44/functions/listSchoolMembers/entry.ts'), /full_name: String\(u\.display_name \|\| u\.data\?\.display_name \|\| u\.full_name \|\| ''\)/);

  assert.equal(emergencyAuthorName({ full_name: 'h.josepablo+qa-director@gmail.com', display_name: 'Laura' }), 'Laura');
  assert.equal(emergencyAuthorName({ full_name: 'Laura Gómez', display_name: '' }), 'Laura Gómez');
});

test('the server never stamps an email handle as an author: the role instead (Codex review of PR #197)', () => {
  const handleUsers = [
    { full_name: 'h.josepablo+qa-maestro', email: 'h.josepablo+qa-maestro@gmail.com' },
    { full_name: 'h.josepablo', email: 'h.josepablo@gmail.com' },
    { full_name: 'maestra2026', email: 'otra@ejemplo.mx' },
    { full_name: 'laura@example.com' },
    { full_name: 'LAURA', email: 'laura@ejemplo.mx' }, // equals the local part
    // A self-written display_name that skipped the dialog is checked too.
    { display_name: 'h.josepablo', full_name: 'h.josepablo', email: 'h.josepablo@gmail.com' },
    { display_name: 'juan_perez' },
    {},
  ];
  for (const user of handleUsers) {
    for (const [role, label] of [['ADMIN', 'Dirección'], ['TEACHER', 'Docente'], ['PARENT', 'Familia'], ['', ''], [undefined, '']]) {
      assert.equal(entityCallerName(user, role), label, `${JSON.stringify(user)} as ${role}`);
      assert.equal(familyCallerName(user, role), label, `${JSON.stringify(user)} as ${role}`);
    }
  }
  // A handle-like display_name falls through to a real full_name.
  assert.equal(entityCallerName({ display_name: 'h.jose', full_name: 'José Pablo H.' }, 'TEACHER'), 'José Pablo H.');
  // Real names are untouched, whatever the role.
  assert.equal(entityCallerName({ full_name: 'Laura', email: 'lgomez@ejemplo.mx' }, 'TEACHER'), 'Laura');
  assert.equal(familyCallerName({ display_name: 'Ana María', full_name: 'a.maria' }, 'PARENT'), 'Ana María');

  // One rule for "is this a handle": the greeting's, Lumi's and the stamp's.
  const samples = ['', 'Laura', 'Laura Gómez', 'h.josepablo', 'h.josepablo+qa', 'ana_m', 'maestra2026', 'x@y.mx', 'Lau G.', 'LAURA'];
  for (const name of samples) {
    for (const email of [undefined, 'laura@ejemplo.mx']) {
      assert.equal(entityHandleLike(name, email), isHandleLikeName(name, email), `${name} / ${email}`);
      assert.equal(entityHandleLike(name, email), displayUserName(name, email) === '', `${name} / ${email} (Lumi)`);
    }
  }

  // The emergency notice's author line follows the same rule.
  assert.equal(emergencyAuthorName({ full_name: 'h.josepablo', email: 'h.josepablo@gmail.com' }), 'Dirección de la escuela');
  assert.equal(emergencyAuthorName({ display_name: 'dir_2026', full_name: 'Laura Gómez' }), 'Laura Gómez');
});

test('the name question waits for the trial welcome instead of stacking on it', () => {
  const founder = { app_role: 'ADMIN', welcome_message_shown: false };
  assert.equal(welcomeMayStillShow({ profile: founder, subscriptionLoading: true }), true, 'license still loading');
  assert.equal(welcomeMayStillShow({ profile: founder, subscription: { id: 's' }, effectiveStatus: 'trial' }), true);
  // The welcome only renders for a trial: anything else must not hold the question forever.
  assert.equal(welcomeMayStillShow({ profile: founder, subscription: { id: 's' }, effectiveStatus: 'active' }), false);
  assert.equal(welcomeMayStillShow({ profile: founder, subscription: null, effectiveStatus: 'view_only' }), false);
  assert.equal(welcomeMayStillShow({ profile: { ...founder, welcome_message_shown: true }, subscription: { id: 's' }, effectiveStatus: 'trial' }), false);
  assert.equal(welcomeMayStillShow({ profile: { app_role: 'PARENT' }, subscriptionLoading: true }), false);
  assert.equal(welcomeMayStillShow(), false);
});
