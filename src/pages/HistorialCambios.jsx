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
    date: '2026-10-02',
    title: 'Versión 1.9.0: tu nombre, avisos legales y botones más fáciles de tocar',
    items: [
      'LIUMA te pregunta cómo te llamas y usa ese nombre para saludarte y para firmar tus avisos y bitácoras. Puedes cambiarlo cuando quieras desde tu cuenta.',
      'Ya no verás tu correo en lugar de tu nombre en el saludo.',
      'Lumi ya no te ofrece cosas que tu rol no puede hacer ni especula sobre cambios de rol.',
      'El Aviso de Privacidad y los Términos ya son definitivos: dicen quién es responsable de tus datos, qué se guarda, por cuánto tiempo y con qué proveedores.',
      'En el teléfono, los botones pequeños (tema, cerrar avisos, enlaces, días del calendario) ahora son más fáciles de tocar.',
    ],
  },
  {
    date: '2026-10-01',
    title: 'Versión 1.8.5: Lumi más preciso y Reportes más claro',
    items: [
      'Lumi sólo te ofrece lo que tu rol puede consultar: a docentes ya no les ofrece pagos ni uniformes.',
      'Si dos tareas se entregan el mismo día, Lumi te dice las dos.',
      'Lumi responde las negativas en pocas líneas y no da por hecho cambios de rol ni a qué escuela pertenece un alumno.',
      'Docentes y dirección ven en Lumi si una bitácora se envió o no a la familia.',
      'En Reportes, si una parte no se pudo cargar, verás «—» en lugar de ceros.',
    ],
  },
  {
    date: '2026-10-01',
    title: 'Versión 1.8.4: correcciones al volver al inicio y en Lumi',
    items: [
      'Corregido: al regresar a Inicio desde otra pantalla, maestros y familias veían «Esta pantalla tuvo un problema». Ya no pasa.',
      'Corregido: Lumi a veces mostraba la respuesta arriba de tu pregunta y dejaba el chat bloqueado unos minutos. Ahora la conversación sale en orden y puedes seguir preguntando.',
    ],
  },
  {
    date: '2026-10-01',
    title: 'Versión 1.8.3: más confiable con varias personas a la vez, y Lumi',
    items: [
      'Corregido: cuando varias personas usaban LIUMA al mismo tiempo, algunas pantallas decían «Sin avisos» o «Sin hijos vinculados» aunque sí había datos. La app ahora pide menos cosas a la vez, reintenta sola y, si aun así no puede cargar, te lo dice con un botón «Reintentar» en lugar de mostrar la pantalla vacía.',
      'Corregido: las familias ya sólo ven las bitácoras que el maestro decidió enviarles, también al preguntarle a Lumi.',
      'Lumi responde mejor: busca las tareas pendientes del próximo mes, no confunde una ausencia de mañana con una pasada, ya no te llama por tu correo y explica mejor qué puede hacer según tu rol. Si la conexión en tiempo real falla, la respuesta llega de todos modos y tu pregunta no se pierde.',
      'Corregido: en el inicio del maestro, una sola alerta urgente ya no aparece como «4 urgentes sin leer»; cuenta sólo los avisos que te llegaron a ti.',
      'Corregido: una solicitud de ausencia tiene que ser para hoy o un día futuro, y no se puede mandar dos veces para el mismo alumno y día.',
      'Correos más claros: montos como «$1,350.00 MXN», fechas completas en español, un enlace a LIUMA en cada correo, y el recordatorio de pago ya no menciona recargos.',
      'Mejor en el teléfono: botones más fáciles de tocar en avisos, inicio de sesión, documentos, descuentos y calendario.',
      'Al crear tu cuenta o recuperar tu contraseña te avisamos que el correo con el código o el enlace llega en inglés, y qué asunto buscar.',
    ],
  },
  {
    date: '2026-09-30',
    title: 'Versión 1.8.2: pagos parciales, avisos y uso en el teléfono',
    items: [
      'Corregido: registrar un pago menor al total ya no marca el cargo como pagado. Queda en «Pago parcial» y muestra cuánto falta; las familias ven el monto original, el descuento, lo pagado y el saldo.',
      'Nuevo: botón «Enviar recordatorio» en cada cargo pendiente (como máximo uno cada 24 horas). El correo pide el saldo, y si el cargo ya venció lo dice.',
      'Corregido: un descuento viejo se puede apagar o renombrar sin tener que corregir sus datos, y un descuento nunca deja un cargo en negativo.',
      'Corregido: la alerta de emergencia ahora aparece en Avisos, con su marca de no leído, para familias y maestros. Si tienes dos hijos, cuenta una sola vez.',
      'Nuevo: las solicitudes de ausencia y los pedidos de uniforme avisan por correo a quien le toca: a la dirección y al maestro cuando llega la solicitud, y a la familia cuando se responde o cambia el pedido.',
      'Corregido: al abrir LIUMA sin sesión llegas directo a la pantalla para entrar, en español. Al cerrar sesión vuelves a ella.',
      'Mejor en el teléfono: botones y campos más fáciles de tocar, sin zoom al escribir, y títulos completos. En el calendario, cada evento se marca con un punto.',
      'Corregido: «hoy» es siempre el día de la escuela, aunque tu teléfono esté en otra zona horaria, y la fecha de fin de la prueba ya no aparece un día antes.',
      'Nuevo: la dirección puede editar los datos de un alumno, incluidos alergias, notas médicas y tipo de sangre. Los formularios dicen qué dato falta o está mal, y subir un documento que falla ya no se queda atorado.',
    ],
  },
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
          <Card key={c.title} className="p-5">
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
