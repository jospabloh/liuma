import React, { useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * LoadError — what a screen shows when its data could NOT be loaded (v1.8.3),
 * instead of the empty state it used to show ("Sin avisos" while the notices
 * existed). Says it failed, why in one Spanish sentence, that nothing was
 * lost, and offers "Reintentar". Pair it with blockingLoadFailure()
 * (src/lib/loadFailure.js).
 *
 *   const failure = blockingLoadFailure(noticesQuery, deliveriesQuery);
 *   if (failure) return <LoadError failure={failure} title="No se pudieron cargar los avisos" />;
 *
 * `compact` renders an inline row for a card or a section of a page.
 */
export default function LoadError({
  failure,
  title = 'No se pudo cargar la información',
  compact = false,
  className = '',
}) {
  const [retrying, setRetrying] = useState(false);
  if (!failure) return null;
  const description = `${failure.message} Tus datos no se perdieron.`;

  const onRetry = async () => {
    setRetrying(true);
    try {
      await failure.retry();
    } finally {
      setRetrying(false);
    }
  };

  const button = (
    <Button variant="outline" size={compact ? 'sm' : 'default'} onClick={onRetry} disabled={retrying} className="min-h-11">
      <RefreshCw className={retrying ? 'animate-spin' : ''} aria-hidden="true" />
      {retrying ? 'Reintentando…' : 'Reintentar'}
    </Button>
  );

  if (compact) {
    return (
      <div role="alert" className={`flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950 sm:flex-row sm:items-center ${className}`}>
        <AlertCircle className="h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
        <p className="flex-1 text-amber-900 dark:text-amber-100"><span className="font-semibold">{title}.</span> {description}</p>
        {button}
      </div>
    );
  }

  return (
    <div role="alert" className={`flex flex-col items-center justify-center space-y-2 px-6 py-12 text-center ${className}`}>
      <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100 ring-1 ring-inset ring-amber-200 dark:bg-amber-950 dark:ring-amber-800">
        <AlertCircle className="h-8 w-8 text-amber-600 dark:text-amber-300" aria-hidden="true" />
      </div>
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      <div className="mt-4">{button}</div>
    </div>
  );
}
