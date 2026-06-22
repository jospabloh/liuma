import { useEffect, useRef } from 'react';

/**
 * Runs an async task exactly once, the first time `ready` becomes true, for the
 * lifetime of the component. Used for the app's opportunistic admin "sweeps"
 * (there is no cron): e.g. auto-escalating breached support tickets when a
 * director opens the queue, or sending due event reminders when an admin opens
 * the calendar. Uses a ref (not state) so flipping the latch doesn't trigger an
 * extra render, and swallows/logs rejection so a failed sweep can't surface as
 * an unhandled promise rejection.
 */
export function useRunOnce(ready, run) {
  const ranRef = useRef(false);
  useEffect(() => {
    // Re-runs are cheap and no-op after the latch flips, so `run` can stay in
    // the deps without re-triggering the task.
    if (ranRef.current || !ready) return;
    ranRef.current = true;
    Promise.resolve()
      .then(run)
      .catch((error) => console.error('useRunOnce task failed', error));
  }, [ready, run]);
}
