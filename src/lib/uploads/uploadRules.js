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

// What a browser-reported MIME type names, for a file whose NAME carries no
// extension (a phone gallery or a cloud picker can hand over "IMG_2041" or
// "documento"). The server goes by the extension and the bytes, so such a
// file would be refused as "must be PDF" even when it is one.
const MIME_EXTENSIONS = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

function nameExtensionType(name) {
  const match = /\.([A-Za-z0-9]+)$/.exec(String(name || '').trim());
  return match ? UPLOAD_EXTENSIONS[match[1].toLowerCase()] ?? null : null;
}

/**
 * typedFileName: the name to upload under. withTypedName: the same file,
 * renamed that way, with an extension appended when its name has none we know
 * and the browser says what it is. Anything else comes back untouched: the
 * server still checks the bytes, so a wrong MIME type gains nothing.
 */
export function typedFileName(file) {
  const name = String(file?.name || '');
  if (nameExtensionType(name)) return name;
  const extension = MIME_EXTENSIONS[String(file?.type || '').toLowerCase()];
  return extension ? `${name.trim() || 'archivo'}.${extension}` : name;
}

export function withTypedName(file) {
  if (!file) return file;
  const name = typedFileName(file);
  if (name === file.name || typeof File === 'undefined' || !(file instanceof Blob)) return file;
  return new File([file], name, { type: file.type, lastModified: file.lastModified });
}

/**
 * A Spanish sentence if this file will certainly be refused for this purpose
 * (wrong extension, empty, too big), or null. The server still decides.
 */
export function uploadProblem(purpose, file) {
  const rule = UPLOAD_PURPOSES[purpose];
  if (!rule) return 'No se reconoce el tipo de archivo que intentas subir.';
  if (!file || !(file.size > 0)) return 'El archivo está vacío. Elige otro.';
  const type = nameExtensionType(typedFileName(file));
  if (!type || !rule.types.includes(type)) return `El archivo debe ser ${allowedTypesLabel(purpose)}.`;
  if (file.size > rule.maxBytes) return `El archivo pesa más de ${maxMegabytes(purpose)} MB. Elige uno más ligero.`;
  return null;
}
