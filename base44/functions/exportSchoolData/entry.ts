// exportSchoolData — self-service data export for the "Cuenta y zona de
// peligro" module of the portfolio standard (jospabloh/acacia-app-standard,
// module 7). PermisosRoles.jsx's "Danger Zone" table describes irreversible
// tenant operations (delete/suspend/reset/transfer) but has no working
// action behind it -- that's a deliberately separate, much larger
// maker-checker initiative, tracked in CLAUDE.md, not attempted here. This
// function closes the actual module-7 gap: any ADMIN of a school can
// download everything the school owns before requesting anything drastic.
//
// Runs with the caller's own token to establish identity (never trusts a
// client-supplied school_id), then re-reads via asServiceRole scoped
// strictly to that one school_id for every entity -- same shape as every
// other exportXData function in this portfolio (radar's exportCompanyData,
// rumbo's exportTenantData, puntos's exportMyData, flowfin's
// exportFamilyData). A failure on any single entity doesn't fail the whole
// export.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.35';

const EXPORTED_ENTITIES = [
  'Student', 'Classroom', 'TeacherClassroom', 'ParentStudent', 'ParentProfile',
  'Attendance', 'Homework', 'DiaryEntry', 'Notice', 'NoticeDelivery',
  'AbsenceNotification', 'EmergencyContact', 'Event', 'EventResponse',
  'PaymentConcept', 'ChargeItem', 'PaymentRecord', 'Discount',
  'UniformOrder', 'OfficialDocument', 'WeeklyMenu', 'SchoolSetupGuide',
  'SupportTicket', 'UserProfile',
];

function bad(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, code, error: message }, { status });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me().catch(() => null);
    if (!user) return bad(401, 'UNAUTHENTICATED', 'Unauthorized');
    // A deletion of this account started or finished (deleteMyAccount): no
    // access here, whatever consent stamp a race may have left behind.
    // auth.me() returns the User's custom fields, so this costs no read.
    if (accountDeletionBlocked(user)) return Response.json({ ok: false, code: 'ACCOUNT_DELETION_IN_PROGRESS', error: 'ACCOUNT_DELETION_IN_PROGRESS' }, { status: 403 });

    const sr = base44.asServiceRole;

    // Same authority derivation as governRoleChange: the caller's own ACTIVE
    // ADMIN profile determines the school, never a client-supplied id.
    //
    // Módulo 18: sorted by -created_date before picking, mirroring
    // src/lib/tenantSelection.js's selectCurrentUserProfile — an admin of
    // more than one school (a real possibility now that Home.jsx lets a
    // user join a second school without leaving the first) used to get
    // Base44 filter()'s unspecified order here, which could silently
    // export the wrong school's data (module 14 finding, 2026-08-23).
    const callerProfiles = (await sr.entities.UserProfile.filter({ user_id: user.id }, '-created_date')) || [];
    const callerProfile = callerProfiles.find((p: { app_role?: string; status?: string; school_id?: string }) => p.app_role === 'ADMIN' && p.status === 'ACTIVE') || null;
    if (!callerProfile) return bad(403, 'NOT_ADMIN', 'Requires an active ADMIN profile');
    const schoolId = callerProfile.school_id;
    if (!schoolId) return bad(400, 'NO_SCHOOL', 'Admin profile has no school_id');

    const school = await sr.entities.School.get(schoolId).catch(() => null);

    const data: Record<string, unknown> = {};
    const errors: Record<string, string> = {};

    await Promise.all(EXPORTED_ENTITIES.map(async (entityName) => {
      try {
        const entity = (sr.entities as unknown as Record<string, { filter(q: Record<string, unknown>): Promise<unknown> }>)[entityName];
        data[entityName] = await entity.filter({ school_id: schoolId });
      } catch (e) {
        errors[entityName] = (e as Error).message;
      }
    }));

    return Response.json({
      ok: true,
      exported_at: new Date().toISOString(),
      school,
      data,
      errors: Object.keys(errors).length ? errors : undefined,
    });
  } catch (e) {
    return Response.json({ ok: false, code: 'INTERNAL', error: (e as Error).message }, { status: 500 });
  }
});

// MIRRORS myConsent/_consent.ts#accountDeletionStartedAt/accountDeletedAt.
// Identical in every consent-gated function; tests/unit/account-deletion.test.js
// checks the copies and where each one is called.
function accountDeletionBlocked(user: unknown): boolean {
  const u = (user ?? {}) as {
    account_deletion_started_at?: unknown;
    account_deleted_at?: unknown;
    data?: { account_deletion_started_at?: unknown; account_deleted_at?: unknown } | null;
  };
  const started = u.account_deletion_started_at ?? u.data?.account_deletion_started_at;
  const deleted = u.account_deleted_at ?? u.data?.account_deleted_at;
  return (typeof started === 'string' && started !== '') || (typeof deleted === 'string' && deleted !== '');
}
