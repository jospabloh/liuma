# LIUMA User Manual

**Version 1.0.6 · Updated 2026-06-08**

LIUMA is a school management platform connecting school administrators, teachers, and parents/guardians. This manual explains what each role can do, how permissions work, and how privacy is protected.

---

## Table of Contents

1. [Roles and Access](#1-roles-and-access)
2. [Administrator (Directivo)](#2-administrator-directivo)
3. [Teacher (Maestro)](#3-teacher-maestro)
4. [Parent / Guardian (Padre/Madre)](#4-parent--guardian-padremadre)
5. [Permission Model](#5-permission-model)
6. [School and Tenant Privacy](#6-school-and-tenant-privacy)
7. [Student Data Privacy](#7-student-data-privacy)
8. [Lumi AI Assistant](#8-lumi-ai-assistant)
9. [Notifications](#9-notifications)
10. [Modules Reference](#10-modules-reference)
11. [Account and Onboarding](#11-account-and-onboarding)
12. [Subscription and Trial](#12-subscription-and-trial)

---

## 1. Roles and Access

LIUMA has three user roles. Each user belongs to exactly one role within their school.

| Role | Spanish label | Description |
|---|---|---|
| **Admin** | Directivo | School administrator. Full access to all modules within the school. |
| **Teacher** | Maestro/a | Classroom teacher. Access to their assigned classrooms and students. |
| **Parent** | Padre/Madre | Parent or guardian. Access to their linked children's data only. |

Your role is assigned when you register or when an administrator approves your account.

---

## 2. Administrator (Directivo)

Administrators have full access to their own school's data and management tools.

### What admins can do

- **School management** – Update school name, logo, and color theme.
- **User management** – Approve or reject new user registrations. View all active users.
- **Permissions** – Grant or restrict access to specific modules for individual users via the Permissions & Roles page.
- **Classrooms** – Create and manage classrooms. Assign teachers to classrooms.
- **Students** – Create, edit, and manage student records. Link parents/guardians to students.
- **Notices / Circulars** – Publish notices scoped to the whole school, a specific classroom, or an individual student.
- **Daily Diary** – View diary entries for any student in the school.
- **Homework** – Create and manage homework assignments for any classroom.
- **Attendance** – View and manage attendance for any classroom. See attendance summaries.
- **Absences** – Review and manage absence requests from parents and approve or reject them.
- **School Calendar** – Add and manage school-wide calendar events.
- **Events** – Manage events visible to parents.
- **Payments** – Manage payment concepts and charge items per student. View payment records.
- **Discounts** – Create and manage discount records for students.
- **Uniform Orders** – Manage uniform order requests from parents.
- **Documents** – Upload and manage school documents.
- **Emergency Alerts** – Send urgent school-wide alerts to all users.
- **Reports** – View consolidated school reports.
- **Approvals** – Approve or reject pending user registrations.
- **Audit Log** – View the school's audit trail of permission changes, access events, and admin overrides.
- **Lumi AI** – Use the Lumi AI assistant for attendance summaries, payment follow-ups, behavior recaps, homework lookups, and school notices.

### What admins cannot do

- Access data from another school — tenant isolation is strictly enforced.
- Make dangerous tenant-level changes (delete school, reset data, transfer ownership) without a second admin approving and providing a reason.
- Grant themselves permissions they have removed from their own profile without another admin restoring them.

---

## 3. Teacher (Maestro)

Teachers can access modules related to their assigned classrooms.

### What teachers can do

- **My Classrooms** – View students in their assigned classrooms.
- **Student Detail** – View profile and records for students in their classrooms.
- **Daily Diary** – Create and view diary entries for students in their classrooms.
- **Homework** – Create, edit, and view homework for their classrooms.
- **Notices** – Publish notices for their classrooms or specific students.
- **Attendance** – Record and view attendance for their classrooms. View attendance summaries.
- **Absence Management** – View absence requests for their students. Approve or reject absences.
- **School Calendar** – View the school calendar.
- **Lumi AI** – Use Lumi for attendance summaries, behavior recaps, homework lookups, and school notices within their classrooms.

### What teachers cannot do

- Access students or classrooms not assigned to them.
- View or manage payment records.
- Access administrative settings, approvals, or the audit log (unless the admin grants specific access).
- Access another school's data.

---

## 4. Parent / Guardian (Padre/Madre)

Parents can see information related to their linked children only.

### What parents can do

- **My Children** – View profiles and details for their linked students.
- **Attendance** – View attendance records for their children.
- **Homework** – View homework assigned to their children's classrooms.
- **Daily Diary** – View diary entries for their children.
- **Notices** – View school-wide, classroom, and student-specific notices for their children.
- **Payments** – View charge items and payment records for their children.
- **Uniform Orders** – Submit uniform orders for their children.
- **Request Absence** – Submit absence requests for their children.
- **Emergency Contacts** – View and manage their emergency contact information.
- **Events** – View school events for parents.
- **School Calendar** – View the school calendar.
- **Lumi AI** – Use Lumi for homework lookups, attendance status, payment reminders, behavior recaps, and school notices — scoped to their linked children.

### What parents cannot do

- Access data for any child other than their own linked children.
- Create or edit student records, classrooms, or school settings.
- View data from another school.
- Access another parent's records.

---

## 5. Permission Model

### How permissions work

- Every action in LIUMA is governed by a permission check.
- Permissions are enforced both in the user interface (UI) and in the data access layer.
- Hiding a button in the UI is not sufficient — LIUMA's policy engine enforces access at the data level as well.

### Admin defaults

- Admins have all permissions enabled by default within their own school.
- Admins cannot access other schools' data even with full permissions.

### Non-admin defaults

- Teachers and Parents receive a safe set of defaults based on their role.
- By default, users cannot access features outside their role's defined scope.
- Admins can grant additional specific permissions to individual users via the Permissions & Roles page.

### Granular permission overrides

Admins can navigate to **Permissions & Roles** to:
- View the effective permissions for any user in the school.
- Grant (allow) or restrict (deny) access to specific resources and actions for individual users.
- Apply permission templates (Admin Template, Member Default Template) to a user.

Available resources that can be configured:
- Students, Classrooms, Attendance, Homework, Diary, Notices, Payments, Documents, Reports, AI, Audit, Tenant Danger Zone, Calendar, Events, Uniforms, Discounts, Emergency Alerts, Absences.

Available actions that can be configured:
- View, Add, Edit, Delete, Approve, Export, Manage Permissions.

### Safety rules for permissions

- An admin cannot remove their own `manage_permissions` access if they are the only active admin in the school.
- Dangerous tenant-level operations (delete school, reset all data, transfer ownership) always require a second admin to co-approve — this cannot be bypassed.

---

## 6. School and Tenant Privacy

- Each school operates in a completely isolated environment.
- No data from one school is visible to users of another school.
- This isolation applies to all data: users, students, parents, teachers, records, files, notices, payments, diary entries, and AI responses.
- Admin access does not bypass school isolation — an admin of School A cannot see School B's data.

---

## 7. Student Data Privacy

- Students are linked to specific parents/guardians in the system.
- A parent can only see data for their own linked children.
- A teacher can only see students in their assigned classrooms.
- An admin can see all students within their school.
- Student names, records, diary entries, attendance, and payments are never visible across different schools.
- Uploaded files and images associated with student records are access-controlled.
- Incident and diary notes are scoped to the student and their authorized users (linked parent, assigned teacher, admin).

---

## 8. Lumi AI Assistant

Lumi is LIUMA's built-in AI assistant. It helps users get quick answers about school-related topics.

### What Lumi can help with

| Capability | Roles |
|---|---|
| Homework lookup | Admin, Teacher, Parent |
| Attendance status | Admin, Teacher, Parent |
| Notices summary | Admin, Teacher, Parent |
| Payment reminders | Admin, Parent |
| Behavior recap (diary) | Admin, Teacher, Parent |
| Schedule / appointment info | Admin, Teacher, Parent |

### Privacy and safety in Lumi

- Lumi only retrieves data the current user is authorized to see.
- A parent using Lumi only receives information about their linked children.
- A teacher using Lumi only receives information about their assigned classrooms.
- Lumi cannot access data from another school.
- Lumi does not share one student's data with an unrelated parent.
- All Lumi interactions (allowed and denied requests) are logged in the audit trail.
- Lumi does not send notifications or make administrative changes on behalf of the user — it provides information only.

### What Lumi cannot do

- Access data the current user is not authorized to view.
- Retrieve information from another school.
- Send emails or push notifications without explicit user action.
- Make changes to student records, settings, or permissions.

---

## 9. Notifications

LIUMA sends notifications for school events such as:
- New user pending approval.
- Payment reminders.
- Emergency alerts.

### Notification channels

- **In-app** – Notifications appear inside the app as notices.
- **Email** – Notifications are sent to the user's registered email.

### Notification preferences

- School administrators can configure which notification channels are enabled school-wide and per role.
- Individual users can update their own notification preferences.
- If a channel is disabled at the school level, it takes precedence over individual user preferences.

---

## 10. Modules Reference

### Admin-only modules

| Module | Description |
|---|---|
| Approvals | Review and approve or reject pending user registrations. |
| Audit Log | View the school's complete audit trail. |
| Emergency Alerts | Send urgent school-wide alerts. |
| School Notices Management | Publish and manage all school notices. |
| School Configuration | Update school settings, theme, and logo. |
| Initial Setup | First-time school setup wizard. |
| Discount Management | Manage per-student discounts. |
| Document Management | Upload and manage school documents. |
| Uniform Order Management | Fulfill parent uniform orders. |
| Admin Payments | Manage payment concepts and charge records. |
| Permissions & Roles | Configure per-user access permissions. |
| Reports | View school-wide reports. |

### Teacher-only modules

| Module | Description |
|---|---|
| My Classrooms | View and manage assigned classrooms. |
| Student Detail | View student profiles in assigned classrooms. |
| Create Diary Entry | Write daily diary entries for students. |
| All Diary Entries | View all diary entries for their classrooms. |
| Homework Management | Manage homework for their classrooms. |
| Teacher Notices | Publish notices for their classrooms. |
| Absence Management | Review absence requests for their students. |
| Attendance Summary | View attendance summaries for their classrooms. |

### Teacher + Parent modules

| Module | Roles | Description |
|---|---|---|
| Attendance | Teacher, Parent | Teachers record daily attendance for their assigned classrooms. Parents view their children's attendance records. |

### Parent-only modules

| Module | Description |
|---|---|
| My Children | View linked student profiles. |
| Notices | View notices for their children. |
| Events | View school events. |
| Homework | View their children's homework. |
| Daily Diary | View diary entries for their children. |
| Payments | View payment charges for their children. |

### Shared modules

| Module | Roles |
|---|---|
| Home / Dashboard | Admin, Teacher, Parent |
| Daily Operations | Admin, Teacher, Parent |
| School Calendar | Admin, Teacher, Parent |
| Uniform Orders | Admin, Parent |
| Request Absence | Admin, Parent |
| Emergency Contacts | Admin, Parent |
| Lumi AI | Admin, Teacher, Parent |

---

## 11. Account and Onboarding

### Creating a new school (Admin)

1. Sign in with your account.
2. Select **Soy Directivo** (I am an Administrator).
3. Enter your school's name and configure the school theme.
4. Your account is activated immediately as the school administrator.

### Joining an existing school (Teacher or Parent)

1. Sign in with your account.
2. Select your role (Maestro/a or Padre/Madre).
3. Enter the school code provided by your school administrator.
4. Your registration is submitted as **pending approval**.
5. The school administrator receives a notification and can approve or reject your registration.
6. You can access the school once your registration is approved.

### Account approval

- Teachers and parents must be approved by a school administrator before accessing school data.
- Admins are notified in-app and by email when a new user is pending approval.
- Approved users can log in and access their role's features immediately.
- Rejected users are not granted access to the school.

---

## 12. Subscription and Trial

- New schools receive a **30-day free trial** when created.
- During the trial, all features are available.
- A payment reminder banner appears as the trial approaches its end date.
- If the subscription lapses, a suspended account modal is shown and access is restricted until the subscription is renewed.
- Subscription management is handled by the school administrator.

---

*For questions or support, contact your school administrator or the LIUMA support team.*
