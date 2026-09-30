import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { schoolRead } from '@/lib/data/schoolRead';
import { motion } from 'framer-motion';
import { UserCheck, School, Bell, CreditCard, BarChart3, AlertTriangle, Users, Calendar, FileText, ShoppingBag, Percent, ClipboardCheck, Settings, ListChecks, ShieldCheck, KeyRound, Headset, BadgeCheck, Inbox } from 'lucide-react';
import BigTile from '@/components/ui/BigTile';
import { HomeHeader } from '@/components/home/HomeChrome';
import PaymentReminderBanner from '@/components/subscription/PaymentReminderBanner';
import JoinCodeCard from '@/components/school/JoinCodeCard';
import { format } from 'date-fns';
import { schoolTodayDate } from '@/lib/dates';
import { es } from 'date-fns/locale';
import { Button } from "@/components/ui/button";
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { useSchoolStudents } from '@/hooks/useSchoolStudents';
import { selectOverdueCharges, UNPAID_CHARGE_STATUSES } from '@/lib/payments/overdue';
import { countLabel } from '@/lib/spanishText';
import { percentOfStudentsCovered } from '@/lib/schoolStudents';
import { useSubscription } from '@/hooks/useSubscription';

export default function AdminHome({ user, userProfile, subscription }) {
  const navigate = useNavigate();

  // Get pending approvals
  const pendingUsersQuery = useQuery({
    queryKey: ['pendingUsers', userProfile.school_id],
    queryFn: () => schoolRead('UserProfile', { 
      school_id: userProfile.school_id,
      status: 'PENDING' 
    }),
  });
  const allProfilesQuery = useQuery({
    queryKey: ['allProfiles', userProfile.school_id],
    queryFn: () => schoolRead('UserProfile', { school_id: userProfile.school_id }),
  });

  // School header (name) comes from getMySubscription: School.read is
  // platform-only under RLS, so a direct School.filter returned nothing for a
  // real director and the header fell back to 'Administración'.
  const { school } = useSubscription();

  // Get classrooms count
  const classroomsQuery = useQuery({
    queryKey: ['allClassrooms', userProfile.school_id],
    queryFn: () => schoolRead('Classroom', { 
      school_id: userProfile.school_id,
      is_active: true 
    }),
  });

  // Active students. The key carries the filter (see useSchoolStudents), so
  // this list never shares a cache slot with an "all students" list.
  const studentsQuery = useSchoolStudents(userProfile.school_id);

  // Overdue payments: the same rule PagosAdmin uses (stored OVERDUE, or still
  // PENDING past its due date), so both screens show the same number.
  const overdueChargesQuery = useQuery({
    queryKey: ['overdueCharges', userProfile.school_id],
    queryFn: async () => {
      const charges = await schoolRead('ChargeItem', {
        school_id: userProfile.school_id,
        status: { $in: UNPAID_CHARGE_STATUSES },
      });
      return selectOverdueCharges(charges);
    },
  });
  const setupStepsQuery = useQuery({
    queryKey: ['homeSetupGuide', userProfile.school_id],
    queryFn: () => schoolRead('SchoolSetupGuide', { school_id: userProfile.school_id }),
  });
  const teacherAssignmentsQuery = useQuery({
    queryKey: ['homeTeacherAssignments', userProfile.school_id],
    queryFn: () => schoolRead('TeacherClassroom', { school_id: userProfile.school_id, is_active: true }),
  });
  const parentLinksQuery = useQuery({
    queryKey: ['homeParentLinks', userProfile.school_id],
    queryFn: () => schoolRead('ParentStudent', { school_id: userProfile.school_id, status: 'ACTIVE' }),
  });
  // One request for the whole school — this used to await one
  // EmergencyContact.filter per student, in sequence (300 round-trips for a
  // 300-student school on the director's first screen).
  const emergencyContactsQuery = useQuery({
    queryKey: ['homeEmergencyContacts', userProfile.school_id],
    queryFn: () => schoolRead('EmergencyContact', 
      { school_id: userProfile.school_id },
      undefined,
      5000,
    ),
  });

  const { data: unreadUrgentNotices = [] } = useQuery({
    queryKey: ['adminUnreadUrgentNotices', userProfile.school_id],
    queryFn: async () => {
      const urgentNotices = await schoolRead('Notice', { school_id: userProfile.school_id, priority: 'URGENT' }, '-created_date', 50);
      const urgentIds = new Set(urgentNotices.map((notice) => notice.id));
      const pending = await schoolRead('NoticeDelivery', { school_id: userProfile.school_id, status: 'SENT' }, '-created_date', 200);
      return pending.filter((row) => urgentIds.has(row.notice_id));
    },
  });

  const pendingUsers = pendingUsersQuery.data ?? [];
  const allProfiles = allProfilesQuery.data ?? [];
  const classrooms = classroomsQuery.data ?? [];
  const students = studentsQuery.data ?? [];
  const overdueCharges = overdueChargesQuery.data ?? [];
  const setupSteps = setupStepsQuery.data ?? [];
  const teacherAssignments = teacherAssignmentsQuery.data ?? [];
  const parentLinks = parentLinksQuery.data ?? [];
  const emergencyContacts = emergencyContactsQuery.data ?? [];

  // A stat whose data is still loading, or failed to load, shows "—" rather
  // than a confident 0 / 0% ("Pagos vencidos 0" while the query is in flight,
  // or after it errored, reads as good news that nobody checked).
  const unknown = (...queries) => queries.some((q) => q.isPending || q.isError);
  const statValue = (value, ...queries) => (unknown(...queries) ? '—' : value);

  const handleEmergencyAlert = () => {
    navigate(createPageUrl('AlertaEmergencia'));
  };
  const completedSetupSteps = setupSteps.filter((step) => step.is_completed).length;
  const setupProgress = setupSteps.length > 0 ? Math.round((completedSetupSteps / setupSteps.length) * 100) : 0;
  const teacherProfiles = allProfiles.filter((p) => p.app_role === 'TEACHER' && p.status === 'ACTIVE');
  const teacherCoverage = teacherProfiles.length > 0 ? Math.round((new Set(teacherAssignments.map((a) => a.teacher_id)).size / teacherProfiles.length) * 100) : 0;
  const parentCoverage = percentOfStudentsCovered(students, parentLinks);
  const emergencyCoverage = percentOfStudentsCovered(students, emergencyContacts);

  const stats = [
    { key: 'students', value: statValue(students.length, studentsQuery), label: 'Alumnos activos', tone: 'text-card-foreground' },
    { key: 'classrooms', value: statValue(classrooms.length, classroomsQuery), label: 'Salones', tone: 'text-card-foreground' },
    {
      key: 'pending',
      value: statValue(pendingUsers.length, pendingUsersQuery),
      label: 'Usuarios por aprobar',
      tone: 'text-amber-600 dark:text-amber-400',
      href: createPageUrl('Aprobaciones'),
    },
    {
      key: 'overdue',
      value: statValue(overdueCharges.length, overdueChargesQuery),
      label: 'Pagos vencidos',
      tone: 'text-red-600 dark:text-red-400',
      href: createPageUrl('PagosAdmin'),
    },
    { key: 'setup', value: statValue(`${setupProgress}%`, setupStepsQuery), label: 'Configuración completada', tone: 'text-brand', href: createPageUrl('ConfiguracionInicial') },
    { key: 'teachers', value: statValue(`${teacherCoverage}%`, allProfilesQuery, teacherAssignmentsQuery), label: 'Maestros con salón asignado', tone: 'text-brand' },
    { key: 'parents', value: statValue(`${parentCoverage}%`, studentsQuery, parentLinksQuery), label: 'Alumnos con tutor vinculado', tone: 'text-brand' },
    { key: 'emergency', value: statValue(`${emergencyCoverage}%`, studentsQuery, emergencyContactsQuery), label: 'Alumnos con contacto de emergencia', tone: 'text-amber-600 dark:text-amber-400' },
  ];

  return (
    <div className="min-h-screen bg-background">
      <HomeHeader
        eyebrow={format(schoolTodayDate(), "EEEE d 'de' MMMM", { locale: es })}
        title={school?.name || 'Administración'}
        subtitle={unknown(classroomsQuery, studentsQuery)
          ? undefined
          : `${countLabel(classrooms.length, 'salón', 'salones')} · ${countLabel(students.length, 'alumno')}`}
      />
      {/* Emergency Button */}
      <div className="relative z-10 mx-auto max-w-2xl px-6 -mt-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Button
            onClick={handleEmergencyAlert}
            className="w-full h-14 bg-red-600 hover:bg-red-700 text-white text-lg font-semibold gap-2 shadow-lg"
          >
            <AlertTriangle className="w-6 h-6" />
            Enviar alerta de EMERGENCIA
          </Button>
        </motion.div>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-2xl px-6 mt-7 pb-24">
        <PaymentReminderBanner subscription={subscription} />

        {/* Status first: the numbers a director opens the app to see, above the
            navigation tiles rather than 17 tiles further down. */}
        <section aria-labelledby="admin-home-status" className="mb-7">
          <p id="admin-home-status" className="mb-3 px-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Resumen de hoy
          </p>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-2 gap-3"
          >
            {stats.map((stat) => {
              const content = (
                <>
                  <p className={`text-3xl font-bold ${stat.tone}`}>{stat.value}</p>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                </>
              );
              const base = 'block h-full bg-card rounded-xl p-4 border border-border';
              return stat.href ? (
                <button
                  key={stat.key}
                  type="button"
                  onClick={() => navigate(stat.href)}
                  className={`${base} text-left transition-colors hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand`}
                >
                  {content}
                </button>
              ) : (
                <div key={stat.key} className={base}>{content}</div>
              );
            })}
          </motion.div>
        </section>

        {/* Short join code, resolved server-side by getMySubscription, with
            Copiar código / Copiar liga / WhatsApp (P6 JoinCodeCard; replaces
            P5's client-side card, which read School — platform-only under RLS). */}
        <JoinCodeCard className="mb-7" />

        {/* Main Tiles, grouped so the section labels carry the structure. */}
        <div className="space-y-7">
          <section>
            <p className="mb-3 px-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Personas y operación
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <BigTile
                icon={UserCheck}
                title="Aprobaciones"
                subtitle="Usuarios pendientes"
                badge={pendingUsers.length}
                badgeColor="bg-amber-500"
                href={createPageUrl('Aprobaciones')}
                delay={0.05}
              />
              <BigTile
                icon={School}
                title="Escuela"
                subtitle="Salones y alumnos"
                href={createPageUrl('GestionEscuela')}
                delay={0.1}
              />
              <BigTile
                icon={Users}
                title="Asistencia"
                subtitle="Control y resumen"
                href={createPageUrl('ResumenAsistencia')}
                delay={0.15}
              />
              <BigTile
                icon={ClipboardCheck}
                title="Solicitudes de ausencias"
                subtitle="Aprobar o rechazar"
                href={createPageUrl('GestionAusencias')}
                delay={0.2}
              />
              <BigTile
                icon={ListChecks}
                title="Operación diaria"
                subtitle="Todo lo del día en un solo lugar"
                href={createPageUrl('OperacionDiaria')}
                delay={0.25}
              />
            </div>
          </section>

          <section>
            <p className="mb-3 px-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Comunicación
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <BigTile
                icon={Bell}
                title="Avisos"
                subtitle={unreadUrgentNotices.length > 0 ? countLabel(unreadUrgentNotices.length, 'urgente sin leer', 'urgentes sin leer') : 'Enviar comunicados'}
                href={createPageUrl('AvisosAdmin')}
                badge={unreadUrgentNotices.length}
                delay={0.05}
              />
              <BigTile
                icon={Calendar}
                title="Calendario"
                subtitle="Eventos escolares"
                href={createPageUrl('CalendarioEscolar')}
                delay={0.1}
              />
              <BigTile
                icon={FileText}
                title="Documentos oficiales"
                subtitle="Menús, comunicaciones y minutas"
                href={createPageUrl('GestionDocumentos')}
                delay={0.15}
              />
            </div>
          </section>

          <section>
            <p className="mb-3 px-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Finanzas y servicios
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <BigTile
                icon={CreditCard}
                title="Pagos"
                subtitle={overdueCharges.length > 0 ? countLabel(overdueCharges.length, 'cargo vencido', 'cargos vencidos') : 'Configurar conceptos y cargos'}
                badge={overdueCharges.length}
                href={createPageUrl('PagosAdmin')}
                delay={0.05}
              />
              <BigTile
                icon={Percent}
                title="Descuentos"
                subtitle="Configurar descuentos"
                href={createPageUrl('GestionDescuentos')}
                delay={0.1}
              />
              <BigTile
                icon={ShoppingBag}
                title="Pedidos de uniformes"
                subtitle="Gestionar pedidos de padres"
                href={createPageUrl('GestionPedidosAdmin')}
                delay={0.15}
              />
              <BigTile
                icon={BadgeCheck}
                title="Licencia"
                subtitle="Plan y suscripción"
                href={createPageUrl('LicenseAdmin')}
                delay={0.2}
              />
            </div>
          </section>

          <section>
            <p className="mb-3 px-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Reportes y seguridad
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <BigTile
                icon={BarChart3}
                title="Reportes"
                subtitle="Ver resúmenes"
                href={createPageUrl('Reportes')}
                delay={0.05}
              />
              <BigTile
                icon={ShieldCheck}
                title="Auditoría"
                subtitle="Revisar trazabilidad"
                href={createPageUrl('AuditoriaAdmin')}
                delay={0.1}
              />
              <BigTile
                icon={KeyRound}
                title="Permisos y roles"
                subtitle="Accesos administrativos"
                href={createPageUrl('PermisosRoles')}
                delay={0.15}
              />
            </div>
          </section>

          <section>
            <p className="mb-3 px-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Configuración y soporte
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <BigTile
                icon={Settings}
                title="Configuración inicial"
                subtitle="Guía paso a paso"
                href={createPageUrl('ConfiguracionInicial')}
                delay={0.05}
              />
              <BigTile
                icon={Headset}
                title="Soporte"
                subtitle="Tickets de tu escuela"
                href={createPageUrl('SoporteAdmin')}
                delay={0.1}
              />
              <BigTile
                icon={Inbox}
                title="Panel de soporte"
                subtitle="Pendientes por categoría y prioridad"
                href={createPageUrl('PanelSoporte')}
                delay={0.15}
              />
            </div>
          </section>
        </div>

      </div>

    </div>
  );
}
