import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

// One disciplined treatment for every tile: a calm white card with a left
// accent rail and an icon chip tinted in the tenant's brand color. The brand
// color is the single loud thing; everything else stays quiet, so the same
// tile reads coherently for any school's palette.
export default function BigTile({
  icon: Icon,
  title,
  subtitle,
  badge,
  badgeColor = 'bg-destructive',
  href,
  onClick,
  delay = 0,
}) {
  const reduceMotion = useReducedMotion();

  const content = (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: reduceMotion ? 0 : delay, duration: 0.3 }}
      whileHover={reduceMotion ? undefined : { y: -2 }}
      whileTap={reduceMotion ? undefined : { scale: 0.99 }}
      className="group relative flex items-center gap-4 overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-brand/40 sm:p-5"
    >
      {/* Brand accent rail — the tenant color, used as a quiet signature. */}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1 bg-brand opacity-70 transition-opacity group-hover:opacity-100"
      />
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
        <Icon className="h-6 w-6" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-display text-base font-semibold tracking-tight text-card-foreground">
          {title}
        </h3>
        {subtitle && <p className="mt-0.5 truncate text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {badge !== undefined && badge > 0 && (
          <span
            className={`${badgeColor} min-w-[24px] rounded-full px-2.5 py-1 text-center text-xs font-bold text-white`}
          >
            {badge}
          </span>
        )}
        <ChevronRight className="h-5 w-5 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
      </div>
    </motion.div>
  );

  if (href) {
    return <Link to={href}>{content}</Link>;
  }

  return (
    <div onClick={onClick} role="button" tabIndex={0}>
      {content}
    </div>
  );
}
