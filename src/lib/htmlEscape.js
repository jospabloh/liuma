// Escapes user- and entity-controlled text before interpolating it into HTML
// email bodies, to prevent HTML/script injection (OWASP A03 / CWE-79).
// Import-free by design so it can be unit-tested directly under `node --test`
// without going through a bundler.
export function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
