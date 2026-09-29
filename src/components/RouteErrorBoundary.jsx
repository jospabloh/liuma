import React from 'react';
import { useLocation } from 'react-router-dom';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { claimChunkReload, isChunkLoadError } from '@/lib/chunkReload';

// Catches a render error — or a lazy page chunk that no longer exists after a
// deploy — inside the routed page, so the nav, the bottom bar and Lumi stay on
// screen and the user gets a Spanish message with "Recargar" instead of a white
// page. It wraps only the page (App.jsx), never the Layout.
//
// A missing chunk gets one automatic reload first (same guard as the
// vite:preloadError listener in main.jsx, so the two can't loop each other).

function safeSessionStorage() {
  try { return window.sessionStorage; } catch { return null; }
}

class Boundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // console.error is captured by the support diagnostics buffer
    // (installConsoleCapture), so a ticket filed right after carries it.
    console.error('[RouteErrorBoundary]', error, info?.componentStack);
    if (isChunkLoadError(error)) {
      const storage = safeSessionStorage();
      if (storage && claimChunkReload(storage)) window.location.reload();
    }
  }

  componentDidUpdate(prevProps) {
    // Navigating away from the broken page clears the error.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const stale = isChunkLoadError(error);
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-4" role="alert">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center text-card-foreground shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
            <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-semibold text-foreground">
            {stale ? 'Hay una versión nueva de LIUMA' : 'Esta pantalla tuvo un problema'}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {stale
              ? 'Recarga la página para usar la versión más reciente.'
              : 'Recarga la página para intentarlo de nuevo. Si vuelve a pasar, repórtalo desde Soporte.'}
          </p>
          <Button className="mt-5 gap-2" onClick={() => window.location.reload()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Recargar
          </Button>
        </div>
      </div>
    );
  }
}

export default function RouteErrorBoundary({ children }) {
  const { pathname } = useLocation();
  return <Boundary resetKey={pathname}>{children}</Boundary>;
}
