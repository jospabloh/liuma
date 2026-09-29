import { readFileSync } from 'node:fs'
import base44 from "@base44/vite-plugin"
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Read the app version without an import attribute (keeps the ESLint parser
// happy across Node versions) and surface it to support diagnostics. See
// src/lib/support/diagnostics.js.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// The dev-only preview harness (preview.html) is added as a second build entry
// only when PREVIEW=1, so normal `vite build` output stays exactly as before.
const previewInput = process.env.PREVIEW
  ? {
      input: {
        main: new URL('./index.html', import.meta.url).pathname,
        preview: new URL('./preview.html', import.meta.url).pathname,
      },
    }
  : {}

// Long-lived vendor code gets its own chunks, so a deploy that only touches
// app code doesn't make every parent's phone re-download React, the router,
// React Query and framer-motion over mobile data. Each bucket lists a package
// together with its own runtime deps: splitting a package away from a dep it
// imports would leave the two chunks importing each other (a circular chunk).
// Lazy-only libraries (recharts, jspdf, html2canvas, react-markdown) are
// deliberately NOT listed — a manual chunk for them would still load only on
// demand, but leaving them to Rollup keeps them next to the page that uses
// them.
const VENDOR_CHUNKS = {
  'vendor-react': ['react', 'react-dom', 'scheduler'],
  'vendor-router': ['react-router', 'react-router-dom', 'cookie', 'set-cookie-parser'],
  'vendor-query': ['@tanstack/react-query', '@tanstack/query-core'],
  'vendor-motion': ['framer-motion', 'motion-dom', 'motion-utils'],
}
const PACKAGE_TO_CHUNK = new Map(
  Object.entries(VENDOR_CHUNKS).flatMap(([chunk, pkgs]) => pkgs.map((pkg) => [pkg, chunk])),
)

export function vendorChunkFor(id) {
  const match = id.replace(/\\/g, '/').match(/\/node_modules\/((?:@[^/]+\/)?[^/]+)\//)
  return match ? PACKAGE_TO_CHUNK.get(match[1]) : undefined
}

// https://vite.dev/config/
export default defineConfig({
  // 'warn', not 'error': the old setting hid Vite's oversized-chunk warning,
  // which is how a 798 KB main chunk (Lumi's markdown stack loaded eagerly on
  // the login screen) shipped without anyone seeing it.
  logLevel: 'warn',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    // Vite's default (500 KB). Stated explicitly so nobody "fixes" the
    // warning by raising it: a chunk over this is a code-splitting bug.
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      ...previewInput,
      output: {
        manualChunks: vendorChunkFor,
      },
    },
  },
  plugins: [
    base44({
      // Support for legacy code that imports the base44 SDK with @/integrations, @/entities, etc.
      // can be removed if the code has been updated to use the new SDK imports from @base44/sdk
      legacySDKImports: process.env.BASE44_LEGACY_SDK_IMPORTS === 'true',
      hmrNotifier: true,
      navigationNotifier: true,
      visualEditAgent: true
    }),
    react(),
  ]
});