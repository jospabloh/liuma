import React from 'react';
import { motion } from 'framer-motion';
import { Lock, ExternalLink } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

export default function SuspendedAccountModal({ subscription }) {
  if (!subscription || subscription.subscription_status !== 'suspended') return null;

  return (
    <Dialog open={true} onOpenChange={() => {}}>
      <DialogContent 
        className="max-w-md p-0 overflow-hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="relative bg-destructive p-8 text-destructive-foreground">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-center"
          >
            <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <Lock className="w-10 h-10" />
            </div>

            <h2 className="text-2xl font-bold mb-2">Cuenta suspendida</h2>
            <p className="text-destructive-foreground/80 text-sm">
              Tu suscripción a LIUMA ha sido suspendida
            </p>
          </motion.div>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-muted rounded-xl p-4 border border-border">
            <p className="text-sm text-foreground mb-3">
              Tu cuenta está en <strong>modo de solo lectura</strong>. Puedes ver la información pero no realizar cambios hasta que se reactive tu suscripción.
            </p>
            {subscription.suspension_reason && (
              <div className="bg-card rounded-lg p-3 border border-border">
                <p className="text-xs font-semibold text-muted-foreground mb-1">Motivo:</p>
                <p className="text-sm text-foreground">{subscription.suspension_reason}</p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold text-foreground">¿Qué puedes hacer?</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✓</span>
                <span>Ver bitácoras y registros anteriores</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✓</span>
                <span>Consultar información de alumnos</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-500 mt-0.5">✗</span>
                <span>Crear nuevas bitácoras o avisos</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-500 mt-0.5">✗</span>
                <span>Modificar información existente</span>
              </li>
            </ul>
          </div>

          <Button
            className="w-full bg-brand text-white hover:bg-brand/90"
            onClick={() => window.open('https://forms.gle/jLQ4EtWmQhkSsahy9', '_blank')}
          >
            Contáctanos para reactivar <ExternalLink className="w-4 h-4 ml-2" />
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            © 2026 ACACIA Consultoría. Todos los derechos reservados.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}