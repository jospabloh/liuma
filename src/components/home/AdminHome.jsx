import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import { UserCheck, School, Bell, CreditCard, BarChart3, AlertTriangle, Users, Calendar, FileText, ShoppingBag, Percent, ClipboardCheck, Settings, ListChecks, ShieldCheck, KeyRound, Headset, BadgeCheck, Inbox } from 'lucide-react';
import BigTile from '@/components/ui/BigTile';
import { HomeHeader } from '@/components/home/HomeChrome';
import PaymentReminderBanner from '@/components/subscription/PaymentReminderBanner';
import JoinCodeCard from '@/components/school/JoinCodeCard';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Button } from "@/components/ui/button";
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';

export default function AdminHome({ user, userProfile, subscription }) {
  const navigate = useNavigate();

  // Get pending approvals
  const { data: pendingUsers = [] } = useQuery({
    queryKey: ['pendingUsers', userProfile.school_id],
    queryFn: () => base44.entities.UserProfile.filter({ 
      school_id: userProfile.school_id,
      status: 'PENDING' 
    }),
  });
  const { data: allProfiles = [] } = useQuery({
    queryKey: ['allProfiles', userProfile.school_id],
    queryFn: () => base44.entities.UserProfile.filter({ school_id: userProfile.school_id }),
  });

  // Get school info
  const { data: school } = useQuery({
    queryKey: ['school', userProfile.school_id],
    queryFn: async () => {
      const schools = await base44.entities.School.filter({ id: userProfile.school_id });
      return schools[0];
    },
  });

  // Get classrooms count
  const { data: classrooms = [] } = useQuery({
    queryKey: ['allClassrooms', userProfile.school_id],
    queryFn: () => base44.entities.Classroom.filter({ 
      school_id: userProfile.school_id,
      is_active: true 
    }),
  });

  // Get students count
  const { data: students = [] } = useQuery({
    queryKey: ['allStudents', userProfile.school_id],
    queryFn: () => base44.entities.Student.filter({ 
      school_id: userProfile.school_id,
      is_active: true 
    }),
  });

  // Get overdue payments
  const { data: overdueCharges = [] } = useQuery({
    queryKey: ['overdueCharges', userProfile.school_id],
    queryFn: async () => {
      const charges = await base44.entities.ChargeItem.filter({ 
        school_id: userProfile.school_id,
        status: 'PENDING'
      });
      return charges.filter(c => new Date(c.due_date) < new Date());
    },
  });
  const { data: setupSteps = [] } = useQuery({
    queryKey: ['homeSetupGuide', userProfile.school_id],
    queryFn: () => base44.entities.SchoolSetupGuide.filter({ school_id: userProfile.school_id }),
  });
  const { data: teacherAssignments = [] } = useQuery({
    queryKey: ['homeTeacherAssignments', userProfile.school_id],
    queryFn: () => base44.entities.TeacherClassroom.filter({ school_id: userProfile.school_id, is_active: true }),
  });
  const { data: parentLinks = [] } = useQuery({
    queryKey: ['homeParentLinks', userProfile.school_id],
    queryFn: () => base44.entities.ParentStudent.filter({ school_id: userProfile.school_id, status: 'ACTIVE' }),
  });
  const { data: emergencyContacts = [] } = useQuery({
    queryKey: ['homeEmergencyContacts', userProfile.school_id, students.length],
    queryFn: async () => {
      const allContacts = [];
      for (const student of students) {
        const rows = await base44.entities.EmergencyContact.filter({ student_id: student.id });
        allContacts.push(...rows);
      }
      return allContacts;
    },
    enabled: students.length > 0,
  });


  const { data: unreadUrgentNotices = [] } = useQuery({
    queryKey: ['adminUnreadUrgentNotices', userProfile.school_id],
    queryFn: async () => {
      const urgentNotices = await base44.entities.Notice.filter({ school_id: userProfile.school_id, priority: 'URGENT' }, '-created_date', 50);
      const urgentIds = new Set(urgentNotices.map((notice) => notice.id));
      const pending = await base44.entities.NoticeDelivery.filter({ school_id: userProfile.school_id, status: 'SENT' }, '-created_date', 200);
      return pending.filter((row) => urgentIds.has(row.notice_id));
    },
  });

  const handleEmergencyAlert = () => {
    navigate(createPageUrl('AlertaEmergencia'));
  };
  const completedSetupSteps = setupSteps.filter((step) => step.is_completed).length;
  const setupProgress = setupSteps.length > 0 ? Math.round((completedSetupSteps / setupSteps.length) * 100) : 0;
  const teacherProfiles = allProfiles.filter((p) => p.app_role === 'TEACHER' && p.status === 'ACTIVE');
  const teacherCoverage = teacherProfiles.length > 0 ? Math.round((new Set(teacherAssignments.map((a) => a.teacher_id)).size / teacherProfiles.length) * 100) : 0;
  const parentCoverage = students.length > 0 ? Math.round((new Set(parentLinks.map((l) => l.student_id)).size / students.length) * 100) : 0;
  const emergencyCoverage = students.length > 0 ? Math.round((new Set(emergencyContacts.map((c) => c.student_id)).size / students.length) * 100) : 0;

  return (
    <div className="min-h-screen bg-background">
      <HomeHeader
        eyebrow={format(new Date(), "EEEE d 'de' MMMM", { locale: es })}
        title={school?.name || 'Administración'}
        subtitle={`${classrooms.length} salones · ${students.length} alumnos`}
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
                title="Solicitudes de Ausencias"
                subtitle="Aprobar o rechazar"
                href={createPageUrl('GestionAusencias')}
                delay={0.2}
              />
              <BigTile
                icon={ListChecks}
                title="Operación Diaria"
                subtitle="Timeline combinado"
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
                subtitle={unreadUrgentNotices.length > 0 ? `${unreadUrgentNotices.length} urgentes sin leer` : 'Enviar comunicados'}
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
                title="Documentos Oficiales"
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
                subtitle={overdueCharges.length > 0 ? `${overdueCharges.length} vencidos` : 'Configurar conceptos y cargos'}
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
                title="Pedidos de Uniformes"
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
                title="Permisos y Roles"
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
                title="Configuración Inicial"
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

        {/* Quick Stats */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="mt-8 grid grid-cols-2 gap-3"
        >
          <div className="bg-card rounded-xl p-4 border border-border">
            <p className="text-3xl font-bold text-card-foreground">{students.length}</p>
            <p className="text-sm text-muted-foreground">Alumnos activos</p>
          </div>
          <div className="bg-card rounded-xl p-4 border border-border">
            <p className="text-3xl font-bold text-card-foreground">{classrooms.length}</p>
            <p className="text-sm text-muted-foreground">Salones</p>
          </div>
          <div className="bg-card rounded-xl p-4 border border-border">
            <p className="text-3xl font-bold text-amber-600">{pendingUsers.length}</p>
            <p className="text-sm text-muted-foreground">Por aprobar</p>
          </div>
          <div className="bg-card rounded-xl p-4 border border-border">
            <p className="text-3xl font-bold text-red-600">{overdueCharges.length}</p>
            <p className="text-sm text-muted-foreground">Pagos vencidos</p>
          </div>
          <div className="bg-card rounded-xl p-4 border border-border">
            <p className="text-3xl font-bold text-brand">{setupProgress}%</p>
            <p className="text-sm text-muted-foreground">Setup general</p>
          </div>
          <div className="bg-card rounded-xl p-4 border border-border">
            <p className="text-3xl font-bold text-brand">{teacherCoverage}%</p>
            <p className="text-sm text-muted-foreground">Maestro-salón</p>
          </div>
          <div className="bg-card rounded-xl p-4 border border-border">
            <p className="text-3xl font-bold text-brand">{parentCoverage}%</p>
            <p className="text-sm text-muted-foreground">Alumno-padre</p>
          </div>
          <div className="bg-card rounded-xl p-4 border border-border">
            <p className="text-3xl font-bold text-amber-600">{emergencyCoverage}%</p>
            <p className="text-sm text-muted-foreground">Contactos emergencia</p>
          </div>
        </motion.div>

        {/* Short join code (server-resolved) with copy/share — P6. */}
        <JoinCodeCard className="mt-6" />
      </div>

    </div>
  );
}
