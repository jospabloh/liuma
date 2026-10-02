import { base44 } from '@/api/base44Client';
import { invokeFunction } from '@/lib/functionResponse';
import { PRIVACY_NOTICE_VERSION, SERVICE_TERMS_VERSION } from './privacyNotice';

// The client half of myConsent and deleteMyAccount (v1.9.0). Every call goes
// through invokeFunction (the one place that unwraps axios and normalizes
// errors). The two reads may be retried on Base44's rate limit; the two
// writes go out once.

export const CONSENT_STATUS_QUERY_KEY = 'consentStatus';
export const DELETION_PREVIEW_QUERY_KEY = 'accountDeletionPreview';

/** { required, hasProfile, role, noticeVersion, termsVersion, accountDeleted? } */
export function fetchConsentStatus() {
  // Its only write (repairing a missing stamp from an existing record) is
  // idempotent, so a retry is harmless.
  return invokeFunction(base44, 'myConsent', { action: 'status' }, { idempotent: true });
}

/** Records acceptance of the versions THIS bundle displayed. */
export function acceptCurrentConsent({ general, sensitive }) {
  return invokeFunction(base44, 'myConsent', {
    action: 'accept',
    general: general === true,
    sensitive: sensitive === true,
    noticeVersion: PRIVACY_NOTICE_VERSION,
    termsVersion: SERVICE_TERMS_VERSION,
  });
}

/** { platformOwner, hasProfile, role, soleAdmin, soleAdminSchools } */
export function previewAccountDeletion() {
  return invokeFunction(base44, 'deleteMyAccount', { action: 'preview' }, { idempotent: true });
}

/** Deletes the caller's own account. The server re-checks the word. */
export function deleteMyAccount(confirm) {
  return invokeFunction(base44, 'deleteMyAccount', { action: 'delete', confirm });
}
