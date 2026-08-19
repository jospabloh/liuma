import React from 'react';
import { motion } from 'framer-motion';
import { Clock, LogOut } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { base44 } from '@/api/base44Client';

export default function PendingApproval() {
  const handleLogout = () => {
    base44.auth.logout();
  };
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-white dark:bg-card rounded-3xl shadow-xl p-8 text-center"
      >
        <div className="w-20 h-20 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center mx-auto mb-6">
          <Clock className="w-10 h-10 text-amber-600 dark:text-amber-400" />
        </div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-3">
          Cuenta pendiente de aprobación
        </h1>
        <p className="text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
          Tu cuenta está siendo revisada por el administrador de la escuela.
          Te notificaremos cuando sea aprobada.
        </p>
        <div className="bg-amber-50 dark:bg-amber-950/40 rounded-xl p-4 mb-6">
          <p className="text-sm text-amber-800 dark:text-amber-300">
            Este proceso normalmente toma de 1 a 2 días hábiles.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={handleLogout}
          className="gap-2"
        >
          <LogOut className="w-4 h-4" />
          Cerrar sesión
        </Button>
      </motion.div>
    </div>
  );
}