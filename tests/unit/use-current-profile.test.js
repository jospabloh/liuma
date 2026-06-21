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

// Every page migrated onto the shared hook. They must import it, call it, and
// no longer inline the ['currentUser'] query boilerplate.
const MIGRATED_PAGES = [
  // Avisos / Pagos / Soporte families
  'Avisos', 'AvisosMaestro', 'AvisosAdmin', 'Pagos', 'PagosAdmin', 'Soporte', 'SoporteAdmin',
  // Second wave
  'BitacorasMaestro', 'GestionSalon', 'ContactosEmergencia', 'GestionAlumno',
  'CrearBitacora', 'TareaMaestro', 'Bitacora', 'Tarea', 'AlertaEmergencia',
  'GestionEscuela', 'ConfiguracionInicial', 'SolicitarAusencia', 'GestionAusencias',
  'AuditoriaAdmin', 'PanelSoporte', 'Reportes', 'Aprobaciones', 'PermisosRoles',
];

test('migrated pages adopt the shared hook and drop the inline boilerplate', () => {
  for (const page of MIGRATED_PAGES) {
    const src = read(`src/pages/${page}.jsx`);
    assert.match(src, /import \{ useCurrentProfile \} from '@\/hooks\/useCurrentProfile'/, `${page} should import the hook`);
    assert.match(src, /useCurrentProfile\(\)/, `${page} should call the hook`);
    assert.doesNotMatch(src, /queryKey: \['currentUser'\]/, `${page} should no longer inline the currentUser query`);
    assert.doesNotMatch(src, /queryKey: \['userProfile'/, `${page} should no longer inline the userProfile query`);
  }
});
