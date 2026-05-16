# Perf baseline: batched data loaders

Scope: `Avisos`, `MisHijos`, `Tarea`, `TareaMaestro`, `AvisosMaestro`.

Approximate query-count changes per page render (for list loading paths):

- `Avisos`
  - Before: `1 (ParentStudent) + N (Student by id) + 1 (Notice)`
  - After: `1 (ParentStudent) + 1 (Student by ids) + 1 (Notice)`
- `MisHijos`
  - Before: `1 (linkedStudents utility) + N (Classroom by id)`
  - After: `1 (linkedStudents utility) + 1 (Classroom by ids)`
- `Tarea`
  - Before: `1 (linkedStudents utility) + N (Homework by classroom)`
  - After: `1 (linkedStudents utility) + 1 (Homework by classroom ids)`
- `TareaMaestro`
  - Before: `1 (TeacherClassroom) + N (Classroom by id) + N (Homework by classroom)`
  - After: `1 (TeacherClassroom) + 1 (Classroom by ids) + 1 (Homework by classroom ids)`
- `AvisosMaestro`
  - Before: `1 (TeacherClassroom) + N (Classroom by id) + 1 (Notice)`
  - After: `1 (TeacherClassroom) + 1 (Classroom by ids) + 1 (Notice)`

Notes:
- `N` is number of linked classrooms/students.
- Query keys for batched fetches now normalize ids (`filter(Boolean)`, `Set`, `sort`) to prevent duplicate fetches when id order changes.
