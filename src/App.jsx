import { Toaster } from "@/components/ui/sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import NavigationTracker from '@/lib/NavigationTracker'
import SessionHeartbeat from '@/lib/SessionHeartbeat'
import { pagesConfig } from './pages.config'
import React, { Suspense, useEffect } from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ContinueAs from '@/components/auth/ContinueAs';
import { getRememberedIdentity } from '@/lib/lastIdentity';
import { readResetToken, LOGIN_PATH } from '@/lib/authLinks';
import GuardedRoute from '@/components/GuardedRoute';
import RouteErrorBoundary from '@/components/RouteErrorBoundary';
import TenantThemeRuntime from '@/components/theme/TenantThemeRuntime';
import { ThemeProvider } from '@/lib/ThemeContext';
import ThemeSwitcher from '@/components/ThemeSwitcher';
import Login from '@/pages/Login';
import ConsentGate from '@/components/consent/ConsentGate';
import { PRIVACY_NOTICE, SERVICE_TERMS } from '@/lib/legal/legalDocs';

const LegalDocumentPage = React.lazy(() => import('@/components/legal/LegalDocumentPage'));

// Public legal pages. Rendered BEFORE AuthenticatedApp — no auth, no profile,
// no GuardedRoute — because the onboarding consent checkbox links here and the
// person reading it has no UserProfile yet. See src/lib/legal/legalDocs.js.
const PUBLIC_LEGAL_DOCS = [PRIVACY_NOTICE, SERVICE_TERMS];

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const PageTransitionFallback = () => (
  <div className="min-h-[30vh] w-full px-4 py-6 sm:py-10">
    <div className="mx-auto max-w-sm space-y-4 animate-pulse">
      <div className="h-6 w-2/3 rounded-md bg-slate-200 dark:bg-slate-800" />
      <div className="h-4 w-full rounded-md bg-slate-200 dark:bg-slate-800" />
      <div className="h-4 w-5/6 rounded-md bg-slate-200 dark:bg-slate-800" />
      <div className="flex justify-center pt-2">
        <div className="h-8 w-8 rounded-full border-4 border-slate-200 dark:border-slate-800 border-t-slate-800 dark:border-t-slate-200 animate-spin" />
      </div>
    </div>
  </div>
);

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

// Reset scroll to the top on every route change. Without this, navigating from
// a long dashboard into a deep page (or back) preserves the previous scroll
// offset and users can land mid-page. Renders nothing.
const ScrollToTopOnNavigate = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname]);
  return null;
};

// Unauthenticated visitors land on LIUMA's login (LOGIN_PATH = /entrar) from
// any path. The query string travels with them so a password-reset link
// (?reset_token=…) still reaches the login screen's reset form. Not /login:
// the platform serves that path itself, in English, on every full page load —
// see src/lib/authLinks.js.
const RedirectToLogin = () => {
  const { search } = useLocation();
  return <Navigate to={{ pathname: LOGIN_PATH, search }} replace />;
};

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 dark:border-slate-800 border-t-slate-800 dark:border-t-slate-200 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Remembered user → friendly "Continuar como" card, which silently
      // re-authenticates via the Base44 session cookie through
      // redirectToLogin(). Otherwise render our own in-app login (/entrar) instead
      // of bouncing out to Base44's hosted login — any other path also lands
      // there, since nothing in the app is reachable while unauthenticated.
      // …except when the visitor arrived from a password-reset e-mail: that
      // link must reach the reset form, not "Continuar como". (The public
      // legal pages are matched in App, before this component renders.)
      if (getRememberedIdentity() && !readResetToken(window.location.search)) {
        return <ContinueAs />;
      }
      return (
        <Routes>
          <Route path={LOGIN_PATH} element={<Login />} />
          <Route path="*" element={<RedirectToLogin />} />
        </Routes>
      );
    }
  }

  // Render the main app — behind the mandatory consent screen (v1.9.0): a
  // profile without the current Aviso/Términos acceptance sees ConsentGate's
  // screen (or the account-deletion page it leads to) and nothing else.
  return (
    <ConsentGate>
    <Routes>
      <Route path="/" element={
        <LayoutWrapper currentPageName={mainPageKey}>
          <RouteErrorBoundary>
            <Suspense fallback={<PageTransitionFallback />}><MainPage /></Suspense>
          </RouteErrorBoundary>
        </LayoutWrapper>
      } />
      {/* Already authenticated — the login screen has nothing to do, send them
          home. /login only ever arrives here by client-side navigation. */}
      <Route path={LOGIN_PATH} element={<Navigate to="/" replace />} />
      <Route path="/login" element={<Navigate to="/" replace />} />
      {Object.entries(Pages).map(([path, Page]) => (
        <Route
          key={path}
          path={`/${path}`}
          element={
            <GuardedRoute routeName={path}>
              <LayoutWrapper currentPageName={path}>
                <RouteErrorBoundary>
                  <Suspense fallback={<PageTransitionFallback />}><Page /></Suspense>
                </RouteErrorBoundary>
              </LayoutWrapper>
            </GuardedRoute>
          }
        />
      ))}
      <Route path="*" element={<PageNotFound />} />
    </Routes>
    </ConsentGate>
  );
};


function App() {

  return (
    <ThemeProvider>
      <AuthProvider>
        <QueryClientProvider client={queryClientInstance}>
          <Router>
            <ScrollToTopOnNavigate />
            <NavigationTracker />
            <SessionHeartbeat />
            <TenantThemeRuntime />
            <Routes>
              {PUBLIC_LEGAL_DOCS.map((doc) => (
                <Route
                  key={doc.path}
                  path={doc.path}
                  element={<Suspense fallback={<PageTransitionFallback />}><LegalDocumentPage doc={doc} /></Suspense>}
                />
              ))}
              <Route path="*" element={<AuthenticatedApp />} />
            </Routes>
          </Router>
          <Toaster />
          <ThemeSwitcher />
        </QueryClientProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App
