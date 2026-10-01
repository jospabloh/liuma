import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { schoolRead } from '@/lib/data/schoolRead';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { motion, AnimatePresence } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import LoadingScreen from '@/components/ui/LoadingScreen';
import NoticeCard from '@/components/notices/NoticeCard';
import EmptyState from '@/components/ui/EmptyState';
import { Bell, Plus, Loader2, ArrowRight, ArrowLeft, Send, CheckCircle, Check } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { createPageUrl } from '@/utils';
import { toast } from "sonner";
import { AUDIT_ENTITIES, logAuditEvent } from '@/lib/audit';
import { getLinkedClassrooms } from '@/lib/relations/getLinkedClassrooms';
import { guardedCreate, guardedUpdate, publishNoticeDeliveries } from '@/lib/authorization/guardedWrite';
import { unreadCopies } from '@/lib/notifications/inbox';
import { readNoticeInbox } from '@/lib/notifications/readInbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function AvisosMaestro() {
  const queryClient = useQueryClient();
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [formData, setFormData] = useState({
    scope: 'CLASSROOM',
    classroom_id: '',
    title: '',
    content: '',
    priority: 'NORMAL',
  });

  const { user, userProfile } = useCurrentProfile();

  const { data: linkedClassrooms = { classrooms: [], classroomIds: [] } } = useQuery({
    queryKey: ['linkedClassrooms', user?.id],
    queryFn: () => getLinkedClassrooms(user),
    enabled: !!user,
  });

  const classroomIds = linkedClassrooms.classroomIds;
  const classrooms = linkedClassrooms.classrooms;

  const { data: notices = [], isLoading, isError: noticesFailed, refetch: refetchNotices } = useQuery({
    queryKey: ['teacherNotices', user?.id],
    queryFn: () => schoolRead('Notice', { 
      author_id: user.id 
    }, '-created_date', 20),
    enabled: !!user,
  });

  // What the school sent TO this teacher — today, the emergency alert, which
  // sendBulkNotification delivers to every active teacher as well as to the
  // families. This page used to list only the teacher's own notices, so a
  // teacher had no in-app copy of the alert at all.
  //
  // A failed read must not look like "nothing received": the home's
  // "N urgentes sin leer" leads here, so an empty page after a failed load
  // reads as "the badge lied" (live QA of v1.8.2, under the rate limit).
  const { data: received = [], isError: receivedFailed, refetch: refetchReceived, isFetching: receivedFetching } = useQuery({
    queryKey: ['noticeDeliveries', 'teacherInbox', user?.id, userProfile?.school_id],
    queryFn: () => readNoticeInbox({ schoolId: userProfile.school_id, userId: user.id }),
    enabled: !!user?.id && !!userProfile?.school_id,
  });

  const markReceivedAsRead = useMutation({
    mutationFn: (entry) => Promise.all(
      unreadCopies(entry).map((copy) => guardedUpdate('NoticeDelivery', copy.id, { status: 'READ' })),
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['noticeDeliveries'] }),
    onError: () => toast.error('No se pudo marcar como leído. Intenta de nuevo.'),
  });

  const createNoticeMutation = useMutation({
    mutationFn: async (data) => {
      const notice = await guardedCreate('Notice', data);

      // The server delivers the notice to the ACTIVE parents of the students
      // it targets, from the stored notice (P10b) — a teacher only their own.
      const recipients = await publishNoticeDeliveries(notice.id);
      
      await logAuditEvent({
        user,
        userProfile,
        entity: AUDIT_ENTITIES.NOTICE,
        entityId: notice.id,
        action: 'NOTICE_SENT',
        reason: 'Notice publishing flow',
        context: { scope: data.scope, priority: data.priority, recipients }
      });
      
      return notice;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['teacherNotices']);
      toast.success('Aviso enviado correctamente');
      setShowWizard(false);
      resetForm();
    },
    onError: () => {
      toast.error('Error al enviar el aviso');
    }
  });

  const resetForm = () => {
    setFormData({
      scope: 'CLASSROOM',
      classroom_id: '',
      title: '',
      content: '',
      priority: 'NORMAL',
    });
    setWizardStep(1);
  };

  const isDirty = useMemo(() => (
    formData.classroom_id || formData.title || formData.content || formData.priority !== 'NORMAL' || wizardStep > 1
  ), [formData, wizardStep]);

  const handleSubmit = () => {
    createNoticeMutation.mutate({
      ...formData,
      school_id: userProfile.school_id,
      author_id: user.id,
      author_name: user.full_name,
      sent_at: new Date().toISOString(),
    });
  };

  if (isLoading) return <LoadingScreen message="Cargando..." />;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6 pb-24">
      <PageHeader
        title="Avisos"
        showBack
        backTo={createPageUrl('Home')}
        action={
          <Button onClick={() => setShowWizard(true)} className="gap-1">
            <Plus className="w-4 h-4" /> Crear
          </Button>
        }
      />

      {receivedFailed && received.length === 0 && (
        <section className="mb-8" aria-labelledby="avisos-recibidos">
          <h2 id="avisos-recibidos" className="text-sm font-semibold text-muted-foreground mb-3">
            Recibidos de la escuela
          </h2>
          <div role="alert" className="rounded-xl border border-border bg-card p-4 text-sm text-card-foreground">
            <p>No pudimos cargar los avisos que te envió la escuela.</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              disabled={receivedFetching}
              onClick={() => refetchReceived()}
            >
              Reintentar
            </Button>
          </div>
          <h2 className="text-sm font-semibold text-muted-foreground mt-8">Tus avisos</h2>
        </section>
      )}

      {received.length > 0 && (
        <section className="mb-8" aria-labelledby="avisos-recibidos">
          <h2 id="avisos-recibidos" className="text-sm font-semibold text-muted-foreground mb-3">
            Recibidos de la escuela
          </h2>
          <div className="space-y-4">
            {received.map((entry) => (
              <div key={entry.notice.id} className="space-y-2">
                <NoticeCard notice={entry.notice} />
                {entry.delivery.status === 'SENT' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    disabled={markReceivedAsRead.isPending}
                    onClick={() => markReceivedAsRead.mutate(entry)}
                  >
                    <Check className="w-4 h-4 mr-1" /> Marcar como leído
                  </Button>
                )}
              </div>
            ))}
          </div>
          <h2 className="text-sm font-semibold text-muted-foreground mt-8">Tus avisos</h2>
        </section>
      )}

      {noticesFailed && notices.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No pudimos cargar tus avisos"
          description="Revisa tu conexión e inténtalo de nuevo."
          action={
            <Button onClick={() => refetchNotices()}>Reintentar</Button>
          }
        />
      ) : notices.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="Sin avisos"
          description="Crea el primer aviso para tus alumnos y sus padres."
          action={
            <Button onClick={() => setShowWizard(true)}>
              <Plus className="w-4 h-4 mr-1" /> Crear aviso
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {notices.map((notice, index) => (
            <motion.div
              key={notice.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <NoticeCard notice={notice} />
            </motion.div>
          ))}
        </div>
      )}

      {/* Create Notice Wizard */}
      <Dialog open={showWizard} onOpenChange={(open) => { setShowWizard(open); if (!open) resetForm(); }}>
        <DialogContent
          className="max-w-md"
          onInteractOutside={(event) => {
            if (isDirty && !createNoticeMutation.isPending) {
              event.preventDefault();
              toast.error('Tienes cambios sin guardar');
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Nuevo aviso</DialogTitle>
          </DialogHeader>
          
          {/* Progress */}
          <div className="flex gap-2 mb-4">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`flex-1 h-1.5 rounded-full transition-colors ${
                  s <= wizardStep ? 'bg-brand' : 'bg-muted'
                }`}
              />
            ))}
          </div>

          <AnimatePresence mode="wait">
            {/* Step 1: Scope */}
            {wizardStep === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <h3 className="font-medium text-foreground">¿A quién va dirigido?</h3>
                
                <div>
                  <Label>Salón</Label>
                  <Select
                    value={formData.classroom_id}
                    onValueChange={(value) => setFormData({ ...formData, classroom_id: value })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Seleccionar salón" />
                    </SelectTrigger>
                    <SelectContent>
                      {classrooms.map((classroom) => (
                        <SelectItem key={classroom.id} value={classroom.id}>
                          {classroom.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Prioridad</Label>
                  <Select
                    value={formData.priority}
                    onValueChange={(value) => setFormData({ ...formData, priority: value })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NORMAL">Normal</SelectItem>
                      <SelectItem value="IMPORTANT">Importante</SelectItem>
                      <SelectItem value="URGENT">Urgente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  onClick={() => setWizardStep(2)}
                  disabled={!formData.classroom_id}
                  className="w-full"
                >
                  Continuar <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </motion.div>
            )}

            {/* Step 2: Content */}
            {wizardStep === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <h3 className="font-medium text-foreground">Escribe tu mensaje</h3>
                
                <div>
                  <Label>Título *</Label>
                  <Input
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder="Título del aviso"
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label>Mensaje *</Label>
                  <Textarea
                    value={formData.content}
                    onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                    placeholder="Escribe el contenido del aviso..."
                    className="mt-1 min-h-[120px]"
                  />
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setWizardStep(1)} className="flex-1">
                    <ArrowLeft className="w-4 h-4 mr-1" /> Atrás
                  </Button>
                  <Button
                    onClick={() => setWizardStep(3)}
                    disabled={!formData.title || !formData.content}
                    className="flex-1"
                  >
                    Revisar <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </motion.div>
            )}

            {/* Step 3: Confirm */}
            {wizardStep === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="text-center mb-4">
                  <Send className="w-12 h-12 text-brand mx-auto mb-2" />
                  <h3 className="font-medium text-foreground">Confirmar y enviar</h3>
                </div>

                <div className="bg-muted rounded-xl p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Para:</span>
                    <span className="font-medium">{classrooms.find(c => c.id === formData.classroom_id)?.name}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Prioridad:</span>
                    <span className="font-medium">{formData.priority}</span>
                  </div>
                </div>

                <div className="bg-card border border-border rounded-xl p-4">
                  <h4 className="font-semibold text-card-foreground">{formData.title}</h4>
                  <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">{formData.content}</p>
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setWizardStep(2)} className="flex-1">
                    <ArrowLeft className="w-4 h-4 mr-1" /> Editar
                  </Button>
                  <Button
                    onClick={handleSubmit}
                    disabled={createNoticeMutation.isPending}
                    className="flex-1"
                  >
                    {createNoticeMutation.isPending ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4 mr-1" /> Enviar
                      </>
                    )}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}