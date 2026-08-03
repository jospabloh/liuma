/**
 * Support diagnostics — the "smart hook" behind a one-line support request.
 *
 * When a user opens a ticket they should only have to describe the problem; the
 * app bundles the technical context that support would otherwise have to ask
 * for: which screen they were on, the app version, and the browser/viewport.
 * A small ring buffer of recent console warnings/errors is included too, so a
 * reproducible client-side failure arrives already attached to the ticket.
 *
 * Everything here is client-only and best-effort: a capture failure must never
 * block ticket creation, and nothing sensitive (form values, tokens) is read —
 * only the user's own console output and public environment facts.
 */

const MAX_LOG_ENTRIES = 25;
const MAX_LOG_LENGTH = 500;

// In-memory ring buffer of recent console.warn/console.error calls. Installed
// once at app boot via installConsoleCapture(); survives route changes because
// it lives at module scope (the SPA never reloads between pages).
const logBuffer = [];
let installed = false;

function pushLog(level, args) {
  try {
    const message = args
      .map((arg) => {
        if (typeof arg === 'string') return arg;
        if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(' ')
      .slice(0, MAX_LOG_LENGTH);
    logBuffer.push({ level, message, at: new Date().toISOString() });
    if (logBuffer.length > MAX_LOG_ENTRIES) logBuffer.shift();
  } catch {
    // Never let diagnostics capture interfere with the original log call.
  }
}

/**
 * Patch console.warn/console.error once so their output is retained for the
 * next support ticket. The original behaviour is preserved (we still forward to
 * the native console). Safe to call multiple times — only the first installs.
 */
export function installConsoleCapture() {
  if (installed || typeof console === 'undefined') return;
  installed = true;
  for (const level of ['warn', 'error']) {
    const original = console[level];
    if (typeof original !== 'function') continue;
    console[level] = (...args) => {
      pushLog(level, args);
      original.apply(console, args);
    };
  }
}

/** The captured console entries (most recent last). Exposed for display/tests. */
export function getRecentLogs() {
  return [...logBuffer];
}

/**
 * Snapshot the safe client context to attach to a support ticket.
 *
 * @param {object} [opts]
 * @param {string} [opts.route]     Current route/URL (defaults to window.location).
 * @param {string} [opts.pageName]  Logical page name, if the caller knows it.
 * @param {string} [opts.appVersion] App version (defaults to the build-time env).
 */
export function captureClientContext({ route, pageName, appVersion } = {}) {
  const ctx = {
    capturedAt: new Date().toISOString(),
    route: route || null,
    pageName: pageName || null,
    // eslint-disable-next-line no-undef
    appVersion: appVersion || (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null),
    recentLogs: getRecentLogs(),
  };

  try {
    if (typeof window !== 'undefined') {
      const loc = window.location || {};
      if (!ctx.route) ctx.route = `${loc.pathname || ''}${loc.search || ''}`;
      if (!ctx.pageName) ctx.pageName = decodeURIComponent((loc.pathname || '/').replace(/^\//, '')) || 'Home';
      if (window.navigator) {
        ctx.userAgent = window.navigator.userAgent;
        ctx.language = window.navigator.language;
      }
      ctx.viewport = { width: window.innerWidth, height: window.innerHeight };
    }
  } catch {
    // Best-effort: return whatever we managed to collect.
  }

  return ctx;
}

/** Compact, human-readable summary of a captured context (for the staff UI). */
export function formatClientContext(ctx) {
  if (!ctx) return '';
  const lines = [];
  if (ctx.pageName) lines.push(`Pantalla: ${ctx.pageName}`);
  if (ctx.route) lines.push(`Ruta: ${ctx.route}`);
  if (ctx.appVersion) lines.push(`Versión: ${ctx.appVersion}`);
  if (ctx.viewport) lines.push(`Pantalla: ${ctx.viewport.width}×${ctx.viewport.height}`);
  if (ctx.language) lines.push(`Idioma: ${ctx.language}`);
  if (ctx.userAgent) lines.push(`Navegador: ${ctx.userAgent}`);
  if (ctx.recentLogs?.length) {
    lines.push(`Eventos recientes (${ctx.recentLogs.length}):`);
    for (const log of ctx.recentLogs) {
      lines.push(`  [${log.level}] ${log.message}`);
    }
  }
  return lines.join('\n');
}