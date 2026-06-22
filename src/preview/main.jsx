import React from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import Gallery from './Gallery.jsx';

// Mount point for the dev-only preview harness (preview.html). Kept entirely
// separate from src/main.jsx so the production app shell (auth, base44) is never
// involved — the harness renders the real UI components against mock data only.
createRoot(document.getElementById('preview-root')).render(
  <React.StrictMode>
    <Gallery />
  </React.StrictMode>,
);
