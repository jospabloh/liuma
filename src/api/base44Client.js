import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';

const { appId, token, functionsVersion, appBaseUrl } = appParams;

// requiresAuth: false tells the SDK not to block unauthenticated requests at
// the client level; auth enforcement is handled by the Base44 backend and by
// the AuthContext / GuardedRoute layer in this app.
export const base44 = createClient({
  appId,
  token,
  functionsVersion,
  serverUrl: '',
  requiresAuth: false,
  appBaseUrl
});
