import React from 'react';
import { Toaster } from "sonner";
import GlobalLumiBubble from '@/components/lumi/GlobalLumiBubble';

export default function Layout({ children, currentPageName }) {
  return (
    <div className="min-h-screen bg-[color:var(--tenant-neutral)]/10">
      <style>{`
        :root {
          --primary: 99 102 241;
          --primary-foreground: 255 255 255;
        }
        
        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
        
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
        
        /* Large touch targets */
        button, a, input, select, textarea {
          min-height: 44px;
        }
        
        /* Prevent zoom on input focus (iOS) */
        input, select, textarea {
          font-size: 16px !important;
        }
      `}</style>
      
      <Toaster 
        position="top-center" 
        richColors 
        expand={false}
        toastOptions={{
          style: {
            borderRadius: '12px',
          }
        }}
      />
      
      {children}
      <GlobalLumiBubble />
    </div>
  );
}