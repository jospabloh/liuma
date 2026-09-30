import React from 'react';
import { motion } from 'framer-motion';
import { MessageCircle, Sparkles } from 'lucide-react';

export default function LumiButton({ onClick, className = '', isOpen = false }) {
  return (
    <motion.button
      aria-label={isOpen ? "Cerrar chat de Lumi" : "Abrir chat de Lumi"}
      aria-expanded={isOpen}
      onClick={onClick}
      // Lift the bubble by the safe-area inset (home indicator / landscape
      // notch) on top of its bottom/right offsets. A margin on a fixed element
      // adds to its offset, so the class positions stay as they are and the
      // corner ThemeSwitcher — which adds the same inset to its own offset —
      // stays stacked above it (src/index.css, --theme-switcher-bottom).
      style={{
        marginBottom: 'env(safe-area-inset-bottom, 0px)',
        marginRight: 'env(safe-area-inset-right, 0px)',
      }}
      className={`fixed bottom-20 right-4 md:bottom-6 md:right-6 z-40 w-14 h-14 md:w-16 md:h-16 rounded-full bg-gradient-to-br from-[var(--tenant-accent)] to-[var(--tenant-primary)] text-white shadow-2xl flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--tenant-primary)] ${className}`}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.95 }}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 20 }}
    >
      <div className="relative">
        <MessageCircle className="w-7 h-7" />
        <motion.div
          className="absolute -top-1 -right-1"
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ repeat: Infinity, duration: 2 }}
        >
          <Sparkles className="w-4 h-4 text-yellow-300" />
        </motion.div>
      </div>
    </motion.button>
  );
}