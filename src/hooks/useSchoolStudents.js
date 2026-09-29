import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  schoolStudentsFilter,
  schoolStudentsQueryKey,
  SCHOOL_STUDENTS_QUERY_ROOT,
} from '@/lib/schoolStudents';

// Students of one school. `activeOnly` (default true) is part of the query key,
// so an "active only" list and an "all students" list never share a cache
// entry — see src/lib/schoolStudents.js for the flicker this prevents.
export function useSchoolStudents(schoolId, { activeOnly = true, enabled = true } = {}) {
  return useQuery({
    queryKey: schoolStudentsQueryKey(schoolId, { activeOnly }),
    queryFn: () => base44.entities.Student.filter(schoolStudentsFilter(schoolId, { activeOnly })),
    enabled: !!schoolId && enabled,
  });
}

// Invalidate every variant (active and all) after a student write.
export function invalidateSchoolStudents(queryClient) {
  return queryClient.invalidateQueries({ queryKey: [SCHOOL_STUDENTS_QUERY_ROOT] });
}
