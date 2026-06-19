import React from 'react';
import { motion } from 'framer-motion';
import { Calendar, User, Paperclip } from 'lucide-react';
import { format, isToday, isTomorrow, isPast } from 'date-fns';
import { es } from 'date-fns/locale';
import { Badge } from "@/components/ui/badge";

export default function HomeworkCard({ homework, onClick }) {
  const dueDate = new Date(homework.due_date);
  const isOverdue = isPast(dueDate) && !isToday(dueDate);
  
  const getDueDateLabel = () => {
    if (isToday(dueDate)) return 'Hoy';
    if (isTomorrow(dueDate)) return 'Mañana';
    return format(dueDate, "EEEE d 'de' MMMM", { locale: es });
  };
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`bg-card text-card-foreground rounded-xl p-4 shadow-sm border cursor-pointer ${
        isOverdue ? 'border-red-200 bg-red-50' : 'border-border'
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          {homework.subject && (
            <Badge variant="secondary" className="bg-brand/10 text-brand">
              {homework.subject}
            </Badge>
          )}
          {isToday(dueDate) && (
            <Badge className="bg-amber-100 text-amber-800">Hoy</Badge>
          )}
          {isOverdue && (
            <Badge className="bg-red-100 text-red-800">Vencida</Badge>
          )}
        </div>
      </div>
      
      <h3 className="font-semibold text-card-foreground mb-1">{homework.title}</h3>

      {homework.description && (
        <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{homework.description}</p>
      )}

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className={`flex items-center gap-1 ${isOverdue ? 'text-red-600 font-medium' : ''}`}>
          <Calendar className="w-3 h-3" />
          {getDueDateLabel()}
        </span>
        {homework.teacher_name && (
          <span className="flex items-center gap-1">
            <User className="w-3 h-3" />
            {homework.teacher_name}
          </span>
        )}
        {homework.attachments?.length > 0 && (
          <span className="flex items-center gap-1">
            <Paperclip className="w-3 h-3" />
            {homework.attachments.length}
          </span>
        )}
      </div>
    </motion.div>
  );
}