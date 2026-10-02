import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import SignOutButton from '@/components/auth/SignOutButton';
import {
  PRIVACY_NOTICE_PATH,
  SERVICE_TERMS_PATH,
  consentIsComplete,
  sensitiveConsentLabel,
} from '@/lib/consent/privacyNotice';
import { LEGAL_EFFECTIVE_DATE } from '@/lib/legal/legalDocs';
import { CONSENT_STATUS_QUERY_KEY, acceptCurrentConsent } from '@/lib/consent/consentApi';
import { functionErrorCode } from '@/lib/functionResponse';
import { humanizeError } from '@/lib/errorMessages';

// The Radix checkbox is 16px; its ::after grows the tappable box to 44px
// (16 - 2px border + 2 x 15px), the same trick as sonner's close button.
// Measured by scripts/touch-targets-scan.mjs.
const CHECKBOX_CLASS = 'mt-0.5 relative after:absolute after:-inset-[15px]';

const linkClass = 'text-brand underline underline-offset-2 coarse:inline-flex coarse:min-h-11 coarse:items-center';

/**
 * The blocking consent screen (ConsentGate). Same two acceptances as
 * onboarding — the Aviso + Términos, and the express consent for minors'
 * sensitive data worded for the person's role — so a re-acceptance records
 * exactly what a new signup records. Mobile first: one column, 44px targets
 * on touch, the legal texts open in a new tab so nothing typed is lost.
 */
export default function ConsentScreen({ role, acceptedVersion = null, declinePath }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [consent, setConsent] = React.useState({ general: false, sensitive: false });
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);

  const handleAccept = async () => {
    if (!consentIsComplete(consent) || saving) return;
    setSaving(true);
    setError(null);
    try {
      await acceptCurrentConsent(consent);
      // Let the gate pass now, and re-read the profile so its stamp is the
      // one every later render (and the server) agrees on.
      queryClient.setQueriesData({ queryKey: [CONSENT_STATUS_QUERY_KEY] }, (old) => ({ ...(old || {}), required: false }));
      await queryClient.invalidateQueries({ queryKey: ['userProfile'] });
    } catch (e) {
      const code = functionErrorCode(e);
      setError({ code, message: humanizeError(e) });
      setSaving(false);
    }
  };

  const versionChanged = error?.code === 'CONSENT_VERSION_MISMATCH';

  return (
    <div className="min-h-screen bg-background px-4 py-8 sm:py-12">
      <main className="mx-auto w-full max-w-lg space-y-5" aria-labelledby="consent-title">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand" aria-hidden="true">
            <ShieldCheck className="h-6 w-6" />
          </span>
          <h1 id="consent-title" className="text-xl font-semibold text-foreground">Antes de continuar</h1>
        </div>

        <div className="space-y-3 rounded-2xl border border-border bg-card p-4 sm:p-5 text-card-foreground">
          <p className="text-sm text-foreground">
            {acceptedVersion
              ? `Actualizamos el Aviso de Privacidad y los Términos del servicio de LIUMA (vigentes desde el ${LEGAL_EFFECTIVE_DATE}).`
              : `No tenemos registrada tu aceptación de la versión vigente del Aviso de Privacidad y de los Términos del servicio de LIUMA (vigentes desde el ${LEGAL_EFFECTIVE_DATE}).`}
            {' '}Para seguir usando LIUMA necesitas leerlos y aceptarlos.
          </p>
          <ul className="space-y-1 text-sm">
            <li>
              <a href={PRIVACY_NOTICE_PATH} target="_blank" rel="noopener noreferrer" className={linkClass}>
                Leer el Aviso de Privacidad
              </a>
            </li>
            <li>
              <a href={SERVICE_TERMS_PATH} target="_blank" rel="noopener noreferrer" className={linkClass}>
                Leer los Términos del servicio
              </a>
            </li>
          </ul>

          <fieldset className="space-y-1 border-t border-border pt-3">
            <legend className="sr-only">Aceptación</legend>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
              <Checkbox
                checked={consent.general}
                onCheckedChange={(value) => setConsent((c) => ({ ...c, general: value === true }))}
                className={CHECKBOX_CLASS}
                aria-label="Acepto el Aviso de Privacidad y los Términos del servicio"
              />
              <span className="text-sm text-muted-foreground">
                He leído y acepto el Aviso de Privacidad y los Términos del servicio, y el tratamiento de mis datos personales.
              </span>
            </label>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
              <Checkbox
                checked={consent.sensitive}
                onCheckedChange={(value) => setConsent((c) => ({ ...c, sensitive: value === true }))}
                className={CHECKBOX_CLASS}
                aria-label="Consentimiento expreso de datos sensibles"
              />
              <span className="text-sm text-muted-foreground">{sensitiveConsentLabel(role)}</span>
            </label>
          </fieldset>

          {error ? (
            <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground space-y-2">
              <p>{error.message}</p>
              {versionChanged ? (
                <Button type="button" variant="outline" className="min-h-11" onClick={() => window.location.reload()}>
                  Recargar
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => navigate(declinePath)}
              disabled={saving}
            >
              No acepto
            </Button>
            <Button
              type="button"
              className="min-h-11 bg-brand text-white hover:bg-brand/90"
              onClick={handleAccept}
              disabled={saving || !consentIsComplete(consent)}
            >
              {saving ? <Loader2 className="h-5 w-5 animate-spin" aria-label="Guardando" /> : 'Aceptar'}
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Aceptar es obligatorio para usar LIUMA. Si no aceptas, puedes eliminar tu cuenta y tus datos; antes de confirmar
          verás qué se elimina y qué conserva tu escuela, y podrás volver a esta pantalla.
        </p>
        <div className="flex justify-start">
          <SignOutButton className="min-h-11" />
        </div>
      </main>
    </div>
  );
}
