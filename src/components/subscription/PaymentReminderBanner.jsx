import React from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, ExternalLink } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { differenceInDays } from 'date-fns';

export default function PaymentReminderBanner({ subscription }) {
  if (!subscription || subscription.subscription_status === 'active') return null;
  
  const isTrialEnding = subscription.subscription_status === 'trial';
  const daysLeft = isTrialEnding 
    ? differenceInDays(new Date(subscription.trial_end_date), new Date())
    : 0;
  
  // Show banner only in last 3 days of trial or if inactive
  if (isTrialEnding && daysLeft > 3) return null;
  if (!isTrialEnding && subscription.subscription_status !== 'inactive') return null;

  const getBannerConfig = () => {
    if (isTrialEnding && daysLeft === 0) {
      return {
        bg: 'bg-red-50',
        border: 'border-red-200',
        text: 'text-red-800',
        icon: 'text-red-600',
        message: '¡Tu período de prueba termina HOY!',
        description: 'Contáctanos para continuar usando LIUMA sin interrupciones.'
      };
    }
    if (isTrialEnding && daysLeft <= 3) {
      return {
        bg: 'bg-amber-50',
        border: 'border-amber-200',
        text: 'text-amber-800',
        icon: 'text-amber-600',
        message: `Tu período de prueba termina en ${daysLeft} día${daysLeft > 1 ? 's' : ''}`,
        description: 'Asegura el acceso continuo a LIUMA.'
      };
    }
    return {
      bg: 'bg-slate-50',
      border: 'border-slate-200',
      text: 'text-slate-800',
      icon: 'text-slate-600',
      message: 'Cuenta inactiva',
      description: 'Contáctanos para reactivar tu suscripción.'
    };
  };

  const config = getBannerConfig();

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`${config.bg} ${config.border} border rounded-xl p-4 mb-6`}
    >
      <div className="flex items-start gap-3">
        <AlertCircle className={`w-5 h-5 ${config.icon} mt-0.5 flex-shrink-0`} />
        <div className="flex-1">
          <p className={`font-semibold ${config.text} mb-1`}>{config.message}</p>
          <p className={`text-sm ${config.text} opacity-80`}>{config.description}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className={`${config.text} border-current hover:bg-white/50 flex-shrink-0`}
          onClick={() => window.open('https://forms.gle/jLQ4EtWmQhkSsahy9', '_blank')}
        >
          Contáctanos <ExternalLink className="w-3 h-3 ml-1" />
        </Button>
      </div>
    </motion.div>
  );
}