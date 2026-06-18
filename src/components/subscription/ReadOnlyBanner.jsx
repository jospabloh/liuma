import React from 'react';
import { motion } from 'framer-motion';
import { Lock, ExternalLink } from 'lucide-react';
import { useCanWrite } from '@/hooks/useCanWrite';

const CONTACT_FORM_URL = 'https://forms.gle/jLQ4EtWmQhkSsahy9';

/**
 * ReadOnlyBanner — shown on write surfaces when the school's license is in a
 * read-only state. Informs the user that changes are disabled and routes them
 * to ACACIA to reactivate. Renders nothing when writes are allowed.
 */
export default function ReadOnlyBanner({ className = '' }) {
  const { isReadOnly, billingStatus } = useCanWrite();
  if (!isReadOnly) return null;

  const message = billingStatus === 'suspended'
    ? 'Tu cuenta está suspendida.'
    : 'Tu licencia no está activa.';

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 ${className}`}
    >
      <div className="flex items-start gap-3">
        <Lock className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <p className="font-semibold text-amber-800 mb-0.5">Modo solo lectura</p>
          <p className="text-sm text-amber-800/80">
            {message} Puedes consultar la información, pero no realizar cambios hasta reactivar tu suscripción.
          </p>
        </div>
        <a
          href={CONTACT_FORM_URL}
          target="_blank"
          rel="noreferrer"
          className="flex-shrink-0 inline-flex items-center gap-1 text-sm font-medium text-amber-800 underline"
        >
          Reactivar <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </motion.div>
  );
}
