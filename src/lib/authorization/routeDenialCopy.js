// Wording for RouteAccessDenied, picked by the denial reason. Pure so the
// "never show an internal code to a user" rule is testable.

const COPY = {
  missing_user_profile: {
    title: 'Tu cuenta aún no está en una escuela',
    body: 'Vuelve al inicio para crear tu escuela o unirte a una con el código que te dio la dirección.',
  },
  inactive_pending: {
    title: 'Tu cuenta está pendiente de aprobación',
    body: 'Podrás entrar a esta sección en cuanto la dirección de tu escuela apruebe tu cuenta.',
  },
  inactive_suspended: {
    title: 'Tu cuenta está suspendida',
    body: 'Habla con la dirección de tu escuela si crees que es un error.',
  },
  default: {
    title: 'Esta sección no es para tu tipo de cuenta',
    body: 'Usa el menú para ir a las secciones de tu cuenta. Si necesitas entrar aquí, pídelo a la dirección de tu escuela.',
  },
};

export function routeDenialCopy({ reasonCode, profileStatus } = {}) {
  if (reasonCode === 'missing_user_profile') return COPY.missing_user_profile;
  if (reasonCode === 'inactive_profile') {
    return profileStatus === 'SUSPENDED' ? COPY.inactive_suspended : COPY.inactive_pending;
  }
  return COPY.default;
}
