import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { Suspense, useEffect } from 'react';
import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ContinueAs from '@/components/auth/ContinueAs';
import { getRememberedIdentity } from '@/lib/lastIdentity';
import GuardedRoute from '@/components/GuardedRoute';
import TenantThemeRuntime from '@/components/theme/TenantThemeRuntime';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const PageTransitionFallback = () => (
  <div className="min-h-[30vh] w-full px-4 py-6 sm:py-10">
    <div className="mx-auto max-w-sm space-y-4 animate-pulse">
      <div className="h-6 w-2/3 rounded-md bg-slate-200" />
      <div className="h-4 w-full rounded-md bg-slate-200" />
      <div className="h-4 w-5/6 rounded-md bg-slate-200" />
      <div className="flex justify-center pt-2">
        <div className="h-8 w-8 rounded-full border-4 border-slate-200 border-t-slate-800 animate-spin" />
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

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  // Redirect to login as a side effect, not during render. Calling
  // navigateToLogin() in the render body is a React anti-pattern that can
  // double-fire under StrictMode / concurrent rendering.
  useEffect(() => {
    if (authError?.type === 'auth_required') {
      // If we remember the last user, show the "Continuar como" card (rendered
      // below) instead of bouncing straight to the hosted login.
      if (!getRememberedIdentity()) {
        navigateToLogin();
      }
    }
  }, [authError, navigateToLogin]);

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Remembered user → friendly card; otherwise the effect above redirects.
      if (getRememberedIdentity()) {
        return <ContinueAs />;
      }
      return null;
    }
  }

  // Render the main app
  return (
    <Routes>
      <Route path="/" element={
        <LayoutWrapper currentPageName={mainPageKey}>
          <Suspense fallback={<PageTransitionFallback />}><MainPage /></Suspense>
        </LayoutWrapper>
      } />
      {Object.entries(Pages).map(([path, Page]) => (
        <Route
          key={path}
          path={`/${path}`}
          element={
            <GuardedRoute routeName={path}>
              <LayoutWrapper currentPageName={path}>
                <Suspense fallback={<PageTransitionFallback />}><Page /></Suspense>
              </LayoutWrapper>
            </GuardedRoute>
          }
        />
      ))}
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTopOnNavigate />
          <NavigationTracker />
          <TenantThemeRuntime />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
