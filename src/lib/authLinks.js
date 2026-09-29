// Reads a password-reset token from the URL the reset e-mail opened.
//
// NOT VERIFIED against a real Base44 reset e-mail: the SDK documents
// resetPassword({ resetToken }) but not the link's shape, so we accept the
// plausible parameter names. If the e-mail links to Base44's own hosted page
// instead, that page completes the reset and this simply never fires.
// App.jsx keeps the query string when it bounces an unauthenticated visitor
// from any path to /login, so the token survives that redirect.
const TOKEN_PARAMS = ['reset_token', 'resetToken', 'token'];

export function readResetToken(search = '') {
  let params;
  try { params = new URLSearchParams(search); } catch { return null; }
  for (const name of TOKEN_PARAMS) {
    const value = params.get(name);
    if (value && value.trim()) return value.trim();
  }
  return null;
}

export const MIN_PASSWORD_LENGTH = 8;
