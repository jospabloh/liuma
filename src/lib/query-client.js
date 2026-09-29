import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { mutationErrorToast, queryErrorToast } from '@/lib/queryErrorPolicy';

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
});

export const queryClientInstance = new QueryClient({
	queryCache,
	mutationCache,
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: 1,
		},
	},
});
