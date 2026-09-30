import React from 'react';
import GlobalLumiBubble from '@/components/lumi/GlobalLumiBubble';
import BottomNav from '@/components/nav/BottomNav';
import SideNav from '@/components/nav/SideNav';
import { NavProvider } from '@/components/nav/NavContext';
import { installConsoleCapture } from '@/lib/support/diagnostics';

// Retain recent console warnings/errors so a support ticket can attach them.
// Installed once at module load; no-op on repeat calls (see diagnostics.js).
installConsoleCapture();

export default function Layout({ children, currentPageName }) {
  return (
    <div className="min-h-screen bg-background">
      <style>{`
        /* Mobile-first scrolling */
        * {
          -webkit-overflow-scrolling: touch;
        }
        
        /* Hide scrollbar for cleaner mobile look */
        ::-webkit-scrollbar {
          width: 4px;
          height: 4px;
        }
        
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        
        ::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 2px;
        }
        
        /* A finger, not a width: a large iPhone in landscape is wider than
           767px and still zooms on a <16px field and still needs 44px. */
        @media (max-width: 767px), (pointer: coarse) {
          .mobile-touch-target {
            min-height: 44px;
          }

          .mobile-input-no-zoom {
            font-size: 16px;
          }
        }
      `}</style>
      
      {/* The app's single toaster is mounted in App.jsx (components/ui/sonner),
          so toasts also show outside this Layout and follow the theme. */}
      
      <NavProvider>
        {/* Persistent desktop rail (md+); mobile uses the BottomNav below. The
            content is offset on desktop so the fixed rail never covers it. */}
        <SideNav />
        <div className="md:pl-64">
          {children}
          <footer className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">
            <a
              href="https://acaciaco.com.mx"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-slate-700 hover:dark:text-slate-200 underline"
            >
              creado con cariño ❤ por ACACIA Consultoría
            </a>
          </footer>
        </div>
        <GlobalLumiBubble />
        <BottomNav />
      </NavProvider>
    </div>
  );
}
