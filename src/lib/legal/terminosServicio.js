// ─────────────────────────────────────────────────────────────────────────────
// BORRADOR PENDIENTE DE REVISIÓN LEGAL — NO ES TEXTO DEFINITIVO.
//
// Términos del servicio y del periodo de prueba de LIUMA, redactados por
// Claude el 2026-09-29 por decisión del dueño. Un abogado tiene que revisarlos
// antes de quitar la marca de borrador. Pendientes marcados entre corchetes:
// razón social, si los precios incluyen IVA, límite de responsabilidad y
// jurisdicción.
//
// Los precios y la duración de la prueba se leen de licenseModel.js, así que
// no pueden decir algo distinto de lo que la app cobra. Los días de gracia
// (8 → solo lectura, 15 → suspensión) son los de Mission Control
// (acacia-mission-control api/_lib/licenseControl.js, entrada `liuma`).
// Si cambias el texto, sube TERMS_VERSION en src/lib/consent/privacyNotice.js.
// ─────────────────────────────────────────────────────────────────────────────

import { ACTIVATION_FEE, PLAN_CATALOG, PLAN_TIERS, TRIAL_DURATION_DAYS } from '../license/licenseModel.js';

export const GRACE_DAYS_TO_READ_ONLY = 8;
export const GRACE_DAYS_TO_SUSPENDED = 15;

export const TERMINOS_SERVICIO = {
  title: 'Términos del servicio y del periodo de prueba de LIUMA',
  intro: [
    'Estos términos regulan el uso de LIUMA entre ACACIA ([RAZÓN SOCIAL]) y la escuela que la contrata, así como el uso que hacen de ella el personal y las familias de esa escuela.',
  ],
  sections: [
    {
      title: '1. El servicio',
      paragraphs: [
        'LIUMA es una plataforma en línea de gestión y comunicación escolar: avisos, asistencia, tareas, bitácora, eventos, cobranza escolar, documentos y soporte. Se ofrece como servicio de suscripción; la escuela no adquiere el software.',
      ],
    },
    {
      title: '2. Periodo de prueba',
      bullets: [
        `La escuela que se registra obtiene ${TRIAL_DURATION_DAYS} días naturales de prueba gratuita, contados desde su registro, con acceso a todas las funciones.`,
        'No se pide tarjeta ni forma de pago para empezar la prueba.',
        'Al terminar la prueba sin una licencia pagada, la escuela pasa a MODO SOLO LECTURA: toda su información sigue disponible para consultarse y exportarse, pero no se pueden hacer cambios hasta que se pague la licencia. No se borra nada por terminar la prueba.',
        'LIUMA avisa en la aplicación desde 7 días antes de que termine la prueba.',
      ],
    },
    {
      title: '3. Planes, precios y pago',
      bullets: [
        ...PLAN_TIERS.map((tier) => `${PLAN_CATALOG[tier].label}: ${PLAN_CATALOG[tier].price}. ${PLAN_CATALOG[tier].desc}.`),
        `Activación inicial, cuando aplica: ${ACTIVATION_FEE.label}, pago único.`,
        'Precios en pesos mexicanos [confirmar si incluyen IVA].',
        'El cobro se realiza a través de Mercado Pago. Las renovaciones automáticas se cobran el día 1 de cada mes; un pago manual se confirma por ACACIA al recibirlo.',
      ],
    },
    {
      title: '4. Vencimiento, solo lectura y suspensión',
      bullets: [
        'LIUMA avisa en la aplicación desde 7 días antes de que venza la licencia.',
        `Si la licencia vence sin pago, la escuela conserva el acceso completo durante ${GRACE_DAYS_TO_READ_ONLY} días; después pasa a modo solo lectura.`,
        `A los ${GRACE_DAYS_TO_SUSPENDED} días de vencida sin pago, la cuenta puede suspenderse.`,
        'Al registrarse el pago, el acceso completo se restablece; la información no se pierde por un atraso.',
      ],
    },
    {
      title: '5. Responsabilidades de la escuela',
      bullets: [
        'Obtener de madres, padres o tutores el consentimiento para tratar los datos de los alumnos, incluido el consentimiento expreso para sus datos sensibles de salud, conforme al Aviso de Privacidad.',
        'Registrar información veraz y mantener actualizados los accesos de su personal: dar de baja a quien ya no deba entrar.',
        'Aprobar sólo a las personas que efectivamente pertenecen a la escuela cuando se unen con el código de la escuela.',
        'Resguardar las contraseñas y el código de la escuela.',
      ],
    },
    {
      title: '6. Los datos son de la escuela',
      paragraphs: [
        'La información que la escuela registra en LIUMA le pertenece. La escuela puede exportarla en cualquier momento desde la aplicación, incluso en modo solo lectura. ACACIA la trata como encargada, según el Aviso de Privacidad.',
      ],
    },
    {
      title: '7. Uso aceptable',
      bullets: [
        'No usar LIUMA para fines ajenos a la operación escolar, ni para enviar contenido ilícito, ofensivo o no solicitado.',
        'No intentar acceder a información de otra escuela ni vulnerar la seguridad de la plataforma.',
      ],
    },
    {
      title: '8. Disponibilidad y soporte',
      paragraphs: [
        'ACACIA procura que LIUMA esté disponible de forma continua y atiende soporte en soporte@acaciaco.com.mx y desde la sección de Soporte de la aplicación. Puede haber interrupciones por mantenimiento o por fallas de proveedores.',
      ],
    },
    {
      title: '9. Baja',
      paragraphs: [
        'La escuela puede dejar de usar LIUMA en cualquier momento; antes puede exportar su información. La eliminación de la escuela se solicita a ACACIA desde la aplicación y se atiende conforme al Aviso de Privacidad.',
      ],
    },
    {
      title: '10. Responsabilidad',
      paragraphs: [
        '[PENDIENTE DE REVISIÓN LEGAL: límite de responsabilidad de ACACIA frente a la escuela.]',
      ],
    },
    {
      title: '11. Cambios y ley aplicable',
      paragraphs: [
        'Cualquier cambio a estos términos se publicará en esta página con una nueva versión. Estos términos se rigen por las leyes de México [confirmar jurisdicción].',
      ],
    },
  ],
};
