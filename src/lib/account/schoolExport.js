import { base44 } from '@/api/base44Client';
import { invokeFunction } from '@/lib/functionResponse';
import { exportCompleteness, runExportRounds } from './schoolExportStatus';

/**
 * "Descargar datos de la escuela": asks exportSchoolData (ACTIVE ADMIN only,
 * school derived on the server) and hands the JSON to the browser as a file.
 *
 * Shared by Permisos y Roles and the account-deletion screen. It works in
 * read-only mode and without the current consent on purpose: it is how a
 * school takes its data with it ("nothing is held hostage"), and the sole
 * director who declines the new texts is exactly who needs it before asking
 * for the school to be deleted. Throws on failure; callers show the toast.
 * Returns { complete, missing } (exportCompleteness): an incomplete file is
 * still downloaded, but callers must say it is not a full backup.
 */
export async function downloadSchoolExport(schoolId) {
  // Several calls when the server runs out of time (it answers `resume`),
  // merged into one file; complete only if every entity finished.
  const payload = await runExportRounds((body) => invokeFunction(base44, 'exportSchoolData', body));
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `liuma-${schoolId || 'escuela'}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return exportCompleteness(payload);
}
