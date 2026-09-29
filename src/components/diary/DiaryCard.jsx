import React from 'react';
import { motion } from 'framer-motion';
import { Calendar, User, Smile, Frown, Meh, BookOpen, Utensils, Moon } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Badge } from "@/components/ui/badge";
import { parseLocalDate } from '@/lib/dates';

const moodIcons = {
  feliz: { icon: Smile, color: 'text-green-500' },
  tranquilo: { icon: Meh, color: 'text-blue-500' },
  cansado: { icon: Moon, color: 'text-purple-500' },
  inquieto: { icon: Meh, color: 'text-amber-500' },
  triste: { icon: Frown, color: 'text-red-500' },
};

const behaviorLabels = {
  excelente: { label: 'Excelente', color: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300' },
  bueno: { label: 'Bueno', color: 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300' },
  regular: { label: 'Regular', color: 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300' },
  necesita_apoyo: { label: 'Necesita apoyo', color: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300' },
};

export default function DiaryCard({ entry, studentName, onClick }) {
  const MoodIcon = entry.mood ? moodIcons[entry.mood]?.icon || Meh : Meh;
  const moodColor = entry.mood ? moodIcons[entry.mood]?.color || 'text-muted-foreground' : 'text-muted-foreground';
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="bg-card text-card-foreground rounded-xl p-4 shadow-sm border border-border cursor-pointer"
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          {studentName && (
            <h3 className="font-semibold text-card-foreground">{studentName}</h3>
          )}
          <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
            <Calendar className="w-3 h-3" />
            {parseLocalDate(entry.date) ? format(parseLocalDate(entry.date), "EEEE d 'de' MMMM", { locale: es }) : 'Sin fecha'}
          </div>
        </div>
        <MoodIcon className={`w-6 h-6 ${moodColor}`} />
      </div>
      
      <p className="text-card-foreground text-sm mb-3 line-clamp-3">{entry.notes_text}</p>
      
      {entry.teacher_message && (
        <div className="bg-gradient-to-r from-pink-50 dark:from-pink-950/40 to-purple-50 dark:to-purple-950/40 rounded-lg p-2 mb-2 border border-pink-200 dark:border-pink-900">
          <p className="text-xs font-semibold text-pink-800 dark:text-pink-300">💌 Mensajito especial</p>
          <p className="text-xs text-purple-700 dark:text-purple-300 line-clamp-2">{entry.teacher_message}</p>
        </div>
      )}
      
      <div className="flex flex-wrap gap-2">
        {entry.behavior && (
          <Badge className={behaviorLabels[entry.behavior]?.color || 'bg-muted'}>
            {behaviorLabels[entry.behavior]?.label || entry.behavior}
          </Badge>
        )}
        {entry.food && (
          <Badge variant="outline" className="gap-1">
            <Utensils className="w-3 h-3" />
            {entry.food === 'todo' ? 'Comió todo' : 
             entry.food === 'casi_todo' ? 'Casi todo' :
             entry.food === 'poco' ? 'Poco' : 'No comió'}
          </Badge>
        )}
        {entry.learning && (
          <Badge variant="outline" className="gap-1">
            <BookOpen className="w-3 h-3" />
            {behaviorLabels[entry.learning]?.label || entry.learning}
          </Badge>
        )}
      </div>
      
      {entry.teacher_name && (
        <div className="flex items-center gap-1 mt-3 text-xs text-muted-foreground">
          <User className="w-3 h-3" />
          {entry.teacher_name}
        </div>
      )}
    </motion.div>
  );
}