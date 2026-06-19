import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';

// Branded greeting band. The background is the tenant's own brand color
// (bg-primary) and the text adapts to it (text-primary-foreground), so the
// header is the school's identity rather than a hardcoded gradient.
export function HomeHeader({ eyebrow, title, subtitle, children }) {
  const reduceMotion = useReducedMotion();
  return (
    <div className="relative overflow-hidden bg-primary px-6 pt-12 pb-12 text-primary-foreground">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-white/10 blur-2xl"
      />
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative mx-auto max-w-2xl"
      >
        {eyebrow && <p className="text-sm capitalize text-primary-foreground/75">{eyebrow}</p>}
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-primary-foreground">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-primary-foreground/80">{subtitle}</p>}
        {children}
      </motion.div>
    </div>
  );
}

// A labeled group of tiles. The eyebrow encodes a real grouping of the
// product's surfaces, so structure carries meaning instead of decorating.
export function HomeSection({ label, children, className = '' }) {
  return (
    <section className={className}>
      {label && (
        <p className="mb-3 px-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
      )}
      <div className="space-y-3">{children}</div>
    </section>
  );
}
