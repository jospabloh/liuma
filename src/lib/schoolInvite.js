// The code a school shares so parents and teachers can join it, plus the
// WhatsApp message that carries it. Import-free for node --test.
//
// Today the only code onboarding accepts is the School record id (24 hex
// characters). A short human `join_code` is being added server-side
// (package P6); the admin home shows it as soon as the School record carries
// one, and falls back to the id until then — never a code onboarding would
// reject.

export function schoolInviteCode(school) {
  if (!school) return '';
  const joinCode = typeof school.join_code === 'string' ? school.join_code.trim() : '';
  return joinCode || school.id || '';
}

export function schoolInviteMessage({ schoolName, code, appUrl }) {
  const name = schoolName ? ` de ${schoolName}` : '';
  const lines = [
    `Te invitamos a unirte a LIUMA, la app${name}.`,
    '',
    `1. Entra a ${appUrl || 'LIUMA'} y crea tu cuenta.`,
    '2. Elige «Soy Padre/Madre» o «Soy Maestro/a».',
    `3. Escribe este código de escuela: ${code}`,
  ];
  return lines.join('\n');
}

export function whatsappShareUrl(message) {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
