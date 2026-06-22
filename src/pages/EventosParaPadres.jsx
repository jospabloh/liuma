import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Calendar, Clock, MapPin, DollarSign, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { getLinkedStudents } from '@/lib/relations/getLinkedStudents';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function EventosParaPadres() {
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedStudent, setSelectedStudent] = useState('');
  const [response, setResponse] = useState('ACCEPTED');
  const [notes, setNotes] = useState('');

  const queryClient = useQueryClient();

  const { user, userProfile, isLoading: profileLoading } = useCurrentProfile();

  const { data: linkedStudents = { students: [], studentIds: [], orphanedLinkIds: [] } } = useQuery({
    queryKey: ['linkedStudents', user?.id],
    queryFn: () => getLinkedStudents(user),
    enabled: !!user,
  });

  const students = linkedStudents.students;

  const { data: events, isLoading } = useQuery({
    queryKey: ['eventsRequiringConfirmation', userProfile?.school_id],
    queryFn: async () => {
      const allEvents = await base44.entities.Event.filter({
        school_id: userProfile.school_id,
        requires_confirmation: true
      }, 'date');
      
      // Filtrar solo eventos futuros
      return allEvents.filter(e => new Date(e.date) >= new Date());
    },
    enabled: !!userProfile?.school_id,
  });

  const { data: responses = [] } = useQuery({
    queryKey: ['eventResponses', user?.id],
    queryFn: () => base44.entities.EventResponse.filter({ parent_id: user.id }),
    enabled: !!user?.id,
  });

  const respondMutation = useMutation({
    mutationFn: async (data) => {
      // Crear respuesta
      const eventResponse = await base44.entities.EventResponse.create(data);
      
      // Si acepta y tiene costo, crear cargo automáticamente
      if (data.response === 'ACCEPTED' && selectedEvent.has_cost) {
        const charge = await base44.entities.ChargeItem.create({
          school_id: userProfile.school_id,
          student_id: data.student_id,
          concept_name: selectedEvent.cost_concept || selectedEvent.title,
          concept_type: 'EVENTO',
          original_amount: selectedEvent.cost_amount,
          amount: selectedEvent.cost_amount,
          discount_amount: 0,
          due_date: selectedEvent.confirmation_deadline || selectedEvent.date,
          event_id: selectedEvent.id,
          status: 'PENDING',
        });
        
        // Actualizar respuesta con charge_id
        await base44.entities.EventResponse.update(eventResponse.id, {
          payment_status: 'PENDING',
          charge_id: charge.id,
        });
      }
      
      return eventResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eventResponses'] });
      toast.success('Respuesta enviada');
      closeDialog();
    },
    onError: () => {
      toast.error('Error al enviar respuesta');
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!selectedStudent) {
      toast.error('Selecciona un estudiante');
      return;
    }

    respondMutation.mutate({
      school_id: userProfile.school_id,
      event_id: selectedEvent.id,
      student_id: selectedStudent,
      parent_id: user.id,
      parent_name: user.full_name,
      response,
      payment_status: selectedEvent.has_cost && response === 'ACCEPTED' ? 'PENDING' : 'NOT_REQUIRED',
      notes,
    });
  };

  const openDialog = (event) => {
    setSelectedEvent(event);
    setSelectedStudent('');
    setResponse('ACCEPTED');
    setNotes('');
  };

  const closeDialog = () => {
    setSelectedEvent(null);
    setSelectedStudent('');
    setResponse('ACCEPTED');
    setNotes('');
  };

  const getResponseForEvent = (eventId, studentId) => {
    return responses.find(r => r.event_id === eventId && r.student_id === studentId);
  };

  const responseConfig = {
    ACCEPTED: { label: 'Aceptado', color: 'bg-green-100 text-green-800', icon: CheckCircle },
    DECLINED: { label: 'Declinado', color: 'bg-red-100 text-red-800', icon: XCircle },
    PENDING: { label: 'Pendiente', color: 'bg-yellow-100 text-yellow-800', icon: AlertCircle },
  };

  if (profileLoading || isLoading) {
    return <LoadingScreen message="Cargando eventos..." />;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 pb-24">
        <PageHeader
          title="Eventos"
          subtitle="Eventos que requieren confirmación"
          showBack
        />

        <div className="space-y-4">
          {events?.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Calendar className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No hay eventos pendientes de confirmación</p>
              </CardContent>
            </Card>
          ) : (
            events?.map((event) => {
              const deadline = event.confirmation_deadline;
              const isDeadlinePassed = deadline && new Date(deadline) < new Date();
              
              return (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <Card>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-lg">{event.title}</CardTitle>
                          <CardDescription>
                            {format(new Date(event.date), "EEEE d 'de' MMMM", { locale: es })}
                          </CardDescription>
                        </div>
                        {event.has_cost && (
                          <Badge className="bg-brand/10 text-brand">
                            ${event.cost_amount}
                          </Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      {event.description && (
                        <p className="text-sm text-muted-foreground mb-3">{event.description}</p>
                      )}

                      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mb-4">
                        {event.time && (
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {event.time}
                          </div>
                        )}
                        {event.location && (
                          <div className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {event.location}
                          </div>
                        )}
                        {deadline && (
                          <div className="flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            Confirmar antes del {format(new Date(deadline), "d MMM", { locale: es })}
                          </div>
                        )}
                      </div>

                      {/* Mostrar respuestas por estudiante */}
                      <div className="space-y-2">
                        {students?.map((student) => {
                          const studentResponse = getResponseForEvent(event.id, student.id);
                          const config = studentResponse 
                            ? responseConfig[studentResponse.response]
                            : responseConfig.PENDING;
                          const StatusIcon = config.icon;
                          
                          return (
                            <div key={student.id} className="flex items-center justify-between p-2 bg-muted rounded-lg">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">
                                  {student.first_name} {student.last_name}
                                </span>
                                <Badge className={config.color}>
                                  <StatusIcon className="w-3 h-3 mr-1" />
                                  {config.label}
                                </Badge>
                              </div>
                              {!studentResponse && !isDeadlinePassed && (
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    openDialog(event);
                                    setSelectedStudent(student.id);
                                  }}
                                >
                                  Responder
                                </Button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })
          )}
        </div>

        <Dialog open={!!selectedEvent} onOpenChange={closeDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Confirmar asistencia</DialogTitle>
            </DialogHeader>
            {selectedEvent && (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="p-4 bg-muted rounded-lg">
                  <p className="font-medium">{selectedEvent.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {format(new Date(selectedEvent.date), "d 'de' MMMM", { locale: es })}
                  </p>
                  {selectedEvent.has_cost && (
                    <div className="flex items-center gap-2 mt-2 text-sm">
                      <DollarSign className="w-4 h-4 text-brand" />
                      <span className="text-brand font-medium">
                        Costo: ${selectedEvent.cost_amount}
                      </span>
                    </div>
                  )}
                </div>

                <div>
                  <Label>Estudiante</Label>
                  <Select value={selectedStudent} onValueChange={setSelectedStudent} disabled={!!selectedStudent}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona un estudiante" />
                    </SelectTrigger>
                    <SelectContent>
                      {students?.map((student) => (
                        <SelectItem key={student.id} value={student.id}>
                          {student.first_name} {student.last_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Respuesta</Label>
                  <Select value={response} onValueChange={setResponse}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ACCEPTED">Acepto / Asistirá</SelectItem>
                      <SelectItem value="DECLINED">Declino / No asistirá</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {selectedEvent.has_cost && response === 'ACCEPTED' && (
                  <div className="p-3 bg-brand/10 rounded-lg text-sm text-brand">
                    <p className="font-medium mb-1">Se generará un cargo de pago</p>
                    <p className="text-xs">
                      Al aceptar, se creará automáticamente un cargo por ${selectedEvent.cost_amount} 
                      que podrás pagar en la sección de Pagos.
                    </p>
                  </div>
                )}

                <div>
                  <Label>Notas (opcional)</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Comentarios adicionales"
                    rows={3}
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={respondMutation.isPending}
                >
                  Enviar Respuesta
                </Button>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}