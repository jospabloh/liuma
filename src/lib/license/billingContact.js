// Cómo paga una escuela su licencia — un solo lugar para el botón de pago.
//
// El cobro real ocurre en Mercado Pago (Stripe no se usa en el portafolio) y
// ACACIA confirma el pago en LIUMA / Mission Control. Todos los avisos de
// licencia (antes y después del vencimiento) llevan este mismo botón, para que
// "¿y ahora cómo pago?" nunca quede sin respuesta.
//
// VITE_LIUMA_PAYMENT_URL es la liga de pago de Mercado Pago (link de pago o
// suscripción). Es pública por naturaleza — se le manda a cualquier cliente —,
// así que puede ir en una variable VITE_. Mientras no esté configurada, el
// botón abre WhatsApp de ACACIA con el mensaje ya escrito: siempre hay una
// forma de pagar, aunque sea asistida.

const WHATSAPP_NUMBER = '524498958291';

function readEnvPaymentUrl() {
  try {
    const value = import.meta.env?.VITE_LIUMA_PAYMENT_URL;
    return typeof value === 'string' && /^https:\/\//.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function buildWhatsAppPaymentUrl({ schoolName } = {}) {
  const who = schoolName ? ` de ${schoolName}` : '';
  const text = `Hola, quiero pagar la licencia LIUMA${who}. ¿Me comparten la liga de Mercado Pago?`;
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

/**
 * `{ href, label, isMercadoPago }` — the pay button every license notice uses.
 * `paymentUrl` is injectable for tests; production reads VITE_LIUMA_PAYMENT_URL.
 */
export function licensePaymentAction({ schoolName, paymentUrl = readEnvPaymentUrl() } = {}) {
  if (paymentUrl) {
    return { href: paymentUrl, label: 'Pagar con Mercado Pago', isMercadoPago: true };
  }
  return { href: buildWhatsAppPaymentUrl({ schoolName }), label: 'Pagar mi licencia', isMercadoPago: false };
}
