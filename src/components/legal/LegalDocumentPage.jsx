import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { AVISO_PRIVACIDAD } from '@/lib/legal/avisoPrivacidad';
import { TERMINOS_SERVICIO } from '@/lib/legal/terminosServicio';
import {
  PRIVACY_NOTICE_IS_DRAFT,
  PRIVACY_NOTICE_URL,
  PRIVACY_NOTICE_VERSION,
  TERMS_URL,
  TERMS_VERSION,
} from '@/lib/consent/privacyNotice';

// Legal pages (Aviso de Privacidad / Términos). Mounted OUTSIDE GuardedRoute
// and in both the signed-in and signed-out branches of App.jsx: the
// onboarding consent checkbox links here, and a notice you can only read after
// accepting it is no notice.
//
// BORRADOR: while PRIVACY_NOTICE_IS_DRAFT is true every page shows the draft
// warning below. Do not remove the banner by hand — flip the flag once the
// lawyer-reviewed text replaces src/lib/legal/*.js.

const DOCUMENTS = {
  privacidad: { doc: AVISO_PRIVACIDAD, version: PRIVACY_NOTICE_VERSION, other: { to: TERMS_URL, label: 'Términos del servicio' } },
  terminos: { doc: TERMINOS_SERVICIO, version: TERMS_VERSION, other: { to: PRIVACY_NOTICE_URL, label: 'Aviso de Privacidad' } },
};

function Section({ section }) {
  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold text-foreground">{section.title}</h2>
      {(section.paragraphs || []).map((p) => (
        <p key={p} className="mt-2 text-sm leading-relaxed text-muted-foreground">{p}</p>
      ))}
      {section.bullets && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted-foreground">
          {section.bullets.map((b) => <li key={b}>{b}</li>)}
        </ul>
      )}
      {(section.after || []).map((p) => (
        <p key={p} className="mt-2 text-sm leading-relaxed text-muted-foreground">{p}</p>
      ))}
    </section>
  );
}

export default function LegalDocumentPage({ kind }) {
  const { doc, version, other } = DOCUMENTS[kind] || DOCUMENTS.privacidad;

  React.useEffect(() => {
    document.title = `${doc.title} — LIUMA`;
  }, [doc.title]);

  return (
    <main className="min-h-screen bg-background px-4 py-8">
      <article className="mx-auto max-w-2xl">
        {PRIVACY_NOTICE_IS_DRAFT && (
          <div role="note" className="mb-6 flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
            <p className="text-sm">
              <strong>Borrador pendiente de revisión legal.</strong> Este texto describe cómo funciona LIUMA hoy,
              pero todavía no lo revisa un abogado y puede cambiar. Si cambia, te pediremos aceptarlo de nuevo.
            </p>
          </div>
        )}
        <h1 className="text-2xl font-bold text-foreground">{doc.title}</h1>
        <p className="mt-1 text-xs text-muted-foreground">Versión {version}</p>
        {doc.intro.map((p) => (
          <p key={p} className="mt-4 text-sm leading-relaxed text-muted-foreground">{p}</p>
        ))}
        {doc.sections.map((s) => <Section key={s.title} section={s} />)}
        <nav className="mt-10 flex flex-wrap gap-4 border-t border-border pt-4 text-sm">
          <Link to={other.to} className="text-brand underline">{other.label}</Link>
          <Link to="/" className="text-muted-foreground underline">Volver a LIUMA</Link>
        </nav>
      </article>
    </main>
  );
}
