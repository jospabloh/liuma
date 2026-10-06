// The browser half of uploadSchoolFile (v1.9.0): every file the app stores
// goes through the server function, never base44.integrations.Core.UploadFile.
// See base44/functions/uploadSchoolFile/_upload.ts for why and for the rules.
//
// base44.functions.invoke sends a payload holding a File as multipart/form-data
// (SDK functions.js), which is what the function parses.

import { invokeFunction } from '../functionResponse.js';
import { uploadProblem, withTypedName } from './uploadRules.js';

/** An upload the browser already knows the server would refuse. */
export class UploadRejectedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UploadRejectedError';
    // humanizeError shows a function refusal's code; this one carries its own text.
    this.userMessage = message;
  }
}

/**
 * Upload `file` for `purpose` ('school_logo' | 'official_document' |
 * 'setup_document') and return its public URL. Throws UploadRejectedError
 * (with a Spanish `.message`) before any request when the file is certainly
 * wrong, or the function's refusal (code → Spanish via humanizeError).
 */
export async function uploadSchoolFile(base44, { purpose, file: chosen }) {
  // "IMG_2041" with type image/jpeg goes up as "IMG_2041.jpg" (uploadRules.js).
  const file = withTypedName(chosen);
  const problem = uploadProblem(purpose, file);
  if (problem) throw new UploadRejectedError(problem);
  // A write: never retried automatically (functionRetry.js).
  const body = await invokeFunction(base44, 'uploadSchoolFile', { purpose, file });
  const url = typeof body?.file_url === 'string' ? body.file_url : '';
  if (!url) {
    const error = new Error('uploadSchoolFile returned no file_url');
    error.data = { ok: false, code: 'UPLOAD_FAILED' };
    throw error;
  }
  return url;
}
