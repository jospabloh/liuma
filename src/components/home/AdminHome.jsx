import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import { UserCheck, School, Bell, CreditCard, BarChart3, AlertTriangle, Users, Calendar, FileText, ShoppingBag, Percent, ClipboardCheck, Settings, ListChecks, ShieldCheck } from 'lucide-react';
import BigTile from '@/components/ui/BigTile';
import LumiButton from '@/components/ui/LumiButton';
import LumiChat from '@/components/lumi/LumiChat';
import PaymentReminderBanner from '@/components/subscription/PaymentReminderBanner';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Button } from "@/components/ui/button";
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';

export default function AdminHome({ user, userProfile, subscription }) {
  const [showLumi, setShowLumi] = useState(false);
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
  const { data: paymentConcepts = [] } = useQuery({
    queryKey: ['homePaymentConcepts', userProfile.school_id],
    queryFn: () => base44.entities.PaymentConcept.filter({ school_id: userProfile.school_id, is_active: true }),
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
  const paymentReady = paymentConcepts.length > 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-6 pt-12 pb-8">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <p className="text-slate-400 text-sm">
            {format(new Date(), "EEEE d 'de' MMMM", { locale: es })}
          </p>
          <h1 className="text-2xl font-bold text-white mt-1">
            {school?.name || 'Administración'}
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            {classrooms.length} salones · {students.length} alumnos
          </p>
        </motion.div>
      </div>

      {/* Emergency Button */}
      <div className="px-6 -mt-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Button
            onClick={handleEmergencyAlert}
            className="w-full h-14 bg-red-600 hover:bg-red-700 text-lg font-semibold gap-2 shadow-lg"
          >
            <AlertTriangle className="w-6 h-6" />
            Enviar alerta de EMERGENCIA
          </Button>
        </motion.div>
      </div>

      {/* Main Content */}
      <div className="px-6 mt-6 pb-24">
        <PaymentReminderBanner subscription={subscription} />
        
        {/* Main Tiles */}
        <div className="grid grid-cols-2 gap-3">
          <BigTile
            icon={UserCheck}
            title="Aprobaciones"
            subtitle="Usuarios pendientes"
            badge={pendingUsers.length}
            badgeColor="bg-amber-500"
            href={createPageUrl('Aprobaciones')}
            color="from-amber-50 to-white"
            iconColor="text-amber-600"
            delay={0.1}
          />
          <BigTile
            icon={School}
            title="Escuela"
            subtitle="Salones y alumnos"
            href={createPageUrl('GestionEscuela')}
            color="from-blue-50 to-white"
            iconColor="text-blue-600"
            delay={0.15}
          />
          <BigTile
            icon={Bell}
            title="Avisos"
            subtitle={unreadUrgentNotices.length > 0 ? `${unreadUrgentNotices.length} urgentes sin leer` : 'Enviar comunicados'}
            href={createPageUrl('AvisosAdmin')}
            badge={unreadUrgentNotices.length}
            badgeColor="bg-red-500"
            color="from-violet-50 to-white"
            iconColor="text-violet-600"
            delay={0.2}
          />
          <BigTile
            icon={CreditCard}
            title="Pagos"
            subtitle={paymentReady ? (overdueCharges.length > 0 ? `${overdueCharges.length} vencidos` : 'Gestionar pagos') : 'Bloqueado: define conceptos base'}
            badge={overdueCharges.length}
            badgeColor="bg-red-500"
            href={paymentReady ? createPageUrl('PagosAdmin') : undefined}
            color="from-rose-50 to-white"
            iconColor="text-rose-600"
            delay={0.25}
          />
          <BigTile
            icon={BarChart3}
            title="Reportes"
            subtitle="Ver resúmenes"
            href={createPageUrl('Reportes')}
            color="from-slate-100 to-white"
            iconColor="text-slate-600"
            delay={0.3}
          />
          <BigTile
            icon={Users}
            title="Asistencia"
            subtitle="Control y resumen"
            href={createPageUrl('ResumenAsistencia')}
            color="from-green-50 to-white"
            iconColor="text-green-600"
            delay={0.35}
          />
          <BigTile
            icon={Calendar}
            title="Calendario"
            subtitle="Eventos escolares"
            href={createPageUrl('CalendarioEscolar')}
            color="from-sky-50 to-white"
            iconColor="text-sky-600"
            delay={0.4}
          />
          <BigTile
            icon={FileText}
            title="Documentos Oficiales"
            subtitle="Menús, comunicaciones y minutas"
            href={createPageUrl('GestionDocumentos')}
            color="from-purple-50 to-white"
            iconColor="text-purple-600"
            delay={0.45}
          />
          <BigTile
            icon={ShoppingBag}
            title="Pedidos de Uniformes"
            subtitle="Gestionar pedidos de padres"
            href={createPageUrl('GestionPedidosAdmin')}
            color="from-teal-50 to-white"
            iconColor="text-teal-600"
            delay={0.5}
          />
          <BigTile
            icon={Percent}
            title="Descuentos"
            subtitle="Configurar descuentos"
            href={createPageUrl('GestionDescuentos')}
            color="from-orange-50 to-white"
            iconColor="text-orange-600"
            delay={0.55}
          />
          <BigTile
            icon={ClipboardCheck}
            title="Solicitudes de Ausencias"
            subtitle="Aprobar o rechazar"
            href={createPageUrl('GestionAusencias')}
            color="from-cyan-50 to-white"
            iconColor="text-cyan-600"
            delay={0.6}
          />
          <BigTile
            icon={Settings}
            title="Configuración Inicial"
            subtitle="Guía paso a paso"
            href={createPageUrl('ConfiguracionInicial')}
            color="from-pink-50 to-white"
            iconColor="text-pink-600"
            delay={0.65}
          />

          <BigTile
            icon={ShieldCheck}
            title="Auditoría"
            subtitle="Revisar trazabilidad"
            href={createPageUrl('AuditoriaAdmin')}
            color="from-emerald-50 to-white"
            iconColor="text-emerald-600"
            delay={0.72}
          />
          <BigTile
            icon={ListChecks}
            title="Operación Diaria"
            subtitle="Timeline combinado"
            href={createPageUrl('OperacionDiaria')}
            color="from-lime-50 to-white"
            iconColor="text-lime-600"
            delay={0.7}
          />
        </div>

        {/* Quick Stats */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="mt-8 grid grid-cols-2 gap-3"
        >
          <div className="bg-white rounded-xl p-4 border border-slate-100">
            <p className="text-3xl font-bold text-slate-800">{students.length}</p>
            <p className="text-sm text-slate-500">Alumnos activos</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-slate-100">
            <p className="text-3xl font-bold text-slate-800">{classrooms.length}</p>
            <p className="text-sm text-slate-500">Salones</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-slate-100">
            <p className="text-3xl font-bold text-amber-600">{pendingUsers.length}</p>
            <p className="text-sm text-slate-500">Por aprobar</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-slate-100">
            <p className="text-3xl font-bold text-red-600">{overdueCharges.length}</p>
            <p className="text-sm text-slate-500">Pagos vencidos</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-slate-100">
            <p className="text-3xl font-bold text-indigo-600">{setupProgress}%</p>
            <p className="text-sm text-slate-500">Setup general</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-slate-100">
            <p className="text-3xl font-bold text-sky-600">{teacherCoverage}%</p>
            <p className="text-sm text-slate-500">Maestro-salón</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-slate-100">
            <p className="text-3xl font-bold text-emerald-600">{parentCoverage}%</p>
            <p className="text-sm text-slate-500">Alumno-padre</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-slate-100">
            <p className="text-3xl font-bold text-orange-600">{emergencyCoverage}%</p>
            <p className="text-sm text-slate-500">Contactos emergencia</p>
          </div>
        </motion.div>

        {/* School Code */}
        {school && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="mt-6 bg-indigo-50 rounded-xl p-4 border border-indigo-100"
          >
            <p className="text-sm text-indigo-600 mb-1">Código de escuela para invitar usuarios:</p>
            <p className="text-xl font-mono font-bold text-indigo-800">{school.id}</p>
          </motion.div>
        )}
      </div>

      {/* Lumi Button */}
      <LumiButton onClick={() => setShowLumi(true)} />
      
      {/* Lumi Chat */}
      <LumiChat 
        isOpen={showLumi} 
        onClose={() => setShowLumi(false)} 
        userProfile={userProfile}
      />
    </div>
  );
}
