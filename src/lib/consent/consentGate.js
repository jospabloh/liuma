/**
 * What the consent gate (src/components/consent/ConsentGate.jsx) shows.
 * Pure, so tests/unit/consent-gate.test.js runs every case.
 *
 *   'pass'          → the app, as usual
 *   'loading'       → a spinner (never the app: no flash of a screen the
 *                     person may not have consented to)
 *   'consent'       → the blocking consent screen
 *   'deletion_page' → "Eliminar mi cuenta y mis datos", reached by "No acepto"
 *   'status_error'  → could not ask the server; retry or sign out
 *   'deleted'       → this account was deleted (User marked, not yet removed)
 *
 * Fails CLOSED once a profile exists without the current stamp: until the
 * server says otherwise, the person sees the consent screen or a retry, never
 * the app. Fails OPEN only where there is nothing to protect yet: no profile
 * (onboarding records its own consent) or a profile read that failed (every
 * screen then shows its own load error, and the server refuses data anyway).
 */
import { profileConsentIsCurrent } from './privacyNotice.js';
import { ACCOUNT_DELETION_PATH, accountDeletedAt } from '../account/accountDeletion.js';

export function decideConsentGate({
  user,
  profile,
  profileLoading = false,
  profileFailed = false,
  status = undefined,
  statusLoading = false,
  statusFailed = false,
  pathname = '/',
} = {}) {
  if (!user) return 'pass';
  if (accountDeletedAt(user)) return 'deleted';
  if (profileLoading) return 'loading';
  if (profileFailed || !profile) return 'pass';
  if (profileConsentIsCurrent(profile)) return 'pass';
  if (statusLoading) return 'loading';
  if (statusFailed) return 'status_error';
  if (status?.accountDeleted) return 'deleted';
  if (status && status.required === false) return 'pass';
  if (!status) return 'loading';
  const path = String(pathname || '').replace(/\/+$/, '') || '/';
  return path === ACCOUNT_DELETION_PATH ? 'deletion_page' : 'consent';
}
