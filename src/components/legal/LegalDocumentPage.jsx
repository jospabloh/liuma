import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { DATA_PROCESSORS, LEGAL_DOCUMENTS } from '@/lib/legal/legalDocs';

/**
 * Public page for one of LIUMA's legal documents (Aviso de Privacidad,
 * Términos del servicio). Mounted by src/App.jsx OUTSIDE the auth/profile gate:
 * the onboarding consent checkbox links here, and the person reading it has
 * no profile yet — a GuardedRoute would deny them the very text they are
 * being asked to accept (which is how the old link ended up on a 404).
 *
 * BORRADOR: while `doc.isDraft`, the page says so above the title, and lists
 * the points pending legal review. Do not remove the banner by hand — flip
 * PRIVACY_NOTICE_STATUS in src/lib/consent/privacyNotice.js once a lawyer has
 * signed off (see src/lib/legal/legalDocs.js).
 *
 * No entity reads, no SDK calls: it cannot leak tenant data.
 */
export default function LegalDocumentPage({ doc }) {
  const others = LEGAL_DOCUMENTS.filter((d) => d.id !== doc.id);

  React.useEffect(() => {
    const previous = document.title;
    document.title = `${doc.title}${doc.isDraft ? ' (borrador)' : ''} · LIUMA`;
    return () => { document.title = previous; };
  }, [doc]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Volver a LIUMA
        </Link>

        {doc.isDraft && (
          <div
            role="note"
            data-testid="legal-draft-banner"
            className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
          >
            <p className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
              BORRADOR pendiente de revisión legal
            </p>
            <p className="mt-1 text-sm">
              Este texto describe cómo LIUMA trata los datos hoy, pero todavía no ha sido revisado por un abogado y
              puede cambiar. Si cambia, publicaremos una nueva versión en esta misma página.
            </p>
          </div>
        )}

        <header className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold">{doc.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Versión {doc.version}</p>
        </header>

        <section aria-labelledby={`${doc.id}-summary`} className="mb-8 rounded-xl border border-border bg-card p-5">
          <h2 id={`${doc.id}-summary`} className="font-semibold mb-2">En resumen</h2>
          <ul className="list-disc pl-5 space-y-1.5 text-sm text-muted-foreground">
            {doc.summary.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </section>

        <div className="space-y-7">
          {doc.sections.map((section) => (
            <section key={section.id} id={section.id} aria-labelledby={`${doc.id}-${section.id}`}>
              <h2 id={`${doc.id}-${section.id}`} className="text-lg font-semibold mb-2">{section.heading}</h2>
              {(section.paragraphs || []).map((p) => (
                <p key={p} className="text-sm leading-relaxed text-muted-foreground mb-2">{p}</p>
              ))}
              {section.items && (
                <ul className="list-disc pl-5 space-y-1.5 text-sm leading-relaxed text-muted-foreground mb-2">
                  {section.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              )}
              {section.processors && (
                <ul className="space-y-2 mb-2">
                  {DATA_PROCESSORS.map((p) => (
                    <li key={p.name} className="rounded-lg border border-border bg-card p-3 text-sm">
                      <p className="font-medium text-foreground">{p.name} <span className="font-normal text-muted-foreground">· {p.location}</span></p>
                      <p className="text-muted-foreground">{p.role}</p>
                    </li>
                  ))}
                </ul>
              )}
              {section.closing && (
                <p className="text-sm leading-relaxed text-muted-foreground">{section.closing}</p>
              )}
            </section>
          ))}
        </div>

        {doc.isDraft && doc.reviewNotes?.length > 0 && (
          <details className="mt-10 rounded-xl border border-border bg-card p-4">
            <summary className="cursor-pointer text-sm font-medium">Puntos pendientes de revisión legal</summary>
            <ul className="mt-3 list-disc pl-5 space-y-1.5 text-sm text-muted-foreground">
              {doc.reviewNotes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </details>
        )}

        <footer className="mt-10 border-t border-border pt-6 text-sm text-muted-foreground flex flex-wrap gap-x-4 gap-y-2">
          {others.map((d) => (
            <Link key={d.id} to={d.path} className="text-brand underline">{d.title}</Link>
          ))}
          <span>LIUMA es un producto de ACACIA.</span>
        </footer>
      </div>
    </div>
  );
}
