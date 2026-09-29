import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { rememberInviteCode } from '@/lib/onboarding/joinCode'
import { claimChunkReload } from '@/lib/chunkReload'

// An invitation link (/?codigo=ABCD-EFGH) must survive the redirect to /login
// and back — see rememberInviteCode.
rememberInviteCode(window.location.search)

// After a deploy, an open tab asks for lazy chunks that no longer exist. Vite
// fires `vite:preloadError` for exactly that; reload once to pick up the new
// build. If we already reloaded a moment ago, let the error through so the
// route's ErrorBoundary shows "Recargar" instead of looping. See chunkReload.js.
window.addEventListener('vite:preloadError', (event) => {
  let storage = null;
  try { storage = window.sessionStorage; } catch { /* blocked site data */ }
  if (storage && claimChunkReload(storage)) {
    event.preventDefault();
    window.location.reload();
  }
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
