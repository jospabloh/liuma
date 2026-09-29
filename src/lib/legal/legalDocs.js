/**
 * LIUMA legal texts — Aviso de Privacidad and Términos del servicio.
 *
 * ============================================================================
 *  BORRADOR PENDIENTE DE REVISIÓN LEGAL — NO ES TEXTO DEFINITIVO.
 *  Redactado por Claude (2026-09-29) a partir del modelo de datos real de la
 *  app (base44/entities/*), por decisión del dueño, para que el checkbox de
 *  consentimiento del onboarding deje de apuntar a una página inexistente.
 *  Un abogado tiene que revisarlo antes de tratarlo como vigente. Los puntos
 *  que más necesitan esa revisión están en `reviewNotes` de cada documento y
 *  se muestran en la propia página.
 * ============================================================================
 *
 * Pure data (no JSX, no imports beyond constants) so `node --test` can load it
 * and assert what the notice has to say. The page that renders it is
 * src/components/legal/LegalDocumentPage.jsx, mounted by src/App.jsx at
 * PRIVACY_NOTICE_PATH / SERVICE_TERMS_PATH as PUBLIC routes.
 *
 * When the reviewed text lands: edit it here, bump PRIVACY_NOTICE_VERSION /
 * SERVICE_TERMS_VERSION and set PRIVACY_NOTICE_STATUS to 'vigente' in
 * src/lib/consent/privacyNotice.js.
 *
 * Commercial numbers (trial length, plans) are read from licenseModel.js rather
 * than retyped, because the audit found the published terms contradicting the
 * app (acaciaco-site terminos.html said the 30-day trial was StockFlow/FlowFin
 * only while the app seeds one for every new school).
 */
import {
  PRIVACY_NOTICE_VERSION,
  PRIVACY_NOTICE_STATUS,
  PRIVACY_NOTICE_PATH,
  SERVICE_TERMS_VERSION,
  SERVICE_TERMS_PATH,
} from '../consent/privacyNotice.js';
import { TRIAL_DURATION_DAYS, PLAN_TIERS, PLAN_CATALOG } from '../license/licenseModel.js';

export const ACACIA_LEGAL_NAME = 'ACACIA Consultoría en Informática y Cómputo';
export const ACACIA_CONTACT_EMAIL = 'contacto@acaciaco.com.mx';
export const ACACIA_SUPPORT_EMAIL = 'soporte@acaciaco.com.mx';
export const ARCO_EMAIL_SUBJECT = 'Derechos ARCO – LIUMA';

// Days after an unpaid renewal date, per Mission Control's liuma lifecycle
// config (acacia-mission-control/api/_lib/licenseControl.js → liuma.lifecycle).
// Mission Control runs the lifecycle, not LIUMA (standard, module 1), so these
// are quoted here, not enforced here. If MC changes them, change them here.
export const LIFECYCLE_GRACE_DAYS = {
  toReadOnly: 8,
  toSuspended: 15,
  toDeletionEligible: 45,
};

// Third parties that process personal data on ACACIA's behalf (remisiones).
// Named individually because a school's compliance review asks exactly this.
export const DATA_PROCESSORS = [
  {
    name: 'Base44',
    role: 'Plataforma en la nube donde se ejecuta LIUMA y se almacena su base de datos y archivos.',
    location: 'Estados Unidos',
  },
  {
    name: 'Resend',
    role: 'Envío de correos electrónicos (avisos, notificaciones de ausencia y bitácora, confirmaciones y soporte).',
    location: 'Estados Unidos',
  },
  {
    name: 'Anthropic',
    role: 'Modelo de inteligencia artificial que usa el asistente Lumi y la redacción asistida de bitácoras y solicitudes de soporte. Recibe sólo el texto necesario para responder la solicitud en curso.',
    location: 'Estados Unidos',
  },
  {
    name: 'Mercado Pago',
    role: 'Cobro de la licencia de la escuela. No recibe datos de alumnos ni de familias.',
    location: 'México',
  },
];

const draft = PRIVACY_NOTICE_STATUS !== 'vigente';

export const PRIVACY_NOTICE = {
  id: 'privacy',
  path: PRIVACY_NOTICE_PATH,
  title: 'Aviso de Privacidad de LIUMA',
  version: PRIVACY_NOTICE_VERSION,
  isDraft: draft,
  // Aviso simplificado — lo primero que se lee.
  summary: [
    'La escuela en la que te registras es la responsable de tus datos y de los de tus hijos. ACACIA opera LIUMA por encargo de la escuela y sólo trata los datos para prestarle el servicio.',
    'Tratamos datos de identificación y contacto de familias y personal, y datos de alumnos menores de edad, incluidos datos sensibles de salud (tipo de sangre, alergias, notas médicas) y la bitácora diaria.',
    'Los datos sensibles de los menores sólo se tratan con el consentimiento expreso de su madre, padre o tutor, y sólo para su cuidado y la operación escolar.',
    'No vendemos ni usamos los datos para publicidad. Los proveedores que nos ayudan a operar (Base44, Resend, Anthropic) están en Estados Unidos y sólo pueden usarlos para prestarnos su servicio.',
    'Puedes ejercer tus derechos de Acceso, Rectificación, Cancelación y Oposición (ARCO) ante tu escuela o escribiendo a ' + ACACIA_CONTACT_EMAIL + '.',
  ],
  sections: [
    {
      id: 'responsable',
      heading: '1. Quién es responsable de tus datos',
      paragraphs: [
        'La escuela, guardería o colegio que usa LIUMA (en adelante, "la escuela") es la responsable del tratamiento de los datos personales de su comunidad escolar: alumnos, madres, padres o tutores, y personal. El nombre y domicilio de la escuela son los que la propia escuela te comunica y los que aparecen en la app al registrarte.',
        ACACIA_LEGAL_NAME + ' ("ACACIA"), con domicilio en Aguascalientes, Aguascalientes, México, y correo ' + ACACIA_CONTACT_EMAIL + ', desarrolla y opera LIUMA y actúa como encargado: trata los datos únicamente por cuenta de la escuela, conforme a sus instrucciones y para prestarle el servicio. ACACIA es responsable, por separado, de los datos de contacto y facturación de la escuela como cliente.',
      ],
    },
    {
      id: 'datos',
      heading: '2. Qué datos tratamos',
      items: [
        'Madres, padres y tutores: nombre, correo electrónico, teléfono, domicilio, ocupación y lugar y teléfono de trabajo (si los proporcionas), parentesco con el alumno.',
        'Alumnos (menores de edad): nombre, fecha de nacimiento, fotografía (opcional), salón, asistencia, tareas, bitácora diaria (ánimo, alimentación, sueño, baño, aprendizaje, conducta, incidencias), cargos y pagos escolares, pedidos de uniforme (tallas y medidas), solicitudes de ausencia y su motivo.',
        'Datos sensibles de los alumnos: tipo de sangre, alergias y notas médicas. También puede revelar información de salud el motivo de una ausencia o una incidencia registrada en la bitácora.',
        'Contactos de emergencia y personas autorizadas para recoger al alumno: nombre, parentesco, teléfono y notas. Si registras a otra persona, te corresponde informarle que lo haces.',
        'Personal de la escuela (dirección y maestros): nombre, correo electrónico, teléfono, rol y salones asignados.',
        'Datos técnicos: sesiones activas (tipo de navegador y sistema operativo), registro de auditoría de acciones sensibles y, cuando abres un ticket de soporte, un diagnóstico de la pantalla y la versión de la app. No registramos el contenido de las páginas que visitas.',
      ],
    },
    {
      id: 'finalidades',
      heading: '3. Para qué los usamos',
      paragraphs: ['Finalidades necesarias para el servicio (no puedes oponerte a ellas sin dejar de usar LIUMA):'],
      items: [
        'Operar la comunicación entre la escuela y las familias: avisos, calendario, eventos, tareas y bitácora diaria.',
        'Registrar y consultar la asistencia y gestionar las solicitudes de ausencia.',
        'Cuidar al alumno: que el personal autorizado conozca sus alergias, tipo de sangre, notas médicas y contactos de emergencia, y pueda enviar alertas de emergencia.',
        'Llevar el control de cargos, pagos, descuentos y pedidos de uniformes de la escuela.',
        'Dar acceso a cada persona según su rol (dirección, maestro, familia) y mantener la seguridad, la auditoría y el soporte técnico de la plataforma.',
      ],
      closing: 'Finalidades secundarias: ninguna. LIUMA no usa los datos para publicidad, perfiles comerciales ni para entrenar modelos de inteligencia artificial, y no los vende ni los renta.',
    },
    {
      id: 'sensibles',
      heading: '4. Datos sensibles y de menores de edad',
      paragraphs: [
        'Los datos de salud de los alumnos son datos personales sensibles. Sólo se tratan con el consentimiento expreso de la madre, padre o tutor que ejerce la patria potestad, que se otorga en LIUMA marcando la casilla de consentimiento expreso al registrarse. La app guarda la fecha y la versión de este aviso que aceptaste.',
        'Dentro de la escuela sólo los ven quienes los necesitan para cuidar al alumno: la dirección y los maestros de su salón. Las familias sólo ven la información de sus propios hijos, y ninguna escuela ve datos de otra.',
        'El personal de la escuela, al registrarse, se compromete a tratar estos datos sólo para el cuidado del alumno y la operación escolar.',
      ],
    },
    {
      id: 'ia',
      heading: '5. Asistente de inteligencia artificial (Lumi)',
      paragraphs: [
        'LIUMA incluye un asistente, Lumi, y funciones de redacción asistida. Cuando los usas, el texto de tu solicitud y la información de la escuela necesaria para responderla se envían al proveedor del modelo (Anthropic) para generar la respuesta. ACACIA no autoriza al proveedor a usar esa información para fines propios ni para entrenar sus modelos.',
        'Lumi no da consejo médico, de alergias ni de nutrición. Sus respuestas son de apoyo y la información oficial es la que publica la escuela.',
      ],
    },
    {
      id: 'remisiones',
      heading: '6. Con quién se comparten',
      paragraphs: [
        'Para operar LIUMA, ACACIA se apoya en los siguientes proveedores, que tratan los datos sólo por cuenta de ACACIA y de la escuela, bajo obligaciones de confidencialidad y seguridad (remisiones, que no requieren tu consentimiento):',
      ],
      processors: true,
      closing: 'Fuera de estos casos, los datos sólo se transfieren a terceros cuando lo exige una autoridad competente conforme a la ley.',
    },
    {
      id: 'conservacion',
      heading: '7. Cuánto tiempo los conservamos',
      items: [
        'Mientras la escuela tenga una cuenta de LIUMA, los datos se conservan para prestar el servicio. La escuela puede corregir o eliminar registros en cualquier momento.',
        'Cuando la escuela deja de usar LIUMA, puede descargar todos sus datos. Después de ' + LIFECYCLE_GRACE_DAYS.toDeletionEligible + ' días sin licencia vigente, o antes si la escuela lo solicita, los datos se eliminan de la base de datos activa; las copias de respaldo se sobrescriben en su ciclo normal.',
        'Los registros que la ley obliga a conservar (por ejemplo, la facturación de la licencia de la escuela) y la constancia de consentimiento se guardan sólo por el plazo legal aplicable.',
      ],
    },
    {
      id: 'arco',
      heading: '8. Tus derechos ARCO y cómo revocar tu consentimiento',
      paragraphs: [
        'Puedes Acceder a tus datos y a los de tus hijos, Rectificarlos, Cancelarlos u Oponerte a su tratamiento, así como revocar tu consentimiento o limitar su uso.',
        'Como la escuela es la responsable, dirige tu solicitud a la dirección de tu escuela. También puedes enviarla a ' + ACACIA_CONTACT_EMAIL + ' con el asunto "' + ARCO_EMAIL_SUBJECT + '": ACACIA la hará llegar a tu escuela y la apoyará para atenderla.',
        'Incluye tu nombre, el de tu escuela, el derecho que quieres ejercer, los datos a los que se refiere y un medio para responderte. Si la solicitud es sobre un menor, acredita que eres su madre, padre o tutor. Recibirás respuesta en un máximo de 20 días hábiles.',
        'Revocar el consentimiento sobre los datos sensibles de tu hijo puede impedir que la escuela siga ofreciéndote el servicio por LIUMA.',
      ],
    },
    {
      id: 'seguridad',
      heading: '9. Seguridad',
      paragraphs: [
        'Cada escuela sólo ve sus propios datos y cada persona sólo lo que su rol permite; las acciones sensibles quedan registradas en una bitácora de auditoría. La información viaja cifrada y se aloja en la infraestructura de Base44.',
      ],
    },
    {
      id: 'cookies',
      heading: '10. Almacenamiento en tu navegador',
      paragraphs: [
        'LIUMA guarda en tu navegador sólo lo necesario para funcionar: tu sesión, tu preferencia de tema (claro, oscuro o del sistema) y la última cuenta con la que entraste. No usa cookies de publicidad ni de rastreo de terceros.',
      ],
    },
    {
      id: 'cambios',
      heading: '11. Cambios a este aviso',
      paragraphs: [
        'Cualquier cambio se publicará en esta misma página con una nueva versión. Si el cambio afecta los datos sensibles o las finalidades, se te pedirá aceptar la nueva versión.',
        'Si consideras que tus derechos no fueron atendidos, puedes acudir ante la autoridad de protección de datos personales competente.',
      ],
    },
  ],
  reviewNotes: [
    'Figura del responsable: este texto hace a la escuela responsable y a ACACIA encargado. Confirmar si la escuela debe emitir su propio aviso (y LIUMA mostrar el suyo) o si basta este modelo; en ese caso, el nombre y domicilio de cada escuela deberían insertarse en la página.',
    'Consentimiento expreso para datos sensibles de menores: hoy es una casilla electrónica con versión y fecha registradas. Confirmar si cumple el requisito de consentimiento expreso (y, en su caso, por escrito o firma electrónica) de la ley vigente.',
    'Autoridad: la ley de datos personales de 2025 cambió la autoridad garante. Confirmar la denominación correcta y si hay que citarla expresamente.',
    'Remisiones internacionales: Base44, Resend y Anthropic operan en EE. UU. Confirmar si basta con informarlas o si hacen falta cláusulas contractuales específicas con cada proveedor, y que el proveedor del modelo de IA sea efectivamente Anthropic en la configuración de Base44 y que la cadena contractual (Base44 → proveedor del modelo) prohíba el entrenamiento con estos datos, como promete la sección 5.',
    'Plazos de conservación: los ' + LIFECYCLE_GRACE_DAYS.toDeletionEligible + ' días vienen de la configuración del ciclo de licencias de Mission Control y son una propuesta; fijar el plazo real y el de respaldos.',
    'Falta un contrato de encargo (DPA) firmado entre cada escuela y ACACIA. Los términos del servicio incluyen sus cláusulas mínimas como borrador.',
  ],
};

function trialParagraph() {
  return 'Toda escuela nueva empieza con una prueba gratuita de ' + TRIAL_DURATION_DAYS + ' días naturales, con todas las funciones y sin tarjeta. La prueba no se renueva sola.';
}

function planItems() {
  return PLAN_TIERS.map((tier) => {
    const plan = PLAN_CATALOG[tier];
    const limit = plan.studentLimit == null ? 'alumnos ilimitados' : 'hasta ' + plan.studentLimit + ' alumnos';
    return plan.label + ': ' + plan.price + ', ' + limit + '.';
  });
}

export const SERVICE_TERMS = {
  id: 'terms',
  path: SERVICE_TERMS_PATH,
  title: 'Términos del servicio de LIUMA',
  version: SERVICE_TERMS_VERSION,
  isDraft: draft,
  summary: [
    'La prueba gratuita dura ' + TRIAL_DURATION_DAYS + ' días y no pide tarjeta.',
    'Si la licencia no está pagada, la escuela pasa a modo de solo lectura: se puede consultar y descargar todo, pero no registrar nada nuevo hasta pagar. No se borra nada por vencer la prueba.',
    'El pago es mensual por Mercado Pago; LIUMA avisa antes del vencimiento y muestra cómo pagar.',
    'Los datos son de la escuela: puede descargarlos cuando quiera y pedir su eliminación.',
  ],
  sections: [
    {
      id: 'servicio',
      heading: '1. El servicio',
      paragraphs: [
        'LIUMA es una plataforma de gestión y comunicación escolar operada por ' + ACACIA_LEGAL_NAME + ' ("ACACIA"). La escuela contrata una licencia para su comunidad: dirección, maestros y familias. Estos términos aplican junto con los términos generales de ACACIA publicados en acaciaco.com.mx; si algo difiere, para LIUMA prevalece lo que dice aquí.',
      ],
    },
    {
      id: 'prueba',
      heading: '2. Prueba gratuita',
      paragraphs: [
        trialParagraph(),
        'Durante la prueba la app muestra cuántos días quedan. Al terminar sin pago, la escuela pasa a modo de solo lectura (sección 4).',
      ],
    },
    {
      id: 'planes',
      heading: '3. Planes y pagos',
      paragraphs: ['Planes vigentes (precios mensuales en pesos mexicanos):'],
      items: planItems(),
      closing: 'El cobro se hace por Mercado Pago; ACACIA no almacena datos de tarjetas. Las renovaciones automáticas se cobran el día 1 de cada mes. Puede aplicar una cuota de activación única, que se informa antes de contratar. LIUMA avisa en la app antes de que venza la licencia, con el enlace para pagar.',
    },
    {
      id: 'vencimiento',
      heading: '4. Si la licencia no está pagada',
      items: [
        'Al terminar la prueba sin pago, o si no existe una licencia activa, la escuela entra en modo de solo lectura: todos pueden ver y descargar la información, pero no se pueden crear ni modificar registros.',
        'Si una renovación no se paga, hay ' + LIFECYCLE_GRACE_DAYS.toReadOnly + ' días de gracia con acceso completo; después, solo lectura; a los ' + LIFECYCLE_GRACE_DAYS.toSuspended + ' días el acceso se suspende.',
        'Al pagar, el acceso completo se restablece sin perder información.',
        'A los ' + LIFECYCLE_GRACE_DAYS.toDeletionEligible + ' días sin pago los datos pueden eliminarse, siempre con aviso previo a la dirección de la escuela.',
      ],
    },
    {
      id: 'cancelacion',
      heading: '5. Cancelación y tus datos',
      paragraphs: [
        'La escuela puede cancelar cuando quiera escribiendo a ' + ACACIA_CONTACT_EMAIL + '. La cancelación aplica al terminar el periodo pagado; no hay reembolsos por periodos ya cobrados salvo error imputable a ACACIA.',
        'La escuela puede descargar todos sus datos en cualquier momento desde Permisos y roles → Descargar mis datos, y solicitar la eliminación de la escuela desde la misma pantalla.',
      ],
    },
    {
      id: 'uso',
      heading: '6. Uso aceptable',
      items: [
        'Cada persona usa su propia cuenta y es responsable de su contraseña.',
        'La escuela decide quién entra y con qué rol, y aprueba las cuentas de maestros y familias.',
        'La escuela es responsable de que la información que registra sea correcta y de contar con el consentimiento de las familias (ver el Aviso de Privacidad).',
        'No está permitido usar LIUMA para fines distintos de la operación escolar ni intentar acceder a información de otra escuela o de otras familias.',
      ],
    },
    {
      id: 'encargo',
      heading: '7. Tratamiento de datos por cuenta de la escuela (encargo)',
      paragraphs: ['Respecto de los datos de su comunidad escolar, la escuela es responsable y ACACIA encargado. ACACIA se obliga a:'],
      items: [
        'Tratar los datos sólo para prestar LIUMA y conforme a las instrucciones de la escuela.',
        'No usarlos para fines propios, no venderlos y no transferirlos salvo a los proveedores listados en el Aviso de Privacidad o por mandato de autoridad.',
        'Mantener medidas de seguridad y confidencialidad, y exigirlas a sus proveedores.',
        'Avisar a la escuela sin demora de cualquier vulneración de seguridad que afecte sus datos.',
        'Apoyar a la escuela para atender las solicitudes ARCO.',
        'Al terminar el servicio, entregar los datos a la escuela y después suprimirlos, salvo lo que la ley obligue a conservar.',
      ],
    },
    {
      id: 'responsabilidad',
      heading: '8. Disponibilidad y responsabilidad',
      paragraphs: [
        'ACACIA procura que LIUMA esté disponible y funcione correctamente, pero no se hace responsable de interrupciones causadas por terceros (proveedores de nube, correo o pagos) ni de daños derivados de un uso indebido. LIUMA no sustituye los protocolos de emergencia ni la atención médica de la escuela.',
      ],
    },
    {
      id: 'jurisdiccion',
      heading: '9. Cambios y jurisdicción',
      paragraphs: [
        'ACACIA puede actualizar estos términos; los cambios se publican en esta página con una nueva versión y se avisa a la dirección de la escuela. Cualquier controversia se resolverá conforme a las leyes mexicanas, ante los tribunales de Aguascalientes, Aguascalientes.',
        'Dudas: ' + ACACIA_CONTACT_EMAIL + ' · Soporte: ' + ACACIA_SUPPORT_EMAIL + '.',
      ],
    },
  ],
  reviewNotes: [
    'Los términos generales de acaciaco.com.mx (terminos.html, sección 2) todavía dicen que la prueba de 30 días es sólo para StockFlow y FlowFin. Hay que alinearlos con este texto.',
    'Solo lectura por falta de pago: el dueño decidió que una licencia vencida o inexistente deja la escuela en solo lectura. Confirmar que ese efecto y los plazos de gracia (' + LIFECYCLE_GRACE_DAYS.toReadOnly + ' / ' + LIFECYCLE_GRACE_DAYS.toSuspended + ' / ' + LIFECYCLE_GRACE_DAYS.toDeletionEligible + ' días, tomados de Mission Control) son los que se quieren comprometer por escrito.',
    'Cuota de activación: el catálogo interno la tiene; decidir si se publica el monto aquí.',
    'La sección 7 son las cláusulas mínimas de un contrato de encargo; conviene un contrato de encargo firmado por escuela.',
    'Aceptación: hoy el onboarding sólo pide aceptar el Aviso de Privacidad. Definir si la dirección que crea la escuela debe aceptar también estos términos, y cómo se registra.',
  ],
};

export const LEGAL_DOCUMENTS = [PRIVACY_NOTICE, SERVICE_TERMS];

/** The processors that the notice must name (used by the page and the tests). */
export function processorNames() {
  return DATA_PROCESSORS.map((p) => p.name);
}
