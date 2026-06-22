import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Loader2 } from 'lucide-react';

// On-brand loading screen: the mark mirrors the desktop nav rail's brand chip,
// and every color rides the tenant `brand` token / theme surfaces (no hardcoded
// hues), so it re-skins per school instead of showing one fixed accent color.
export default function LoadingScreen({ message = 'Cargando...' }) {
  const reduceMotion = useReducedMotion();
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center gap-4"
      >
        <div className="relative">
          <div className="w-16 h-16 rounded-2xl bg-brand flex items-center justify-center shadow-lg shadow-brand/30">
            <span className="text-2xl font-bold text-white">L</span>
          </div>
          <motion.div
            className="absolute -bottom-1 -right-1 w-6 h-6 bg-card rounded-full flex items-center justify-center shadow-lg"
            animate={reduceMotion ? undefined : { rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
          >
            <Loader2 className="w-4 h-4 text-brand" />
          </motion.div>
        </div>
        <p className="text-muted-foreground font-medium">{message}</p>
      </motion.div>
    </div>
  );
}