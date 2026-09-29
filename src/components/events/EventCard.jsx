import React from 'react';
import { motion } from 'framer-motion';
import { Clock, MapPin } from 'lucide-react';
import { format, isToday, isTomorrow, differenceInDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { Badge } from "@/components/ui/badge";
import { parseLocalDate, startOfLocalDay } from '@/lib/dates';

export default function EventCard({ event, onClick }) {
  const eventDate = parseLocalDate(event.date);
  if (!eventDate) return null;
  // Whole calendar days between today and the event, not 24h blocks from now.
  const daysUntil = differenceInDays(eventDate, startOfLocalDay());
  
  const getDateLabel = () => {
    if (isToday(eventDate)) return 'Hoy';
    if (isTomorrow(eventDate)) return 'Mañana';
    if (daysUntil <= 7 && daysUntil > 0) return `En ${daysUntil} días`;
    return format(eventDate, "d 'de' MMMM", { locale: es });
  };
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="bg-card text-card-foreground rounded-xl p-4 shadow-sm border border-border cursor-pointer"
    >
      <div className="flex gap-4">
        <div className="flex-shrink-0 w-14 h-14 rounded-xl bg-brand/10 flex flex-col items-center justify-center">
          <span className="text-xs font-medium text-brand uppercase">
            {format(eventDate, 'MMM', { locale: es })}
          </span>
          <span className="text-xl font-bold text-brand">
            {format(eventDate, 'd')}
          </span>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            {(isToday(eventDate) || isTomorrow(eventDate)) && (
              <Badge className="bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 text-xs">
                {getDateLabel()}
              </Badge>
            )}
          </div>
          <h3 className="font-semibold text-card-foreground">{event.title}</h3>
          <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
            {event.time && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {event.time}
              </span>
            )}
            {event.location && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {event.location}
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}