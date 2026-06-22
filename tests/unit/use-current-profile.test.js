import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

test('useCurrentProfile/useCurrentUser reuse the shared cache keys', () => {
  const src = read('src/hooks/useCurrentProfile.js');
  assert.match(src, /export function useCurrentUser/);
  assert.match(src, /export function useCurrentProfile/);
  assert.match(src, /queryKey: \['currentUser'\]/);
  assert.match(src, /queryKey: \['userProfile', user\?\.id\]/);
  assert.match(src, /enabled: !!user/);
  // useCurrentProfile builds on useCurrentUser (no duplicated currentUser query).
  assert.match(src, /const \{ user, isLoading: userLoading \} = useCurrentUser\(\)/);
});

// Pages that need the school profile use useCurrentProfile.
const PROFILE_PAGES = [
  'Avisos', 'AvisosMaestro', 'AvisosAdmin', 'Pagos', 'PagosAdmin', 'Soporte', 'SoporteAdmin',
  'BitacorasMaestro', 'GestionSalon', 'ContactosEmergencia', 'GestionAlumno',
  'CrearBitacora', 'TareaMaestro', 'Bitacora', 'Tarea', 'AlertaEmergencia',
  'GestionEscuela', 'ConfiguracionInicial', 'SolicitarAusencia', 'GestionAusencias',
  'AuditoriaAdmin', 'PanelSoporte', 'Reportes', 'Aprobaciones', 'PermisosRoles',
  'Asistencia', 'ResumenAsistencia', 'CalendarioEscolar',
  'GestionPedidosAdmin', 'GestionDescuentos', 'GestionDocumentos',
  'PedidosUniformes', 'EventosParaPadres',
];

// Pages that only need the user use the lighter useCurrentUser.
const USER_ONLY_PAGES = ['MisHijos'];

test('profile pages adopt useCurrentProfile and drop the inline boilerplate', () => {
  for (const page of PROFILE_PAGES) {
    const src = read(`src/pages/${page}.jsx`);
    assert.match(src, /import \{ useCurrentProfile \} from '@\/hooks\/useCurrentProfile'/, `${page} should import the hook`);
    assert.match(src, /useCurrentProfile\(\)/, `${page} should call the hook`);
    assert.doesNotMatch(src, /queryKey: \['currentUser'\]/, `${page} should not inline the currentUser query`);
    assert.doesNotMatch(src, /queryKey: \['userProfile'/, `${page} should not inline the userProfile query`);
  }
});

test('user-only pages adopt useCurrentUser', () => {
  for (const page of USER_ONLY_PAGES) {
    const src = read(`src/pages/${page}.jsx`);
    assert.match(src, /import \{ useCurrentUser \} from '@\/hooks\/useCurrentProfile'/, `${page} should import useCurrentUser`);
    assert.match(src, /useCurrentUser\(\)/, `${page} should call useCurrentUser`);
    assert.doesNotMatch(src, /queryKey: \['currentUser'\]/, `${page} should not inline the currentUser query`);
  }
});

test('parent events page has no email/mutation side effect in its read query', () => {
  // The school_id fix activated a previously-dead query; its queryFn must not
  // send mass emails or flip reminder_sent on page load.
  const src = read('src/pages/EventosParaPadres.jsx');
  assert.doesNotMatch(src, /SendEmail/, 'parent page must not send email');
  assert.doesNotMatch(src, /reminder_sent/, 'parent page must not mutate reminder state on load');
});

test('no page reads school_id off the auth user (user.data is always undefined)', () => {
  // base44.auth.me() returns the user flat; school_id lives on the profile.
  // Regression guard for the latent bug fixed by routing through userProfile.
  const pagesDir = join(root, 'src', 'pages');
  for (const file of readdirSync(pagesDir).filter((f) => f.endsWith('.jsx'))) {
    const src = read(`src/pages/${file}`);
    assert.doesNotMatch(src, /user\??\.data\??\.school_id/, `${file} must not read school_id from user.data`);
  }
});
