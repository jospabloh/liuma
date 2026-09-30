import React from 'react';

/**
 * Field-level error: rendered right under its field, announced to screen
 * readers, and tied to the field through `aria-describedby={id}`.
 *
 * Red text rather than `text-destructive`: the dark palette's --destructive is
 * a 30 % lightness red meant for filled buttons, and as text on the dark card
 * it is close to unreadable. red-600 / red-400 is the pair the rest of the
 * app already uses for inline warnings (PermisosRoles).
 */
export default function FieldError({ id, message }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">
      {message}
    </p>
  );
}
