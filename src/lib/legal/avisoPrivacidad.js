// ─────────────────────────────────────────────────────────────────────────────
// BORRADOR PENDIENTE DE REVISIÓN LEGAL — NO ES TEXTO DEFINITIVO.
//
// Redactado por Claude el 2026-09-29 por decisión del dueño, a partir de la
// LFPDPPP (incluida la ley publicada en el DOF el 20-03-2025, que sustituyó a
// la de 2010 y pasó las funciones del INAI a la Secretaría Anticorrupción y
// Buen Gobierno). Un abogado tiene que revisarlo antes de quitar la marca de
// borrador. En especial:
//   - [RAZÓN SOCIAL] y [DOMICILIO] de ACACIA son marcadores, no datos;
//   - el plazo de conservación tras la baja (90 días) es una propuesta;
//   - la base de las remisiones internacionales (Base44, Resend, Anthropic,
//     alojados fuera de México) y la autoridad garante vigente;
//   - si la escuela necesita su propio aviso además de éste.
//
// La página que lo muestra (src/components/legal/LegalDocumentPage.jsx) pone
// un aviso de BORRADOR arriba mientras PRIVACY_NOTICE_IS_DRAFT sea true.
// Si cambias el texto, sube PRIVACY_NOTICE_VERSION en
// src/lib/consent/privacyNotice.js (y su copia en provisionOnboardingProfile).
// ─────────────────────────────────────────────────────────────────────────────

export const AVISO_PRIVACIDAD = {
  title: 'Aviso de Privacidad Integral de LIUMA',
  intro: [
    'LIUMA es una plataforma de gestión y comunicación escolar. Este aviso explica qué datos personales se tratan en LIUMA, para qué, con quién se comparten y cómo puedes ejercer tus derechos, conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP).',
  ],
  sections: [
    {
      title: '1. Quién es responsable de tus datos',
      paragraphs: [
        'La escuela que contrata LIUMA es la RESPONSABLE del tratamiento de los datos de sus alumnos, de sus madres, padres o tutores y de su personal: ella decide qué datos se registran y para qué.',
        'ACACIA ([RAZÓN SOCIAL], con domicilio en [DOMICILIO]), que desarrolla y opera LIUMA, actúa como ENCARGADA: trata esos datos únicamente por cuenta de la escuela y para prestarle el servicio, sin usarlos para fines propios.',
        'Respecto de los datos de contacto y facturación de quien contrata la licencia para la escuela, ACACIA actúa como responsable.',
      ],
    },
    {
      title: '2. Qué datos se tratan',
      bullets: [
        'De madres, padres, tutores y personal: nombre, correo electrónico, teléfono, rol en la escuela y los mensajes o avisos que envían o reciben.',
        'De alumnos (menores de edad): nombre, fecha de nacimiento, grupo, fotografía cuando la escuela la registra, asistencia, tareas, bitácora de desarrollo y conducta, cargos y pagos escolares, y contactos de emergencia.',
        'Datos personales SENSIBLES de alumnos: tipo de sangre, alergias, condiciones y notas médicas.',
        'Datos técnicos: registros de acceso, fecha y hora, dispositivo y navegador, necesarios para la seguridad de la cuenta.',
      ],
    },
    {
      title: '3. Datos sensibles y datos de menores',
      paragraphs: [
        'Los datos de salud de los alumnos son datos sensibles. Se tratan sólo con el consentimiento EXPRESO de su madre, padre o tutor, y sólo para su cuidado dentro de la escuela (por ejemplo, saber a qué es alérgico un alumno o a quién llamar en una emergencia).',
        'LIUMA registra cada consentimiento con la fecha, la versión de este aviso que se aceptó y la cuenta que lo otorgó, para que la escuela pueda acreditarlo.',
        'El personal de la escuela que usa LIUMA se compromete a tratar esos datos únicamente para las finalidades de este aviso.',
      ],
    },
    {
      title: '4. Para qué se usan tus datos',
      paragraphs: ['Finalidades necesarias para el servicio:'],
      bullets: [
        'Comunicación entre la escuela y las familias: avisos, eventos, bitácora, tareas y ausencias.',
        'Registro de asistencia y seguimiento académico y de desarrollo del alumno.',
        'Atención de emergencias y cuidado de la salud del alumno en la escuela.',
        'Cobranza escolar: cargos, descuentos y pagos entre la familia y la escuela.',
        'Operación de la cuenta: acceso, seguridad, soporte técnico y respaldo.',
        'Funciones de asistencia con inteligencia artificial (por ejemplo, redactar una bitácora o clasificar un ticket de soporte), cuando el personal decide usarlas.',
      ],
      after: [
        'LIUMA no usa tus datos para publicidad, no los vende y no los usa para finalidades secundarias.',
      ],
    },
    {
      title: '5. Con quién se comparten',
      paragraphs: [
        'Para prestar el servicio, ACACIA se apoya en proveedores que tratan los datos por su cuenta, bajo sus instrucciones (remisiones). Algunos alojan la información fuera de México:',
      ],
      bullets: [
        'Base44 — infraestructura, base de datos y alojamiento de la aplicación.',
        'Resend — envío de correos electrónicos (avisos, notificaciones y confirmaciones).',
        'Anthropic — procesamiento de lenguaje para las funciones de asistencia con inteligencia artificial; sólo recibe el texto que se le envía en cada solicitud.',
        'Mercado Pago — cobro de la licencia de la escuela; sólo recibe datos de facturación de la escuela, no de alumnos.',
      ],
      after: [
        'Fuera de estos casos, tus datos sólo se comunican a terceros cuando lo exija una ley o una autoridad competente.',
      ],
    },
    {
      title: '6. Cuánto tiempo se conservan',
      paragraphs: [
        'Mientras la escuela mantenga su cuenta en LIUMA. Al terminar, la escuela puede exportar su información; después, los datos se eliminan o bloquean en un plazo de 90 días, salvo los que deban conservarse por una obligación legal (por ejemplo, fiscal).',
      ],
    },
    {
      title: '7. Tus derechos ARCO y la revocación del consentimiento',
      paragraphs: [
        'Puedes Acceder a tus datos, Rectificarlos, Cancelarlos u Oponerte a su tratamiento (derechos ARCO), así como revocar tu consentimiento o limitar el uso de tus datos.',
        'Como la escuela es la responsable, dirige tu solicitud a la escuela. ACACIA la apoya para responder, y también puedes escribir a soporte@acaciaco.com.mx: la haremos llegar a tu escuela.',
        'Tu solicitud debe incluir tu nombre, un medio para responderte, un documento que acredite tu identidad (o la representación del menor) y la descripción clara de lo que pides. Recibirás respuesta en un plazo máximo de 20 días hábiles.',
        'Revocar el consentimiento sobre datos necesarios para el servicio puede impedir que la escuela siga usando LIUMA contigo.',
      ],
    },
    {
      title: '8. Almacenamiento local y cookies',
      paragraphs: [
        'LIUMA guarda en tu navegador sólo lo necesario para funcionar: tu sesión y preferencias como el tema claro u oscuro. No usa cookies de publicidad ni de rastreo de terceros.',
      ],
    },
    {
      title: '9. Cambios a este aviso',
      paragraphs: [
        'Cualquier cambio se publicará en esta misma página con una nueva versión. Si cambian las finalidades o los datos sensibles que se tratan, se te pedirá aceptar de nuevo.',
      ],
    },
    {
      title: '10. Autoridad',
      paragraphs: [
        'Si consideras que tu derecho a la protección de datos personales fue vulnerado, puedes acudir ante la autoridad garante competente en materia de protección de datos personales.',
      ],
    },
  ],
};
