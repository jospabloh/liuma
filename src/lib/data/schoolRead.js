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
import { invokeFunction } from '@/lib/functionResponse';
import { makeSchoolReader } from './schoolReadCore';

const reader = makeSchoolReader((payload) => invokeFunction(base44, 'schoolRead', payload));

export const schoolRead = reader.read;
export const schoolReadMany = reader.readMany;
export const schoolReadContext = reader.context;
