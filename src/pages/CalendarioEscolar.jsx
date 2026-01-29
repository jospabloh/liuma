import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Calendar, Plus, Edit, Trash2, MapPin, Clock, Users } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import PageHeader from "@/components/ui/PageHeader";
import LoadingScreen from "@/components/ui/LoadingScreen";
import EventFormDialog from "@/components/calendar/EventFormDialog";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth, startOfWeek, endOfWeek, addMonths, subMonths } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';

export default function CalendarioEscolar() {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const queryClient = useQueryClient();

  const { isLoading: loadingUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      const profiles = await base44.entities.UserProfile.filter({ user_id: currentUser.id });
      setUserProfile(profiles[0]);
      return currentUser;
    }
  });

  const { data: events = [], isLoading: loadingEvents } = useQuery({
    queryKey: ['events', userProfile?.school_id],
    queryFn: async () => {
      return await base44.entities.Event.filter({ 
        school_id: userProfile.school_id 
      }, 'date');
    },
    enabled: !!userProfile?.school_id
  });

  const { data: classrooms = [] } = useQuery({
    queryKey: ['classrooms', userProfile?.school_id],
    queryFn: async () => {
      return await base44.entities.Classroom.filter({ 
        school_id: userProfile.school_id,
        is_active: true
      });
    },
    enabled: !!userProfile?.school_id && userProfile?.app_role === 'ADMIN'
  });

  const deleteEventMutation = useMutation({
    mutationFn: (eventId) => base44.entities.Event.delete(eventId),
    onSuccess: () => {
      queryClient.invalidateQueries(['events']);
      toast.success('Evento eliminado');
    }
  });

  if (loadingUser || loadingEvents) {
    return <LoadingScreen message="Cargando calendario..." />;
  }

  const monthStart = startOfMonth(selectedDate);
  const monthEnd = endOfMonth(selectedDate);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const getEventsForDate = (date) => {
    return events.filter(event => isSameDay(new Date(event.date), date));
  };

  const upcomingEvents = events.filter(e => new Date(e.date) >= new Date()).slice(0, 5);

  const handleEventClick = (event) => {
    if (userProfile.app_role === 'ADMIN') {
      setEditingEvent(event);
      setShowEventForm(true);
    }
  };

  const handleDeleteEvent = (eventId, e) => {
    e.stopPropagation();
    if (window.confirm('¿Eliminar este evento?')) {
      deleteEventMutation.mutate(eventId);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <PageHeader 
        title="Calendario Escolar"
        subtitle={format(selectedDate, "MMMM yyyy", { locale: es })}
        showBack
        action={
          userProfile.app_role === 'ADMIN' && (
            <Button onClick={() => { setEditingEvent(null); setShowEventForm(true); }}>
              <Plus className="w-4 h-4 mr-2" />
              Nuevo Evento
            </Button>
          )
        }
      />

      <div className="max-w-7xl mx-auto grid lg:grid-cols-3 gap-6">
        {/* Calendar */}
        <div className="lg:col-span-2">
          <Card className="p-6">
            {/* Month Navigation */}
            <div className="flex items-center justify-between mb-6">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedDate(subMonths(selectedDate, 1))}
              >
                ←
              </Button>
              <h3 className="text-lg font-semibold text-slate-800 capitalize">
                {format(selectedDate, "MMMM yyyy", { locale: es })}
              </h3>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedDate(addMonths(selectedDate, 1))}
              >
                →
              </Button>
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-2">
              {/* Day Headers */}
              {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((day, i) => (
                <div key={i} className="text-center text-sm font-medium text-slate-500 py-2">
                  {day}
                </div>
              ))}

              {/* Calendar Days */}
              {calendarDays.map((day, i) => {
                const dayEvents = getEventsForDate(day);
                const isCurrentMonth = isSameMonth(day, selectedDate);
                const isToday = isSameDay(day, new Date());

                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.01 }}
                    className={`
                      min-h-20 p-2 rounded-lg border transition-all
                      ${!isCurrentMonth ? 'bg-slate-50 text-slate-400' : 'bg-white'}
                      ${isToday ? 'border-indigo-500 border-2' : 'border-slate-200'}
                      ${dayEvents.length > 0 ? 'cursor-pointer hover:shadow-md' : ''}
                    `}
                  >
                    <div className={`text-sm font-medium mb-1 ${isToday ? 'text-indigo-600' : ''}`}>
                      {format(day, 'd')}
                    </div>
                    <div className="space-y-1">
                      {dayEvents.slice(0, 2).map(event => (
                        <div
                          key={event.id}
                          onClick={() => handleEventClick(event)}
                          className={`text-xs px-1.5 py-0.5 rounded truncate ${
                            event.scope === 'SCHOOL' 
                              ? 'bg-indigo-100 text-indigo-700' 
                              : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {event.title}
                        </div>
                      ))}
                      {dayEvents.length > 2 && (
                        <div className="text-xs text-slate-500 px-1.5">
                          +{dayEvents.length - 2} más
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* Upcoming Events Sidebar */}
        <div className="space-y-4">
          <Card className="p-6">
            <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-indigo-600" />
              Próximos Eventos
            </h3>
            {upcomingEvents.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-8">
                No hay eventos próximos
              </p>
            ) : (
              <div className="space-y-3">
                {upcomingEvents.map(event => (
                  <motion.div
                    key={event.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="p-3 rounded-lg bg-slate-50 border border-slate-200 hover:shadow-md transition-all cursor-pointer"
                    onClick={() => handleEventClick(event)}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h4 className="font-semibold text-slate-800 text-sm">{event.title}</h4>
                      {userProfile.app_role === 'ADMIN' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-red-500 hover:text-red-600"
                          onClick={(e) => handleDeleteEvent(event.id, e)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                    <div className="text-xs text-slate-600 space-y-1">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {format(new Date(event.date), "d 'de' MMMM", { locale: es })}
                      </div>
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
                      <Badge className={`text-xs ${
                        event.scope === 'SCHOOL' 
                          ? 'bg-indigo-100 text-indigo-700' 
                          : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {event.scope === 'SCHOOL' ? 'Toda la escuela' : 'Por salón'}
                      </Badge>
                    </div>
                    {event.description && (
                      <p className="text-xs text-slate-500 mt-2">{event.description}</p>
                    )}
                  </motion.div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Event Form Dialog */}
      {userProfile.app_role === 'ADMIN' && (
        <EventFormDialog
          isOpen={showEventForm}
          onClose={() => {
            setShowEventForm(false);
            setEditingEvent(null);
          }}
          event={editingEvent}
          schoolId={userProfile.school_id}
          classrooms={classrooms}
        />
      )}
    </div>
  );
}