import React from 'react';
import { motion } from 'framer-motion';
import { Calendar, Clock, MapPin } from 'lucide-react';
import { format, isToday, isTomorrow, differenceInDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { Badge } from "@/components/ui/badge";

export default function EventCard({ event, onClick }) {
  const eventDate = new Date(event.date);
  const daysUntil = differenceInDays(eventDate, new Date());
  
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
      className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 cursor-pointer"
    >
      <div className="flex gap-4">
        <div className="flex-shrink-0 w-14 h-14 rounded-xl bg-indigo-100 flex flex-col items-center justify-center">
          <span className="text-xs font-medium text-indigo-600 uppercase">
            {format(eventDate, 'MMM', { locale: es })}
          </span>
          <span className="text-xl font-bold text-indigo-700">
            {format(eventDate, 'd')}
          </span>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            {(isToday(eventDate) || isTomorrow(eventDate)) && (
              <Badge className="bg-amber-100 text-amber-800 text-xs">
                {getDateLabel()}
              </Badge>
            )}
          </div>
          <h3 className="font-semibold text-slate-800">{event.title}</h3>
          <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-500">
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