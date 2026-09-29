import React from 'react';
import { motion } from 'framer-motion';
import { Check, Sparkles, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PLAN_TIERS, PLAN_CATALOG, ACTIVATION_FEE, planLabel } from '@/lib/license/licenseModel';

const CONTACT_FORM_URL = 'https://forms.gle/jLQ4EtWmQhkSsahy9';
const WHATSAPP_URL = 'https://wa.me/524498958291?text=Hola%2C%20quiero%20activar%20o%20mejorar%20mi%20licencia%20LIUMA';

/**
 * UpgradePlansModal — shows LIUMA's license tiers and routes the institution to
 * ACACIA to activate or upgrade. Activation is manually assisted (cobro en
 * Mercado Pago, confirmación manual por ACACIA), mirroring FlowFin.
 */
export default function UpgradePlansModal({ open, onClose, currentTier, reason }) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose?.(); }}>
      <DialogContent className="max-w-lg p-0 overflow-hidden max-h-[92vh] overflow-y-auto">
        <div className="bg-brand p-6 text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2 text-xl">
              <Sparkles className="w-5 h-5" /> Planes LIUMA
            </DialogTitle>
          </DialogHeader>
          <p className="text-white/90 text-sm mt-1">
            {reason || 'Elige el plan adecuado para tu institución.'}
          </p>
        </div>

        <div className="p-5 space-y-3">
          {PLAN_TIERS.map((tier) => {
            const plan = PLAN_CATALOG[tier];
            const isCurrent = tier === currentTier;
            return (
              <motion.div
                key={tier}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={`rounded-2xl border p-4 ${
                  plan.popular ? 'border-brand/30 bg-brand/5' : 'border-border bg-card'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-foreground">{plan.label}</h3>
                      {plan.popular && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand text-white">Popular</span>
                      )}
                      {isCurrent && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">Tu plan</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{plan.desc}</p>
                  </div>
                  <p className="text-sm font-bold text-brand whitespace-nowrap">{plan.price}</p>
                </div>
                <ul className="space-y-1.5 mt-2">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" /> {f}
                    </li>
                  ))}
                </ul>
                {plan.enterpriseNote && (
                  <p className="mt-2 text-[11px] text-brand bg-brand/10 rounded-lg px-2.5 py-1.5">
                    {plan.enterpriseNote}
                  </p>
                )}
              </motion.div>
            );
          })}

          <p className="text-[11px] text-muted-foreground text-center px-2">
            Activación inicial (cuando aplica): <strong>{ACTIVATION_FEE.label}</strong> única vez. La
            suscripción se cobra vía Mercado Pago y ACACIA activa tu licencia manualmente.
          </p>

          <div className="grid grid-cols-1 gap-2 pt-1">
            <Button asChild className="bg-brand text-white hover:bg-brand/90">
              <a href={CONTACT_FORM_URL} target="_blank" rel="noreferrer">
                Solicitar activación / mejora <ExternalLink className="w-4 h-4 ml-1.5" />
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={WHATSAPP_URL} target="_blank" rel="noreferrer">
                Contactar por WhatsApp <ExternalLink className="w-4 h-4 ml-1.5" />
              </a>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { planLabel };
