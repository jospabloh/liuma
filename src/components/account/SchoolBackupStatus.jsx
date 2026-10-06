import React from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { incompleteExportMessage } from '@/lib/account/schoolExportStatus';

/**
 * Before "Solicitar eliminación de la escuela" (Permisos y Roles, and the
 * account-deletion page for the only director): what the backup actually
 * holds, and — when it is not complete, or was not downloaded — an explicit
 * "continuar sin respaldo completo". The request button stays disabled until
 * one of the two (schoolDeletionRequestAllowed). Codex review of PR #197,
 * round 10: the export used to stop at 100 rows per list and the screen still
 * said "Descarga iniciada".
 */
export default function SchoolBackupStatus({ backup, acknowledged, onAcknowledge, idPrefix = 'backup' }) {
  if (backup?.complete) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" /> Respaldo completo descargado.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {backup ? (
        <p role="alert" className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {incompleteExportMessage(backup)}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Descarga primero un respaldo completo de la escuela.</p>
      )}
      <label htmlFor={`${idPrefix}-ack`} className="flex items-start gap-2 text-sm text-foreground coarse:min-h-11">
        <input
          id={`${idPrefix}-ack`}
          type="checkbox"
          className="mt-1 h-4 w-4"
          checked={acknowledged}
          onChange={(e) => onAcknowledge(e.target.checked)}
        />
        <span>Continuar sin respaldo completo: entiendo que la eliminación de la escuela no tiene marcha atrás.</span>
      </label>
    </div>
  );
}
