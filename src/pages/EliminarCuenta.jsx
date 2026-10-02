import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { createPageUrl } from '@/utils';
import { PRIVACY_NOTICE_PATH } from '@/lib/consent/privacyNotice';
import { ACACIA_SUPPORT_EMAIL } from '@/lib/legal/legalDocs';
import {
  ACCOUNT_DELETED_FLAG_KEY,
  ACCOUNT_DELETION_TITLE,
  CONFIRMATION_WORD,
  confirmationMatches,
  deletedItems,
  deletionErrorMessage,
  deletionPageMode,
  keptItems,
} from '@/lib/account/accountDeletion';
import { DELETION_PREVIEW_QUERY_KEY, deleteMyAccount, previewAccountDeletion } from '@/lib/consent/consentApi';
import { downloadSchoolExport } from '@/lib/account/schoolExport';
import { createSupportTicket } from '@/lib/support/tickets';
import { SUPPORT_CATEGORIES, SUPPORT_PRIORITIES } from '@/lib/support/constants';
import { functionErrorBody, functionErrorCode } from '@/lib/functionResponse';
import { humanizeError } from '@/lib/errorMessages';
import SignOutButton from '@/components/auth/SignOutButton';

const SOLE_ADMIN_REQUESTS = {
  school: {
    subject: 'Solicitud de eliminación de la escuela',
    button: 'Solicitar eliminación de la escuela',
  },
  director: {
    subject: 'Solicitud: nombrar a otra persona de la dirección',
    button: 'Pedir que nombren a otra persona de la dirección',
  },
};

/**
 * "Eliminar mi cuenta y mis datos" (v1.9.0) — the option the Aviso de
 * Privacidad (§ 10) and the Términos (§ 6) promise "de tu cuenta".
 *
 * Two ways in: the menu of every role (Layout, `gated` false), and "No
 * acepto" on the mandatory consent screen (ConsentGate renders this page
 * WITHOUT the Layout, `gated` true). In both, the person can still turn back:
 * "Volver y aceptar" returns to the consent screen, "Cancelar" to Inicio.
 *
 * deleteMyAccount derives everything from the caller and re-checks the typed
 * word; this page only explains and asks. The sole ACTIVE director of a school
 * cannot delete their account (the school would have no one to represent it):
 * they get the module-7 "Solicitar eliminación de la escuela" path here, plus
 * the school export, without needing to accept the texts first.
 */
export default function EliminarCuenta({ gated = false, resume = false }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { logout } = useAuth();
  const { user, userProfile, isLoading: profileLoading } = useCurrentProfile();
  const role = userProfile?.app_role || null;

  const previewQuery = useQuery({
    queryKey: [DELETION_PREVIEW_QUERY_KEY, user?.id],
    queryFn: previewAccountDeletion,
    enabled: Boolean(user?.id),
    staleTime: 0,
  });
  const preview = previewQuery.data;
  const mode = deletionPageMode({ preview, resume });
  // Finishing a deletion that already started: no way back to "accept".
  const finishing = resume || Boolean(preview?.resume);

  const [confirmText, setConfirmText] = React.useState('');
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState('');
  const [requestReason, setRequestReason] = React.useState('');
  const [requestError, setRequestError] = React.useState('');
  const [requesting, setRequesting] = React.useState('');
  const [requestSent, setRequestSent] = React.useState('');
  const [exporting, setExporting] = React.useState(false);

  const goBack = () => navigate(gated ? '/' : createPageUrl('Home'));

  const handleDelete = async () => {
    if (!confirmationMatches(confirmText) || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteMyAccount(confirmText.trim().toUpperCase());
      try { sessionStorage.setItem(ACCOUNT_DELETED_FLAG_KEY, '1'); } catch { /* private mode */ }
      // Access is already closed on the server; close it here too: nothing
      // of this account stays in memory, and the session ends now.
      queryClient.clear();
      logout();
    } catch (e) {
      const code = functionErrorCode(e);
      setDeleteError(code ? deletionErrorMessage(code, { blocked: functionErrorBody(e)?.blocked === true }) : humanizeError(e));
      if (code === 'SOLE_ADMIN') previewQuery.refetch();
      setDeleting(false);
    }
  };

  const handleSchoolRequest = async (kind) => {
    const reason = requestReason.trim();
    if (!reason) {
      setRequestError('Escribe el motivo de la solicitud.');
      return;
    }
    if (!user || !userProfile) return;
    setRequestError('');
    setRequesting(kind);
    try {
      await createSupportTicket({
        user,
        userProfile,
        subject: SOLE_ADMIN_REQUESTS[kind].subject,
        description: reason,
        category: SUPPORT_CATEGORIES.ACCOUNT,
        priority: SUPPORT_PRIORITIES.HIGH,
      });
      setRequestReason('');
      setRequestSent(kind);
      toast.success('Solicitud enviada. El equipo de ACACIA se pondrá en contacto contigo.');
    } catch (e) {
      setRequestError(humanizeError(e));
    } finally {
      setRequesting('');
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadSchoolExport(userProfile?.school_id);
      toast.success('Descarga iniciada');
    } catch {
      toast.error('No se pudo generar la exportación');
    } finally {
      setExporting(false);
    }
  };

  const loading = profileLoading || previewQuery.isLoading;

  return (
    <div className="min-h-screen bg-background">
      {gated ? (
        <header className="mx-auto max-w-2xl px-4 sm:px-6 pt-6 pb-2">
          <h1 className="text-xl font-semibold text-foreground">{ACCOUNT_DELETION_TITLE}</h1>
          <p className="text-sm text-muted-foreground">
            {finishing
              ? 'La eliminación de tu cuenta quedó en curso y tu acceso ya está cerrado. Vuelve a confirmar para terminarla: lo que ya se hizo no se repite.'
              : 'No aceptaste el Aviso de Privacidad y los Términos. Puedes cambiar de opinión o eliminar tu cuenta.'}
          </p>
          {finishing ? <SignOutButton className="mt-3 min-h-11" /> : null}
        </header>
      ) : (
        <PageHeader title={ACCOUNT_DELETION_TITLE} subtitle="Zona de peligro" showBack backTo={createPageUrl('Home')} />
      )}

      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-4 pb-24 space-y-4">
        {gated && !finishing ? (
          <Button type="button" className="min-h-11 w-full sm:w-auto bg-brand text-white hover:bg-brand/90" onClick={goBack}>
            Volver y aceptar
          </Button>
        ) : null}

        <Card className="p-5 space-y-3">
          <h2 className="font-semibold text-foreground">Qué se elimina</h2>
          <ul className="list-disc pl-5 space-y-1.5 text-sm text-muted-foreground">
            {deletedItems(role).map((item) => <li key={item}>{item}</li>)}
          </ul>
        </Card>

        <Card className="p-5 space-y-3">
          <h2 className="font-semibold text-foreground">Qué se conserva y por qué</h2>
          <ul className="list-disc pl-5 space-y-1.5 text-sm text-muted-foreground">
            {keptItems(role).map((item) => <li key={item}>{item}</li>)}
          </ul>
          <p className="text-sm text-muted-foreground">
            El detalle está en la{' '}
            <a href={`${PRIVACY_NOTICE_PATH}#revocacion`} target="_blank" rel="noopener noreferrer" className="text-brand underline coarse:inline-flex coarse:min-h-11 coarse:items-center">
              sección 10 del Aviso de Privacidad
            </a>.
          </p>
        </Card>

        {loading ? (
          <Card className="p-5 flex items-center gap-3 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Revisando tu cuenta…
          </Card>
        ) : previewQuery.isError ? (
          <Card className="p-5 space-y-3" role="alert">
            <p className="text-sm text-foreground">{humanizeError(previewQuery.error)}</p>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => previewQuery.refetch()}>Reintentar</Button>
          </Card>
        ) : mode === 'owner' ? (
          <Card className="p-5 text-sm text-foreground" role="note">
            {deletionErrorMessage('PLATFORM_OWNER')}
          </Card>
        ) : mode === 'sole_admin' ? (
          <Card className="p-5 space-y-4 border-amber-300 dark:border-amber-700">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <div className="space-y-1">
                <h2 className="font-semibold text-foreground">No puedes eliminar tu cuenta todavía</h2>
                <p className="text-sm text-muted-foreground">
                  Eres la única persona activa de la dirección de{' '}
                  {(preview.soleAdminSchools || []).map((s) => s.name).filter(Boolean).join(', ') || 'tu escuela'}.
                  Si eliminas tu cuenta, la escuela se queda sin quien la represente ni apruebe a maestros y familias.
                  Puedes pedir que se nombre a otra persona de la dirección, o solicitar la eliminación de la escuela
                  (descarga sus datos primero: la eliminación no tiene marcha atrás).
                </p>
              </div>
            </div>
            <Button type="button" variant="outline" className="min-h-11" onClick={handleExport} disabled={exporting}>
              {exporting ? 'Generando…' : 'Descargar datos de la escuela'}
            </Button>
            <div className="space-y-2">
              <label htmlFor="sole-admin-reason" className="text-sm font-medium text-foreground">Motivo de la solicitud (obligatorio)</label>
              <Textarea
                id="sole-admin-reason"
                value={requestReason}
                onChange={(e) => { setRequestReason(e.target.value); if (requestError) setRequestError(''); }}
                aria-invalid={Boolean(requestError)}
                aria-describedby={requestError ? 'sole-admin-reason-error' : undefined}
              />
              {requestError ? <p id="sole-admin-reason-error" role="alert" className="text-sm text-red-700 dark:text-red-400">{requestError}</p> : null}
              {requestSent ? (
                <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
                  Solicitud enviada: «{SOLE_ADMIN_REQUESTS[requestSent].subject}». ACACIA te escribirá a tu correo.
                </p>
              ) : null}
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button type="button" variant="outline" className="min-h-11 h-auto whitespace-normal py-2 text-center" onClick={() => handleSchoolRequest('director')} disabled={Boolean(requesting)}>
                  {requesting === 'director' ? 'Enviando…' : SOLE_ADMIN_REQUESTS.director.button}
                </Button>
                <Button type="button" variant="destructive" className="min-h-11 h-auto whitespace-normal py-2 text-center" onClick={() => handleSchoolRequest('school')} disabled={Boolean(requesting)}>
                  {requesting === 'school' ? 'Enviando…' : SOLE_ADMIN_REQUESTS.school.button}
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          <Card className="p-5 space-y-3 border-red-300 dark:border-red-800">
            <h2 className="font-semibold text-red-700 dark:text-red-400">Confirmar la eliminación</h2>
            <p className="text-sm text-muted-foreground">
              Es definitivo: no se puede deshacer. Si después quieres volver a LIUMA, tendrás que registrarte de nuevo
              y la escuela tendrá que aprobarte otra vez.
            </p>
            <label htmlFor="delete-confirm" className="block text-sm font-medium text-foreground">
              Escribe <span className="font-mono font-semibold">{CONFIRMATION_WORD}</span> para confirmar
            </label>
            <Input
              id="delete-confirm"
              value={confirmText}
              onChange={(e) => { setConfirmText(e.target.value); if (deleteError) setDeleteError(''); }}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="h-11"
              aria-invalid={Boolean(deleteError)}
              aria-describedby={deleteError ? 'delete-error' : undefined}
            />
            {deleteError ? <p id="delete-error" role="alert" className="text-sm text-red-700 dark:text-red-400">{deleteError}</p> : null}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              {finishing ? null : (
                <Button type="button" variant="outline" className="min-h-11" onClick={goBack} disabled={deleting}>
                  {gated ? 'Volver y aceptar' : 'Cancelar'}
                </Button>
              )}
              <Button
                type="button"
                variant="destructive"
                className="min-h-11"
                onClick={handleDelete}
                disabled={deleting || !confirmationMatches(confirmText)}
              >
                {deleting ? 'Eliminando…' : ACCOUNT_DELETION_TITLE}
              </Button>
            </div>
          </Card>
        )}

        <p className="text-xs text-muted-foreground">
          ¿Dudas? Escribe a{' '}
          <a href={`mailto:${ACACIA_SUPPORT_EMAIL}`} className="text-brand underline coarse:inline-flex coarse:min-h-11 coarse:items-center">{ACACIA_SUPPORT_EMAIL}</a>.
        </p>
      </div>
    </div>
  );
}
