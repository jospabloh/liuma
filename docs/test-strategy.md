# Test Strategy

## Success Criteria
- Access control failures block release.
- Role isolation is enforced across schools, classrooms, and students.
- Critical pages (`Home`, `Asistencia`, `Avisos`, `Pagos`, `Bitacora`) are covered by integration tests using mixed-role fixtures.

## Top-Priority Scenarios

1. **Role isolation (parent cannot see unrelated student data)**
   - Parent can only read rows linked to `student_id` or allowed classroom scope.
   - Parent cannot read another family student in the same school.

2. **Teacher classroom boundaries**
   - Teacher can only read/write classroom-linked records for assigned classrooms.
   - Teacher cannot access records from unassigned classrooms in the same school.

3. **Admin full-scope behavior**
   - Admin can read/write every policy entity inside the school scope.
   - Admin row-level filtering returns all rows.

4. **AI deny/allow correctness**
   - AI actions that map to entity read/write checks respect `canReadEntity` / `canWriteEntity`.
   - Unknown entities are denied by default.

## Unit Test Plan
- Add unit tests for policy helpers:
  - `canReadEntity`
  - `canWriteEntity`
  - `buildScopedFilter`
  - `filterByRowLevel`
- Include explicit deny-by-default tests for unknown role/entity combinations.

## Integration Test Plan (Key Pages)
- `Home`: role-aware data summaries respect scope.
- `Asistencia`: attendance rows are filtered per role.
- `Avisos`: notices visibility follows row-level rules.
- `Pagos`: parent/admin payment data visibility is correct.
- `Bitacora`: diary entries respect classroom/student scope.

## Fixture Plan
- Use deterministic fixtures with:
  - **Multi-school** data (`school-a`, `school-b`).
  - **Mixed-role** identities (admin, teacher with classroom subset, parent with student subset).
  - Rows intentionally outside each actor scope to verify deny paths.

## Release Gate
- Release command must run permission test suite first.
- If permission tests fail, deployment must not proceed.
