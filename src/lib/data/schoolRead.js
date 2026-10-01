// The client's tenant read path: every school-scoped read in src/ goes through
// here (see schoolReadCore.js for why, and base44/functions/schoolRead for the
// rules). Drop-in for `base44.entities.X.filter(filter, sort, limit)`:
//
//   schoolRead('Student', { classroom_id: id, is_active: true }, 'first_name')
//   schoolReadMany({ students: ['Student', {...}], rooms: ['Classroom', {...}] })
//   schoolReadContext()  // { role, classroomIds, studentIds, students, classrooms, … }
//
// Platform-owner-only screens (LicenseAdmin, the cross-school support queue)
// keep reading the entities directly: the owner-only RLS is theirs.
import { base44 } from '@/api/base44Client';
//
// v1.8.3: single reads made in the same tick are batched into one request,
// the caller's context is shared for 30 s, and every request is retried with
// backoff on Base44's rate limit (schoolReadCore.js, functionRetry.js).
import { invokeFunction, onFunctionWrite } from '@/lib/functionResponse';
import { makeSchoolReader, SCHOOL_READ_CONTEXT_TTL_MS } from './schoolReadCore';

export { SCHOOL_READ_ALL } from './schoolReadCore';

const reader = makeSchoolReader((payload) => invokeFunction(base44, 'schoolRead', payload), {
  batch: true,
  contextTtlMs: SCHOOL_READ_CONTEXT_TTL_MS,
});

// A write can change who the caller is linked to (a teacher's own salón, a
// parent accepting a link): never answer the next context from before it.
onFunctionWrite(() => reader.reset());

export const schoolRead = reader.read;
export const schoolReadMany = reader.readMany;
export const schoolReadContext = reader.context;
