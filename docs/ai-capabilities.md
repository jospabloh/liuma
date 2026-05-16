# Lumi AI Capabilities Intent Catalog

This catalog defines capability-level contracts for Lumi so frontend and agent orchestration use predictable intent payloads and policy-aware responses.

## Response envelope

All capabilities should return this envelope:

```json
{
  "status": "ok | denied | needs_input",
  "intent": "homework_lookup",
  "message": "human-friendly response",
  "data": {},
  "meta": {
    "capability": "homework_lookup",
    "requested_at": "ISO-8601",
    "sources": ["Homework"],
    "missing_inputs": []
  },
  "denial": {
    "reason_code": "policy_forbidden",
    "reason": "Role PARENT cannot access requested entity"
  }
}
```

- `denial` is required when `status = denied`.
- `missing_inputs` is required when `status = needs_input`.

---

## 1) homework_lookup

- **Required inputs**
  - `student_id` (required for parent flows)
  - `date_range` (defaults to today/this week if omitted)
  - `classroom_id` (required for teacher-wide class lookup)
- **Permission checks**
  - `canReadEntity(role, "Homework")`
  - Parent must be linked to `student_id`.
- **Data sources/entities**
  - `Homework`
  - optional `Student` for display context
- **Response schema (`data`)**

```json
{
  "items": [
    {
      "id": "string",
      "title": "string",
      "due_date": "YYYY-MM-DD",
      "subject": "string",
      "status": "pending | submitted | overdue"
    }
  ]
}
```

## 2) attendance_status

- **Required inputs**
  - `student_id`
  - `date_range` (or single `date`)
- **Permission checks**
  - `canReadEntity(role, "Attendance")`
  - Parent can only request linked students.
- **Data sources/entities**
  - `Attendance`
- **Response schema (`data`)**

```json
{
  "summary": {
    "present": 0,
    "absent": 0,
    "late": 0
  },
  "records": [
    {
      "date": "YYYY-MM-DD",
      "status": "present | absent | late",
      "notes": "string"
    }
  ]
}
```

## 3) notices_summary

- **Required inputs**
  - `scope` (`school | classroom | student`)
  - optional `date_range`
- **Permission checks**
  - `canReadEntity(role, "Notice")`
  - Scope must match school/classroom/student linkage.
- **Data sources/entities**
  - `Notice`
- **Response schema (`data`)**

```json
{
  "count": 0,
  "items": [
    {
      "id": "string",
      "title": "string",
      "summary": "string",
      "priority": "low | medium | high",
      "published_at": "ISO-8601"
    }
  ]
}
```

## 4) payment_reminders

- **Required inputs**
  - `student_id`
  - optional `due_before`
- **Permission checks**
  - `canReadEntity(role, "ChargeItem")`
  - Parent must be linked to `student_id`.
- **Data sources/entities**
  - `ChargeItem`
  - optional `PaymentRecord` for paid/unpaid state
- **Response schema (`data`)**

```json
{
  "currency": "MXN",
  "total_due": 0,
  "items": [
    {
      "id": "string",
      "concept": "string",
      "amount": 0,
      "due_date": "YYYY-MM-DD",
      "status": "due | overdue | paid"
    }
  ]
}
```

## 5) behavior_recap

- **Required inputs**
  - `student_id`
  - optional `date_range`
- **Permission checks**
  - `canReadEntity(role, "DiaryEntry")`
  - Parent can only request linked students.
- **Data sources/entities**
  - `DiaryEntry`
- **Response schema (`data`)**

```json
{
  "summary": "string",
  "highlights": [
    {
      "date": "YYYY-MM-DD",
      "type": "positive | neutral | incident",
      "detail": "string"
    }
  ]
}
```

## 6) schedule_appointments

- **Required inputs**
  - at least one of `student_id` or `classroom_id`
  - optional `date_range`
- **Permission checks**
  - `canReadEntity(role, "Notice")` for schedule notices/events fallback
  - Parent may only access linked students.
- **Data sources/entities**
  - `Notice` (event-type notices)
  - optional appointment/event entity when available
- **Response schema (`data`)**

```json
{
  "items": [
    {
      "id": "string",
      "title": "string",
      "start_at": "ISO-8601",
      "end_at": "ISO-8601",
      "location": "string",
      "type": "appointment | event"
    }
  ]
}
```
