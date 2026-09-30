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
    date: '2026-09-30',
    title: 'Versión 1.8.1: correcciones de la prueba en vivo',
    items: [
      'Corregido: el avance de bitácoras del inicio del maestro cuenta alumnos, no bitácoras. Si un alumno tenía dos bitácoras y otro ninguna, decía "Completo"; ya no.',
      'Corregido: al entrar a crear una bitácora sin haber elegido salón, la app te pide elegirlo (o lo elige sola si sólo tienes uno) en lugar de decir que todas estaban completas.',
      'Corregido: la bienvenida del periodo de prueba ya sólo aparece si tu escuela está en prueba, y tiene un solo botón para cerrarla.',
      'Más privacidad: la información de tu licencia ya no incluye datos internos de quien la dio de alta.',
    ],
  },
  {
    date: '2026-09-29',
    title: 'Versión 1.8: registro, licencia, Lumi y mucho más confiable',
    items: [
      'Nuevo: crear tu escuela o unirte a una ahora funciona de principio a fin. Cada escuela tiene un código corto (por ejemplo ABCD-EFGH) que la dirección puede copiar o compartir por WhatsApp desde su inicio.',
      'Nuevo: avisos antes de que venza tu prueba o tu licencia, y un botón para pagar. Si la licencia vence, la escuela queda en modo de solo lectura: puedes consultar todo y descargar tus datos, y nada se borra.',
      'Nuevo: Aviso de Privacidad y Términos del servicio dentro de la app, y una sección de Ayuda con los primeros pasos para cada rol. Los textos legales todavía son un borrador en revisión y así lo indican.',
      'Lumi responde mejor: sólo con información a la que tienes acceso, en español, y pide confirmación antes de registrar algo. El chat muestra cuando está pensando y te deja reintentar si algo falla.',
      'Corregido: guardar una bitácora con aviso a los padres, marcar asistencia, la alerta de emergencia, los recordatorios de pago y la lista de miembros de la escuela fallaban o no avisaban a nadie. Ahora funcionan y te dicen a cuántas personas llegó el mensaje.',
      'Corregido: las fechas (tareas, pagos, eventos, ausencias) ya no aparecen un día antes, y los reportes de asistencia muestran el porcentaje real.',
      'Mejor modo oscuro en avisos, pagos y estados; mensajes de error en español que dicen qué pasó; y si se corta la conexión, la app te lo dice en lugar de quedarse en blanco.',
      'Más seguridad: los cambios importantes (perfiles, avisos, asistencia, contactos de emergencia, tickets) ahora se validan en el servidor.',
    ],
  },
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
