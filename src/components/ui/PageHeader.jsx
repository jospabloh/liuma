import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Search } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { useNavigate } from 'react-router-dom';
import { useNav } from '@/components/nav/NavContext';

export default function PageHeader({
  title,
  subtitle,
  eyebrow,
  showBack = false,
  backTo,
  action,
  showSearch = true,
}) {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const { openPalette, role } = useNav();
  // Only offer search where the palette can actually open (a role is resolved);
  // avoids a dead button on pre-profile screens like onboarding/setup.
  const searchEnabled = showSearch && !!role;

  const handleBack = () => {
    if (backTo) {
      navigate(backTo);
    } else {
      navigate(-1);
    }
  };
  
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center justify-between mb-6"
    >
      <div className="flex items-center gap-3 min-w-0">
        {showBack && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Volver"
            onClick={handleBack}
            className="mobile-touch-target rounded-full border border-transparent hover:border-border"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
        )}
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand">
              <span className="inline-block h-1 w-4 rounded-full bg-brand" aria-hidden="true" />
              {eyebrow}
            </p>
          )}
          <h1 className="text-2xl sm:text-[28px] font-semibold leading-tight tracking-tight text-foreground truncate">{title}</h1>
          {subtitle && <p className="text-muted-foreground mt-1 truncate">{subtitle}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {searchEnabled && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Buscar"
            onClick={openPalette}
            className="mobile-touch-target rounded-full border border-transparent hover:border-border"
          >
            <Search className="w-5 h-5" />
          </Button>
        )}
        {action && <div>{action}</div>}
      </div>
    </motion.div>
  );
}
