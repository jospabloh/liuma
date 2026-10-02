import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useNav } from '@/components/nav/NavContext';
import { createPageUrl } from '@/utils';
import { APP_VERSION, RELEASE_DATE } from '@/lib/appConfig';
import { HELP_ROLE_LABELS, filterHelpSections } from '@/lib/help/helpContent';
import { SUPPORT_EMAIL } from '@/lib/support/constants';
import { PRIVACY_NOTICE_PATH, SERVICE_TERMS_PATH } from '@/lib/consent/privacyNotice';

/**
 * Ayuda — the in-app user manual (ACACIA standard, module 21): searchable,
 * sectioned by task, filtered to the reader's role, with the version, the
 * support channel and the legal documents one tap away. Content lives in
 * src/lib/help/helpContent.js so a test can check it against routeAccess.js.
 */
export default function Ayuda() {
  const { role } = useNav();
  const [query, setQuery] = useState('');
  const sections = useMemo(() => filterHelpSections({ role, query }), [role, query]);

  return (
    <div className="min-h-screen bg-background">
      <PageHeader
        title="Ayuda"
        subtitle={role ? `Guía de LIUMA para ${HELP_ROLE_LABELS[role]?.toLowerCase() || 'tu rol'}` : 'Guía de LIUMA'}
        showBack
        backTo={createPageUrl('Home')}
      />
      <div className="max-w-2xl mx-auto px-4 sm:px-6 pb-24 space-y-4">
        <label className="relative block">
          <span className="sr-only">Buscar en la ayuda</span>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar: asistencia, código, pagos…"
            className="pl-9 h-11"
          />
        </label>

        {sections.length === 0 ? (
          <Card className="p-5 text-sm text-muted-foreground">
            No encontramos nada con «{query}». Prueba con otra palabra o{' '}
            <Link to={createPageUrl('Soporte')} className="text-brand underline">escríbenos en Soporte</Link>.
          </Card>
        ) : (
          sections.map((section) => (
            <Card key={section.id} id={section.id} className="p-5">
              <h2 className="font-semibold text-foreground mb-2">{section.title}</h2>
              {section.steps && (
                <ol className="list-decimal pl-5 space-y-1.5 text-sm text-muted-foreground">
                  {section.steps.map((step) => <li key={step}>{step}</li>)}
                </ol>
              )}
              {(section.paragraphs || []).map((p) => (
                <p key={p} className="text-sm text-muted-foreground">{p}</p>
              ))}
            </Card>
          ))
        )}

        <footer className="pt-4 text-center text-xs text-muted-foreground space-y-1.5">
          <p>
            <Link to={PRIVACY_NOTICE_PATH} className="underline coarse:inline-flex coarse:min-h-11 coarse:items-center">Aviso de Privacidad</Link>
            {' · '}
            <Link to={SERVICE_TERMS_PATH} className="underline coarse:inline-flex coarse:min-h-11 coarse:items-center">Términos del servicio</Link>
            {' · '}
            <Link to={createPageUrl('HistorialCambios')} className="underline coarse:inline-flex coarse:min-h-11 coarse:items-center">Historial de cambios</Link>
          </p>
          <p>Soporte: <a href={`mailto:${SUPPORT_EMAIL}`} className="underline coarse:inline-flex coarse:min-h-11 coarse:items-center">{SUPPORT_EMAIL}</a></p>
          <p>LIUMA {APP_VERSION} · {RELEASE_DATE} · un producto de ACACIA</p>
        </footer>
      </div>
    </div>
  );
}
