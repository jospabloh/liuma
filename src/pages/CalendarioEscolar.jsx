import React, { useState } from 'react';
import { schoolRead } from '@/lib/data/schoolRead';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { sendDueEventReminders } from '@/lib/events/reminders';
import { useRunOnce } from '@/hooks/useRunOnce';
import { humanizeError } from '@/lib/errorMessages';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Calendar, Plus, Trash2, MapPin, Clock } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import PageHeader from "@/components/ui/PageHeader";
import LoadingScreen from "@/components/ui/LoadingScreen";
import EventFormDialog from "@/components/calendar/EventFormDialog";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth, startOfWeek, endOfWeek, addMonths, subMonths } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate, isOnOrAfterToday, isSchoolToday, schoolTodayDate } from '@/lib/dates';
import { toast } from 'sonner';
import { guardedDelete } from '@/lib/authorization/guardedWrite';

export default function CalendarioEscolar() {
  const [selectedDate, setSelectedDate] = useState(() => schoolTodayDate());
  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const queryClient = useQueryClient();

  const { user, userProfile, isLoading: loadingUser } = useCurrentProfile();

  const { data: events = [], isLoading: loadingEvents } = useQuery({
    queryKey: ['events', userProfile?.school_id],
    queryFn: async () => {
      return await schoolRead('Event', { 
        school_id: userProfile.school_id 
      }, 'date');
    },
    enabled: !!userProfile?.school_id
  });

  const { data: classrooms = [] } = useQuery({
    queryKey: ['classrooms', userProfile?.school_id],
    queryFn: async () => {
      return await schoolRead('Classroom', { 
        school_id: userProfile.school_id,
        is_active: true
      });
    },
    enabled: !!userProfile?.school_id && userProfile?.app_role === 'ADMIN'
  });

  const deleteEventMutation = useMutation({
    mutationFn: (eventId) => guardedDelete('Event', eventId),
    onSuccess: () => {
      queryClient.invalidateQueries(['events']);
      toast.success('Evento eliminado');
    },
    onError: (error) => toast.error(humanizeError(error)),
  });

  // No cron in this app, so confirmation reminders run opportunistically when an
  // admin opens the calendar — once per load, idempotent via reminder_sent, and
  // only to parents who haven't responded yet (resolved per event scope).
  useRunOnce(userProfile?.app_role === 'ADMIN' && !!userProfile?.school_id, async () => {
    const count = await sendDueEventReminders({ schoolId: userProfile.school_id });
    if (count > 0) queryClient.invalidateQueries(['events']);
  });

  if (loadingUser || loadingEvents || !userProfile) {
    return <LoadingScreen message="Cargando calendario..." />;
  }

  const isAdmin = userProfile.app_role === 'ADMIN';

  const monthStart = startOfMonth(selectedDate);
  const monthEnd = endOfMonth(selectedDate);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const getEventsForDate = (date) => {
    return events.filter(event => {
      const eventDate = parseLocalDate(event.date);
      return !!eventDate && isSameDay(eventDate, date);
    });
  };

  const selectedDayEvents = getEventsForDate(selectedDate);
  const upcomingEvents = events.filter(e => isOnOrAfterToday(e.date)).slice(0, 5);

  const handleDaySelect = (day) => {
    setSelectedDate(day);
  };

  const handleDayKeyDown = (event, day) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleDaySelect(day);
    }
  };

  const handleEventClick = (event) => {
    if (isAdmin) {
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
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 pb-24">
      <PageHeader
        title="Calendario escolar"
        subtitle={format(selectedDate, "MMMM yyyy", { locale: es })}
        showBack
        action={
          isAdmin && (
            <Button onClick={() => { setEditingEvent(null); setShowEventForm(true); }}>
              <Plus className="w-4 h-4 mr-2" />
              Nuevo Evento
            </Button>
          )
        }
      />

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Calendar */}
        <div className="lg:col-span-2">
          <Card className="-mx-4 rounded-none border-x-0 border-y border-border bg-card text-card-foreground shadow-sm px-0.5 py-2 sm:mx-0 sm:rounded-2xl sm:border sm:p-6">
            {/* Month Navigation */}
            <div className="flex items-center justify-between px-2 sm:px-0 mb-4 sm:mb-6">
              <Button
                variant="outline"
                size="icon"
                aria-label="Mes anterior"
                onClick={() => setSelectedDate(subMonths(selectedDate, 1))}
              >
                <span aria-hidden="true">←</span>
              </Button>
              <h3 className="text-base sm:text-lg font-semibold text-foreground capitalize">
                {format(selectedDate, "MMMM yyyy", { locale: es })}
              </h3>
              <Button
                variant="outline"
                size="icon"
                aria-label="Mes siguiente"
                onClick={() => setSelectedDate(addMonths(selectedDate, 1))}
              >
                <span aria-hidden="true">→</span>
              </Button>
            </div>

            {/* Calendar Grid. On a phone a day cell is ~40px wide, which no
                event title fits in (a "Festival" chip showed 12px of 123px),
                so below `sm` each day shows one dot per event instead and the
                selected day's events are listed in full in "Agenda del día".
                Chips with titles come back from `sm` up.
                Below `sm` the card bleeds to the screen edges (-mx-4 cancels
                the page's px-4; 2px of padding, 1px between days) so seven
                days are ≥44px wide even at 320px: (320 - 4 - 6) / 7 ≈ 44.3px.
                With the page gutter and p-2 they were ~37px at 320 — under a
                finger's 44px. The cell is 48px tall. */}
            <div className="grid grid-cols-7 gap-px sm:gap-2">
              {/* Day Headers */}
              {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((day, i) => (
                <div key={i} className="text-center text-sm font-medium text-muted-foreground py-2">
                  {day}
                </div>
              ))}

              {/* Calendar Days */}
              {calendarDays.map((day, i) => {
                const dayEvents = getEventsForDate(day);
                const isCurrentMonth = isSameMonth(day, selectedDate);
                const isToday = isSchoolToday(day);
                const isSelected = isSameDay(day, selectedDate);

                return (
                  <motion.div
                    key={i}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    aria-label={`Ver agenda del ${format(day, "d 'de' MMMM", { locale: es })}${dayEvents.length ? `, ${dayEvents.length === 1 ? '1 evento' : `${dayEvents.length} eventos`}` : ''}`}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.01 }}
                    onClick={() => handleDaySelect(day)}
                    onKeyDown={(event) => handleDayKeyDown(event, day)}
                    className={`
                      min-h-12 sm:min-h-20 p-1 sm:p-2 rounded-lg border cursor-pointer transition-all duration-200
                      hover:-translate-y-0.5 hover:border-brand/30 hover:bg-brand/10 hover:shadow-md
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2
                      ${!isCurrentMonth ? 'bg-muted text-muted-foreground' : 'bg-card'}
                      ${isToday ? 'border-brand border-2' : 'border-border'}
                      ${isSelected ? 'bg-brand/10 border-brand ring-2 ring-brand/30 shadow-md' : ''}
                    `}
                  >
                    <div className={`text-center sm:text-left text-sm font-medium mb-1 ${isToday ? 'text-brand' : ''}`}>
                      {format(day, 'd')}
                    </div>
                    {dayEvents.length > 0 && (
                      <div className="flex justify-center gap-0.5 sm:hidden" aria-hidden="true" data-event-dots="">
                        {dayEvents.slice(0, 3).map(event => (
                          <span
                            key={event.id}
                            className={`h-1.5 w-1.5 rounded-full ${event.scope === 'SCHOOL' ? 'bg-brand' : 'bg-emerald-500'}`}
                          />
                        ))}
                      </div>
                    )}
                    <div className="hidden sm:block space-y-1">
                      {dayEvents.slice(0, 2).map(event => (
                        <div
                          key={event.id}
                          onClick={(clickEvent) => { clickEvent.stopPropagation(); handleEventClick(event); }}
                          className={`text-xs px-1.5 py-0.5 rounded truncate transition-colors hover:ring-2 hover:ring-brand/30 ${
                            event.scope === 'SCHOOL'
                              ? 'bg-brand/10 text-brand'
                              : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                          }`}
                        >
                          {event.title}
                        </div>
                      ))}
                      {dayEvents.length > 2 && (
                        <div className="text-xs text-muted-foreground px-1.5">
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
          <Card className="bg-card text-card-foreground border border-border rounded-2xl shadow-sm p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-brand" />
              Agenda del día
            </h3>
            <p className="text-sm font-medium text-muted-foreground capitalize mb-4">
              {format(selectedDate, "EEEE d 'de' MMMM", { locale: es })}
            </p>
            {selectedDayEvents.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-8">
                No hay eventos para este día
              </p>
            ) : (
              <div className="space-y-3">
                {selectedDayEvents.map(event => (
                  <motion.div
                    key={event.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="p-3 rounded-lg bg-brand/10 border border-brand/30 hover:shadow-md hover:border-brand/30 transition-all cursor-pointer"
                    onClick={() => handleEventClick(event)}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h4 className="font-semibold text-card-foreground text-sm">{event.title}</h4>
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Eliminar evento"
                          className="h-6 w-6 coarse:h-11 coarse:w-11 coarse:-m-2.5 shrink-0 text-red-500 hover:text-red-600 dark:hover:text-red-400"
                          onClick={(e) => handleDeleteEvent(event.id, e)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground space-y-1">
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
                          ? 'bg-brand/10 text-brand'
                          : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                      }`}>
                        {event.scope === 'SCHOOL' ? 'Toda la escuela' : 'Por salón'}
                      </Badge>
                    </div>
                    {event.description && (
                      <p className="text-xs text-muted-foreground mt-2">{event.description}</p>
                    )}
                  </motion.div>
                ))}
              </div>
            )}
          </Card>

          <Card className="bg-card text-card-foreground border border-border rounded-2xl shadow-sm p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-brand" />
              Próximos Eventos
            </h3>
            {upcomingEvents.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-8">
                No hay eventos próximos
              </p>
            ) : (
              <div className="space-y-3">
                {upcomingEvents.map(event => (
                  <motion.div
                    key={event.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="p-3 rounded-lg bg-muted border border-border hover:shadow-md transition-all cursor-pointer"
                    onClick={() => handleEventClick(event)}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h4 className="font-semibold text-card-foreground text-sm">{event.title}</h4>
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Eliminar evento"
                          className="h-6 w-6 coarse:h-11 coarse:w-11 coarse:-m-2.5 shrink-0 text-red-500 hover:text-red-600 dark:hover:text-red-400"
                          onClick={(e) => handleDeleteEvent(event.id, e)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground space-y-1">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {parseLocalDate(event.date) ? format(parseLocalDate(event.date), "d 'de' MMMM", { locale: es }) : 'Sin fecha'}
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
                          ? 'bg-brand/10 text-brand'
                          : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                      }`}>
                        {event.scope === 'SCHOOL' ? 'Toda la escuela' : 'Por salón'}
                      </Badge>
                    </div>
                    {event.description && (
                      <p className="text-xs text-muted-foreground mt-2">{event.description}</p>
                    )}
                  </motion.div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Event Form Dialog */}
      {isAdmin && (
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
    </div>
  );
}