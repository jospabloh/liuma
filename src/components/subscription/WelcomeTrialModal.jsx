import React from 'react';
import { motion } from 'framer-motion';
import { Sparkles, X, Calendar } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { format, differenceInDays } from 'date-fns';
import { es } from 'date-fns/locale';

export default function WelcomeTrialModal({ subscription, onClose }) {
  if (!subscription || subscription.welcome_message_shown) return null;

  const daysLeft = differenceInDays(new Date(subscription.trial_end_date), new Date());

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-md p-0 overflow-hidden">
        <div className="relative bg-gradient-to-br from-violet-500 via-purple-500 to-pink-500 p-8 text-white">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-white/80 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
          
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-center"
          >
            <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-10 h-10" />
            </div>
            
            <h2 className="text-2xl font-bold mb-2">¡Bienvenido a LIUMA!</h2>
            <p className="text-white/90 text-sm">
              Tu período de prueba gratuito ha comenzado
            </p>
          </motion.div>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-gradient-to-r from-violet-50 to-purple-50 rounded-xl p-4 border border-violet-200">
            <div className="flex items-center gap-3 mb-2">
              <Calendar className="w-5 h-5 text-violet-600" />
              <p className="font-semibold text-violet-800">Período de prueba</p>
            </div>
            <p className="text-sm text-slate-600">
              Tienes <strong className="text-violet-600">{daysLeft} días</strong> para explorar todas las funcionalidades de LIUMA sin costo.
            </p>
            <p className="text-xs text-slate-500 mt-2">
              Vence: {format(new Date(subscription.trial_end_date), "d 'de' MMMM, yyyy", { locale: es })}
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold text-slate-800">¿Qué incluye?</h3>
            <ul className="space-y-2 text-sm text-slate-600">
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
            className="w-full bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700"
          >
            Comenzar a usar LIUMA
          </Button>

          <p className="text-xs text-center text-slate-500">
            © 2026 ACACIA Consultoría. Todos los derechos reservados.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}