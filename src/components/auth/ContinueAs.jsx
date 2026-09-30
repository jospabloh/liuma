import { base44 } from '@/api/base44Client';
import { getRememberedIdentity, clearRememberedIdentity } from '@/lib/lastIdentity';
import { loginUrl } from '@/lib/authLinks';

// Welcome-back screen shown when there is NO active session but we remember who
// signed in last. Purely cosmetic: the buttons just kick off the real Base44
// auth flow — authorization still depends entirely on the Base44 session + RLS.
//
//   • Continuar como {nombre}  → redirectToLogin(currentUrl). If the Base44
//     session cookie is still alive, Base44 bounces straight back with a fresh
//     token (no credentials asked). If everything expired, Base44 asks for
//     credentials — that's the security boundary, we don't try to evade it.
//   • Usar otra cuenta → clear the remembered identity AND log out (clears the
//     Base44 session cookie) so the user can actually pick a different account.
//
// Returns null when there's no remembered identity, so the caller can fall back
// to the plain login redirect (today's behavior).
export default function ContinueAs() {
  const identity = getRememberedIdentity();
  if (!identity) return null;

  const name = identity.name || identity.email;
  const initial = (name || '?').trim().charAt(0).toUpperCase();

  const continueAs = () => base44.auth.redirectToLogin(window.location.href);
  const useOther = () => {
    clearRememberedIdentity();
    // Back to LIUMA's Spanish login (/entrar), where "otra cuenta" can sign in.
    base44.auth.logout(loginUrl());
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-50 dark:bg-background p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-card p-7 text-center shadow-xl shadow-slate-200/50 dark:shadow-none">
        {identity.avatar ? (
          <img src={identity.avatar} alt="" className="mx-auto h-16 w-16 rounded-full object-cover" />
        ) : (
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-500 text-2xl font-semibold text-white">
            {initial}
          </div>
        )}

        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">¿Eres tú?</p>
        <h1 className="mt-0.5 text-xl font-semibold text-slate-900 dark:text-slate-100">{name}</h1>
        {identity.email && identity.name && (
          <p className="mt-0.5 text-sm text-slate-400 dark:text-slate-500">{identity.email}</p>
        )}

        <button
          onClick={continueAs}
          className="mt-6 w-full rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 px-4 py-3 text-sm font-medium text-white shadow-lg shadow-sky-500/25 transition hover:opacity-95"
        >
          Continuar como {identity.name ? identity.name.split(' ')[0] : name}
        </button>

        <button
          onClick={useOther}
          className="mt-3 w-full rounded-xl px-4 py-2 text-sm font-medium text-slate-500 dark:text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 hover:dark:bg-slate-800 hover:dark:text-slate-200"
        >
          Usar otra cuenta
        </button>
      </div>
    </div>
  );
}
