// What Base44's own auth e-mails look like, so the Spanish login screen can
// tell people what to look for in their inbox.
//
// The verification-code and password-reset e-mails are sent by the Base44
// platform, not by LIUMA, and they are in ENGLISH. Nothing in this repo renders
// them, and nothing configurable changes them (checked 2026-10-01 against the
// Base44 platform API: `PUT /api/apps/{app_id}` takes no language, there is no
// e-mail-template endpoint, and the SDK's register / resendOtp /
// resetPasswordRequest take no locale). LIUMA's own notification e-mails are a
// different thing — those live in base44/functions/sendNotificationEmail and
// notifyParents and are already Spanish.
//
// So the least-bad fix on our side is to say it up front, in Spanish, on the
// screen the person is looking at when the e-mail is sent: which subject to
// search for, what to press, and how long it lasts. A parent who gets "Verify
// your email for LIUMA" without warning reads it as spam or as someone else's
// mail; one who was told to expect it just copies the code.
//
// Every value here was read off real e-mails on 2026-09-29/30 (Gmail threads
// 1a0ef418ddcfb86f — verify, 1a0f3e98a187c34c — reset), not guessed. If Base44
// ever changes the wording, update it here; the subjects embed the app's
// name in Base44 ("LIUMA"), so renaming the app there changes them too.
//
// The sender address (today no-reply@base44-apps.com) is deliberately NOT
// quoted: turning on a custom e-mail domain would change it overnight and the
// copy would send people searching for the wrong thing. The subject survives
// that change.

export const PLATFORM_EMAILS = Object.freeze({
  verify: Object.freeze({
    subject: 'Verify your email for LIUMA',
    codeDigits: 6,
    expiresIn: '10 minutos',
  }),
  reset: Object.freeze({
    subject: 'Reset your password for LIUMA',
    button: 'Reset password',
    expiresIn: '1 hora',
  }),
});

// Shown under the code field while the person waits for the verification code.
export function verifyEmailHint() {
  const { subject, codeDigits, expiresIn } = PLATFORM_EMAILS.verify;
  return `El correo llega en inglés, con el asunto «${subject}». `
    + `Copia el código de ${codeDigits} dígitos; vence en ${expiresIn}. `
    + 'Si no lo ves, revisa spam o pide otro código.';
}

// Shown after a password-reset request. Same no-enumeration wording as before
// ("si hay una cuenta…"): it must read identically whether or not the e-mail
// exists.
export function resetRequestedNotice(email) {
  const { subject, button, expiresIn } = PLATFORM_EMAILS.reset;
  return `Si hay una cuenta con ${email}, te llegará un correo en inglés con el asunto «${subject}». `
    + `Toca «${button}» antes de que pase ${expiresIn}; se abre una página en inglés donde eliges tu contraseña nueva. `
    + 'Revisa también tu carpeta de spam.';
}
