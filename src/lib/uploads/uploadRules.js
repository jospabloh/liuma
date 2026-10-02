// What each upload purpose accepts — the browser's early warning (v1.9.0).
//
// MIRRORS base44/functions/uploadSchoolFile/_upload.ts (PURPOSES, EXTENSIONS),
// which is the rule that counts: the server checks the extension AND the
// file's magic bytes, and stores it under a clean name with the MIME type of
// what the bytes are. This copy only spares the director an upload that the
// server would refuse anyway. tests/unit/upload-school-file.test.js fails if
// the two tables differ.
//
// Import-free so node --test loads it.

const MB = 1024 * 1024;

export const UPLOAD_PURPOSES = {
  school_logo: { types: ['png', 'jpeg', 'webp', 'gif'], maxBytes: 5 * MB },
  official_document: { types: ['pdf'], maxBytes: 10 * MB },
  setup_document: { types: ['pdf', 'doc', 'docx', 'jpeg', 'png'], maxBytes: 10 * MB },
};

export const UPLOAD_EXTENSIONS = {
  pdf: 'pdf', png: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif', webp: 'webp', doc: 'doc', docx: 'docx',
};

const TYPE_LABELS = {
  pdf: 'PDF', png: 'PNG', jpeg: 'JPG', gif: 'GIF', webp: 'WEBP', doc: 'Word (.doc)', docx: 'Word (.docx)',
};

/** "PDF, Word (.doc), Word (.docx), JPG o PNG" — for hints and errors. */
export function allowedTypesLabel(purpose) {
  const types = UPLOAD_PURPOSES[purpose]?.types || [];
  const labels = types.map((t) => TYPE_LABELS[t]);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} o ${labels[labels.length - 1]}`;
}

/** Megabytes allowed for a purpose (for the copy). */
export function maxMegabytes(purpose) {
  return Math.round((UPLOAD_PURPOSES[purpose]?.maxBytes || 0) / MB);
}

/**
 * A Spanish sentence if this file will certainly be refused for this purpose
 * (wrong extension, empty, too big), or null. The server still decides.
 */
export function uploadProblem(purpose, file) {
  const rule = UPLOAD_PURPOSES[purpose];
  if (!rule) return 'No se reconoce el tipo de archivo que intentas subir.';
  if (!file || !(file.size > 0)) return 'El archivo está vacío. Elige otro.';
  const match = /\.([A-Za-z0-9]+)$/.exec(String(file.name || '').trim());
  const type = match ? UPLOAD_EXTENSIONS[match[1].toLowerCase()] : null;
  if (!type || !rule.types.includes(type)) return `El archivo debe ser ${allowedTypesLabel(purpose)}.`;
  if (file.size > rule.maxBytes) return `El archivo pesa más de ${maxMegabytes(purpose)} MB. Elige uno más ligero.`;
  return null;
}
