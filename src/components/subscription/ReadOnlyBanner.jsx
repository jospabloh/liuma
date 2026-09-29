import React from 'react';
import { motion } from 'framer-motion';
import { Lock, ExternalLink } from 'lucide-react';
import { useCanWrite } from '@/hooks/useCanWrite';
import { useSubscription } from '@/hooks/useSubscription';
import { licenseNotice } from '@/lib/license/licenseModel';
import { licenseNoticeCopy } from '@/lib/license/licenseNoticeCopy';
import { licensePaymentAction } from '@/lib/license/billingContact';

/**
 * ReadOnlyBanner — shown on write surfaces when the school's license is
 * read-only (view_only / suspended / expired trial / no license at all — fail
 * closed, see licenseModel.resolveEffectiveLicense). Says why, that nothing
 * was lost, and — for the school admin — how to pay. Renders nothing when
 * writes are allowed.
 */
export default function ReadOnlyBanner({ className = '' }) {
  const { isReadOnly } = useCanWrite();
  const { subscription, loadFailed, isSchoolAdmin, school } = useSubscription();
  if (!isReadOnly) return null;

  const copy = loadFailed
    ? {
        title: 'No pudimos verificar tu licencia',
        body: 'Mientras tanto no se pueden guardar cambios. Recarga la página en un momento; si continúa, escríbenos a soporte@acaciaco.com.mx.',
        showPay: false,
      }
    : licenseNoticeCopy(licenseNotice(subscription), { isAdmin: isSchoolAdmin }) || {
        title: 'Modo solo lectura',
        body: 'Puedes consultar la información, pero no hacer cambios.',
        showPay: false,
      };
  const pay = copy.showPay ? licensePaymentAction({ schoolName: school?.name }) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      role="status"
      className={`bg-amber-50 border border-amber-200 dark:bg-amber-950 dark:border-amber-800 rounded-xl p-4 mb-6 ${className}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Lock className="w-5 h-5 text-amber-600 dark:text-amber-300 mt-0.5 flex-shrink-0" aria-hidden="true" />
        <div className="flex-1">
          <p className="font-semibold text-amber-900 dark:text-amber-100 mb-0.5">{copy.title}</p>
          <p className="text-sm text-amber-900/80 dark:text-amber-100/80">{copy.body}</p>
        </div>
        {pay && (
          <a
            href={pay.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 inline-flex items-center gap-1 text-sm font-semibold text-amber-900 dark:text-amber-100 underline"
          >
            {pay.label} <ExternalLink className="w-3 h-3" aria-hidden="true" />
          </a>
        )}
      </div>
    </motion.div>
  );
}
