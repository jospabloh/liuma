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
      rollupOptions: {
        input: {
          main: new URL('./index.html', import.meta.url).pathname,
          preview: new URL('./preview.html', import.meta.url).pathname,
        },
      },
    }
  : {}

// https://vite.dev/config/
export default defineConfig({
  logLevel: 'error', // Suppress warnings, only show errors
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: previewInput,
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