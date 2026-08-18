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

    const sr = base44.asServiceRole;

    // Same authority derivation as governRoleChange: the caller's own ACTIVE
    // ADMIN profile determines the school, never a client-supplied id.
    const callerProfiles = await sr.entities.UserProfile.filter({ user_id: user.id });
    const callerProfile = (callerProfiles || []).find((p: any) => p.app_role === 'ADMIN' && p.status === 'ACTIVE') || null;
    if (!callerProfile) return bad(403, 'NOT_ADMIN', 'Requires an active ADMIN profile');
    const schoolId = callerProfile.school_id;
    if (!schoolId) return bad(400, 'NO_SCHOOL', 'Admin profile has no school_id');

    const school = await sr.entities.School.get(schoolId).catch(() => null);

    const data: Record<string, unknown> = {};
    const errors: Record<string, string> = {};

    await Promise.all(EXPORTED_ENTITIES.map(async (entityName) => {
      try {
        const entity = (sr.entities as Record<string, any>)[entityName];
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
