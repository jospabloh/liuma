import React from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Clock, ExternalLink, Lock } from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';
import { licenseNotice } from '@/lib/license/licenseModel';
import { licenseNoticeCopy } from '@/lib/license/licenseNoticeCopy';
import { licensePaymentAction } from '@/lib/license/billingContact';

const TONES = {
  warning: {
    box: 'bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800',
    text: 'text-amber-900 dark:text-amber-100',
    icon: 'text-amber-600 dark:text-amber-300',
  },
  danger: {
    box: 'bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800',
    text: 'text-red-900 dark:text-red-100',
    icon: 'text-red-600 dark:text-red-300',
  },
};

/**
 * License notice for the home screen — BEFORE expiry (trial ending / renewal
 * due, from 7 days out, urgent at 3) and AFTER (read-only, suspended, no
 * license). Thresholds and wording live in licenseModel.licenseNotice and
 * licenseNoticeCopy (tested); this only renders. Admins get the pay button;
 * everyone else is told who can pay.
 *
 * Reads the license itself through useSubscription; the `subscription` prop is
 * accepted for backwards compatibility with existing call sites and ignored.
 */
export default function PaymentReminderBanner({ className = '' }) {
  const { subscription, isLoading, loadFailed, isSchoolAdmin, isPlatformOwner, school, userProfile } = useSubscription();
  if (isLoading || !userProfile || userProfile.status !== 'ACTIVE') return null;
  // A failed read is not "you have no license" — don't tell a paying school
  // that. Writes stay blocked (fail closed) and ReadOnlyBanner says so.
  if (loadFailed) return null;
  if (isPlatformOwner && !subscription) return null;

  const notice = licenseNotice(subscription);
  const copy = licenseNoticeCopy(notice, { isAdmin: isSchoolAdmin });
  if (!copy) return null;

  const tone = TONES[notice.tone] || TONES.warning;
  const Icon = notice.kind === 'trial_ending' || notice.kind === 'renewal_upcoming' ? Clock
    : notice.effective?.isReadOnly ? Lock : AlertCircle;
  const pay = copy.showPay ? licensePaymentAction({ schoolName: school?.name }) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      role={notice.tone === 'danger' ? 'alert' : 'status'}
      className={`border rounded-xl p-4 mb-6 ${tone.box} ${className}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${tone.icon}`} aria-hidden="true" />
        <div className="flex-1">
          <p className={`font-semibold mb-1 ${tone.text}`}>{copy.title}</p>
          <p className={`text-sm opacity-90 ${tone.text}`}>{copy.body}</p>
        </div>
        {pay && (
          <a
            href={pay.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex flex-shrink-0 items-center justify-center gap-1 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90"
          >
            {pay.label} <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          </a>
        )}
      </div>
    </motion.div>
  );
}
