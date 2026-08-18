import React from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/card';
import { APP_VERSION, RELEASE_DATE } from '@/lib/appConfig';

// User-facing digest of CHANGELOG.md — plain-language summaries, not the raw
// technical entries. Update this array (and appConfig.js's APP_VERSION /
// RELEASE_DATE) alongside a real CHANGELOG.md release; see the portfolio
// convention in stockflow/cateqhub/puntos/radar's own HistorialCambios or
// ChangeLog pages.
const CHANGES = [
  {
    date: '2026-08-18',
    title: 'Seguridad y cuenta',
    items: [
      'Corregido: una falla de seguridad permitía que un administrador viera o modificara datos de otras escuelas en ciertos casos — ya no es posible.',
      'Los permisos personalizados que un administrador asigna a un maestro o padre ahora se aplican también del lado del servidor, no solo en la pantalla.',
      'Si tu escuela está en modo de solo lectura por facturación, el sistema ahora lo aplica de forma consistente en todas las acciones.',
    ],
  },
  {
    date: '2026-07-28',
    title: 'Historial de cambios',
    items: ['Nuevo: esta pantalla, para ver qué ha cambiado en LIUMA.'],
  },
];

export default function HistorialCambios() {
  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Historial de cambios" subtitle="Actualizaciones y mejoras recientes en LIUMA" showBack backTo="/Home" />
      <div className="max-w-2xl mx-auto px-4 sm:px-6 pb-10 space-y-4">
        {CHANGES.map((c) => (
          <Card key={c.date} className="p-5">
            <p className="text-xs text-muted-foreground mb-1">{c.date}</p>
            <p className="font-semibold text-foreground mb-2">{c.title}</p>
            <ul className="list-disc list-inside space-y-1">
              {c.items.map((i) => (
                <li key={i} className="text-sm text-muted-foreground">{i}</li>
              ))}
            </ul>
          </Card>
        ))}
        <p className="text-center text-xs text-muted-foreground pt-2">
          Versión {APP_VERSION} · {RELEASE_DATE}
        </p>
      </div>
    </div>
  );
}
