import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { onFunctionWrite } from '@/lib/functionResponse';
import { MY_SUBSCRIPTION_QUERY_KEY } from '@/lib/license/subscriptionSession';
import {
  mutationErrorToast, queryErrorToast, QUERY_STALE_TIME_MS, queryRetryDelay, shouldRetryQuery,
} from '@/lib/queryErrorPolicy';

// Global failure feedback. Before this, a failed load rendered as an empty
// state ("sin alumnos") and a failed write — a rejected attendance mark, a
// read-only license — looked like it had saved. Now every failure the call
// site did not handle itself produces one Spanish toast. Which failures, and
// the opt-outs (`onError` on the mutation, `meta: { silentError: true }`),
// live in queryErrorPolicy.js.

const queryCache = new QueryCache({
  onError: (error, query) => {
    const t = queryErrorToast(error, query);
    if (t) toast.error(t.message, { id: t.id });
  },
});

const mutationCache = new MutationCache({
  onError: (error, _variables, _context, mutation) => {
    const t = mutationErrorToast(error, mutation);
    if (t) toast.error(t.message);
  },
  // See markAllStale below.
  onSuccess: () => markAllStale(),
});

export const queryClientInstance = new QueryClient({
	queryCache,
	mutationCache,
	defaultOptions: {
		queries: {
			// v1.8.3 (Base44 rate limit, see queryErrorPolicy.js): a list stays
			// fresh for 30 s, so remounting a screen does not refetch it;
			// identical keys are deduped by React Query itself; and a failed
			// read is retried only when it can succeed (rate limit, 5xx, no
			// answer), with jittered backoff, and only if invokeFunction has
			// not already retried it.
			staleTime: QUERY_STALE_TIME_MS,
			refetchOnWindowFocus: false,
			retry: shouldRetryQuery,
			retryDelay: queryRetryDelay,
		},
		mutations: {
			// A write goes out once. Retrying it could duplicate a payment or
			// an email (see functionRetry.js).
			retry: false,
		},
	},
});

// With a 30 s staleTime a screen visited a moment ago is served from cache.
// That must never show data from before a write the person just made on
// another screen whose query keys the write did not invalidate. So after ANY
// successful write — a useMutation, or a backend function outside the read
// list (guardedCreate/guardedUpdate called straight from a handler) — every
// cached query is marked stale WITHOUT refetching it now (`refetchType:
// 'none'`): the next screen to mount re-reads, as it did before v1.8.3, and
// nothing on screen fires a burst of refetches. Each mutation's own
// invalidateQueries still refreshes what is mounted.
// Who-am-I and the license are per session, not per write: a school's own
// writes never change them, and the screens that do (licencia, perfil)
// invalidate them by key. Re-reading them after every write would put
// getMySubscription back on every screen.
const SESSION_KEYS = new Set(['currentUser', MY_SUBSCRIPTION_QUERY_KEY]);
function markAllStale() {
  queryClientInstance.invalidateQueries({
    refetchType: 'none',
    predicate: (query) => !SESSION_KEYS.has(query.queryKey?.[0]),
  });
}
onFunctionWrite(markAllStale);
