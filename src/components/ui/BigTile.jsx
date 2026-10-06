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

  // Keyboard parity with native controls: Enter/Space activate the tile when it
  // is rendered as a custom button (the `onClick` branch below). Mirrors the
  // day-cell pattern already used in CalendarioEscolar.
  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      onClick?.(event);
    }
  };

  // Shared focus ring so keyboard users can see where they are, regardless of
  // whether the tile is a link or a button.
  const focusRing =
    'block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2';

  // Fold the badge count into the accessible name so screen-reader users hear
  // "Avisos, 3 pendientes" instead of just "Avisos" with no hint of the count.
  const hasBadge = badge !== undefined && badge > 0;
  const accessibleName = hasBadge ? `${title}, ${badge} pendientes` : title;

  const content = (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: reduceMotion ? 0 : delay, duration: 0.3 }}
      whileHover={reduceMotion ? undefined : { y: -2 }}
      whileTap={reduceMotion ? undefined : { scale: 0.99 }}
      className="group relative flex items-center gap-4 overflow-hidden rounded-2xl border border-border/70 bg-card p-4 ui-elevation transition-[colors,box-shadow] hover:border-brand/40 sm:p-5"
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
        <h3 className="break-words font-display text-base font-semibold tracking-tight text-card-foreground">
          {title}
        </h3>
        {subtitle && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{subtitle}</p>}
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
    return (
      <Link to={href} className={focusRing} aria-label={accessibleName}>
        {content}
      </Link>
    );
  }

  return (
    <div
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={accessibleName}
      className={`${focusRing} cursor-pointer`}
    >
      {content}
    </div>
  );
}
