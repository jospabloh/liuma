// Texto de los avisos de licencia (LicenseNoticeBanner / ReadOnlyBanner).
// Puro y separado del componente para poder probar que cada aviso dice qué
// pasa, cuándo, y qué hacer — y que sólo quien puede pagar ve el botón.

function days(n) {
  return `${n} día${n === 1 ? '' : 's'}`;
}

/**
 * @param {ReturnType<import('./licenseModel.js').licenseNotice>} notice
 * @param {{ isAdmin: boolean }} opts
 * @returns {{ title: string, body: string, showPay: boolean } | null}
 */
export function licenseNoticeCopy(notice, { isAdmin = false } = {}) {
  if (!notice) return null;
  const askDirector = 'Pide a la dirección de tu escuela que renueve la licencia.';
  const readOnlyTail = isAdmin
    ? 'Puedes consultar y exportar toda la información, pero no hacer cambios hasta que se registre el pago.'
    : `Puedes consultar la información, pero no hacer cambios. ${askDirector}`;

  switch (notice.kind) {
    case 'trial_ending': {
      const when = notice.daysLeft <= 0 ? 'hoy' : `en ${days(notice.daysLeft)}`;
      return {
        title: `Tu periodo de prueba termina ${when}`,
        body: isAdmin
          ? 'Al terminar, la escuela pasa a modo solo lectura: nada se borra, pero no se podrán hacer cambios hasta pagar la licencia.'
          : `Al terminar, la escuela pasa a modo solo lectura. ${askDirector}`,
        showPay: isAdmin,
      };
    }
    case 'renewal_upcoming': {
      const when = notice.daysLeft <= 0 ? 'hoy' : `en ${days(notice.daysLeft)}`;
      return {
        title: `Tu licencia vence ${when}`,
        body: 'Renueva a tiempo para que tu escuela siga operando sin interrupciones.',
        showPay: isAdmin,
      };
    }
    case 'active_overdue':
      return {
        title: 'Tu licencia está vencida',
        body: 'Tienes unos días de gracia; después la escuela pasará a modo solo lectura. Si ya pagaste, ACACIA lo confirmará en breve.',
        showPay: isAdmin,
      };
    case 'read_only':
      return {
        title: notice.effective?.reason === 'trial_expired' ? 'Terminó tu periodo de prueba' : 'Modo solo lectura',
        body: readOnlyTail,
        showPay: isAdmin,
      };
    case 'suspended':
      return {
        title: 'Cuenta suspendida',
        body: readOnlyTail,
        showPay: isAdmin,
      };
    case 'missing':
      return {
        title: 'Tu escuela no tiene una licencia activa',
        body: isAdmin
          ? 'Por ahora está en modo solo lectura. Activa tu licencia para volver a hacer cambios; si crees que es un error, escríbenos.'
          : `Por ahora está en modo solo lectura. ${askDirector}`,
        showPay: isAdmin,
      };
    default:
      return null;
  }
}
