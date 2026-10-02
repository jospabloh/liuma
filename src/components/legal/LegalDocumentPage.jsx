import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { ACACIA_LEGAL_IDENTITY, DATA_PROCESSORS, LEGAL_DOCUMENTS } from '@/lib/legal/legalDocs';

/**
 * Public page for one of LIUMA's legal documents (Aviso de Privacidad,
 * Términos del servicio). Mounted by src/App.jsx OUTSIDE the auth/profile gate:
 * the onboarding consent checkbox links here, and the person reading it has
 * no profile yet — a GuardedRoute would deny them the very text they are
 * being asked to accept (which is how the old link ended up on a 404).
 *
 * The texts are final (vigente since 2026-10-02); the page shows the version
 * and the date they took effect. A section may carry a `table` (the retention
 * schedule): it renders as one card per row, so it reads on a 320px phone
 * without a horizontal scroll.
 *
 * No entity reads, no SDK calls: it cannot leak tenant data.
 */
export default function LegalDocumentPage({ doc }) {
  const others = LEGAL_DOCUMENTS.filter((d) => d.id !== doc.id);

  React.useEffect(() => {
    const previous = document.title;
    document.title = `${doc.title} · LIUMA`;
    return () => { document.title = previous; };
  }, [doc]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <Link to="/" className="inline-flex items-center gap-1.5 coarse:min-h-11 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Volver a LIUMA
        </Link>

        <header className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold">{doc.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Vigente desde el {doc.effectiveDate} · Versión {doc.version}
          </p>
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
              {section.table && (
                <div className="mb-2">
                  <ul className="space-y-2" aria-label={section.table.caption}>
                    {section.table.rows.map((row) => (
                      <li key={row[0]} className="rounded-lg border border-border bg-card p-3 text-sm">
                        {row.map((cell, i) => (
                          <p key={section.table.columns[i]} className={i === 0 ? 'font-medium text-foreground' : 'mt-1 text-muted-foreground'}>
                            {i > 0 && <span className="font-medium text-foreground">{section.table.columns[i]}: </span>}
                            {cell}
                          </p>
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {section.items && (
                <ul className="list-disc pl-5 space-y-1.5 text-sm leading-relaxed text-muted-foreground mb-2">
                  {section.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              )}
              {section.closing && (
                <p className="text-sm leading-relaxed text-muted-foreground">{section.closing}</p>
              )}
            </section>
          ))}
        </div>

        <footer className="mt-10 border-t border-border pt-6 text-sm text-muted-foreground flex flex-wrap gap-x-4 gap-y-2">
          {others.map((d) => (
            <Link key={d.id} to={d.path} className="inline-flex items-center coarse:min-h-11 text-foreground underline">{d.title}</Link>
          ))}
          <span>LIUMA es un producto de {ACACIA_LEGAL_IDENTITY.legalName}.</span>
        </footer>
      </div>
    </div>
  );
}
