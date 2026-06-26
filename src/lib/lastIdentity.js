// Cosmetic-only memory of the last signed-in user, used solely to render the
// "Continuar como {usuario}" welcome card when there is no active session.
//
// SECURITY: this NEVER stores the access token or anything used for
// authorization. The real session is always the Base44 token + RLS. Having a
// remembered identity does NOT mean the user is authenticated — it only lets us
// paint a friendlier button than the generic login. Cleared on logout and on
// "usar otra cuenta".
const KEY = 'acacia_last_identity_v1';

export function rememberIdentity(user) {
  if (typeof window === 'undefined' || !user) return;
  try {
    const identity = {
      name: user.full_name || user.name || null,
      email: user.email || null,
      avatar: user.avatar_url || user.picture || user.photo_url || null,
    };
    if (!identity.name && !identity.email) return;
    window.localStorage.setItem(KEY, JSON.stringify(identity));
  } catch { /* storage unavailable — non-fatal, just skip the nicety */ }
}

export function getRememberedIdentity() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const id = JSON.parse(raw);
    return id && (id.name || id.email) ? id : null;
  } catch { return null; }
}

export function clearRememberedIdentity() {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
}
