import React from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Calendar } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate, schoolDaysFromToday } from '@/lib/dates';

export default function WelcomeTrialModal({ subscription, onClose }) {
  // "Seen" state now lives on the user profile (see Home.jsx); this modal only
  // needs the subscription for the trial details it displays.
  if (!subscription) return null;

  // trial_end_date may be date-only ('2026-10-29', written by Mission
  // Control's set_dates, fixtures or a hand edit) or a full instant (what
  // provisionOnboardingProfile writes). new Date('2026-10-29') is UTC midnight
  // = Oct 28 18:00 in Mexico, so this modal said "Vence: 28 de octubre" and
  // counted a day short. parseLocalDate keeps the calendar day; the count is
  // whole calendar days from the school's today.
  const trialEnd = parseLocalDate(subscription.trial_end_date);
  const daysLeft = Math.max(0, schoolDaysFromToday(trialEnd) ?? 0);

  return (
    <Dialog open={true} onOpenChange={onClose}>
      {/* One close button: DialogContent's own. The [&>button] variants only
          recolor it for the brand band it sits on (it used to be doubled by a
          second, hand-made X). */}
      <DialogContent className="max-w-md p-0 overflow-hidden [&>button]:text-white/80 [&>button:hover]:bg-white/20 [&>button:hover]:text-white">
        <div className="relative bg-brand p-8 text-white">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-center"
          >
            <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-10 h-10" />
            </div>
            
            <DialogTitle className="text-2xl font-bold leading-normal tracking-normal mb-2">¡Bienvenido a LIUMA!</DialogTitle>
            <DialogDescription className="text-white/90 text-sm">
              Tu período de prueba gratuito ha comenzado
            </DialogDescription>
          </motion.div>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-brand/10 rounded-xl p-4 border border-brand/30">
            <div className="flex items-center gap-3 mb-2">
              <Calendar className="w-5 h-5 text-brand" />
              <p className="font-semibold text-foreground">Período de prueba</p>
            </div>
            <p className="text-sm text-muted-foreground">
              Tienes <strong className="text-brand">{daysLeft === 1 ? '1 día' : `${daysLeft} días`}</strong> para explorar todas las funcionalidades de LIUMA sin costo.
            </p>
            {trialEnd && (
              <p className="text-xs text-muted-foreground mt-2">
                Vence: {format(trialEnd, "d 'de' MMMM, yyyy", { locale: es })}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold text-foreground">¿Qué incluye?</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✓</span>
                <span>Bitácoras diarias ilimitadas</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✓</span>
                <span>Asistente inteligente Lumi</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✓</span>
                <span>Gestión de avisos y tareas</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✓</span>
                <span>Control de pagos y menús</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✓</span>
                <span>Soporte técnico incluido</span>
              </li>
            </ul>
          </div>

          <Button
            onClick={onClose}
            className="w-full bg-brand text-white hover:bg-brand/90"
          >
            Comenzar a usar LIUMA
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            © 2026 ACACIA Consultoría. Todos los derechos reservados.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}