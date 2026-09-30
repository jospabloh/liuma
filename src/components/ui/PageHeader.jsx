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
  
  // The title group is `flex-auto` (basis = its natural width) in a wrapping
  // row: when title + actions don't fit on one line, the actions WRAP onto
  // their own row instead of squeezing the title, and the title only
  // shrinks once it alone is wider than the whole row. Before 2026-09-30 the
  // actions were shrink-0 next to a min-w-0 title, so at 320–390px a
  // "Nuevo Descuento" button left the H1 16px wide ("G…") and squeezed the
  // back arrow to 18–34px. The title may take two lines on a phone rather than
  // truncating mid-word; one line (truncate) from sm up.
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 flex flex-wrap items-center justify-between gap-x-3 gap-y-3"
      data-page-header=""
    >
      <div className="flex min-w-0 flex-auto items-center gap-3">
        {showBack && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Volver"
            onClick={handleBack}
            className="mobile-touch-target shrink-0 rounded-full border border-transparent hover:border-border"
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
          <h1 className="text-2xl sm:text-[28px] font-semibold leading-tight tracking-tight text-foreground break-words line-clamp-2 sm:line-clamp-none sm:truncate">{title}</h1>
          {subtitle && <p className="text-muted-foreground mt-1 break-words line-clamp-2 sm:line-clamp-none sm:truncate">{subtitle}</p>}
        </div>
      </div>
      <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
        {searchEnabled && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Buscar"
            onClick={openPalette}
            className="mobile-touch-target shrink-0 rounded-full border border-transparent hover:border-border"
          >
            <Search className="w-5 h-5" />
          </Button>
        )}
        {action && <div className="min-w-0">{action}</div>}
      </div>
    </motion.div>
  );
}
