import React from 'react';
import { motion } from 'framer-motion';
import { Calendar, User, Smile, Frown, Meh, BookOpen, Utensils, Moon } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Badge } from "@/components/ui/badge";

const moodIcons = {
  feliz: { icon: Smile, color: 'text-green-500' },
  tranquilo: { icon: Meh, color: 'text-blue-500' },
  cansado: { icon: Moon, color: 'text-purple-500' },
  inquieto: { icon: Meh, color: 'text-amber-500' },
  triste: { icon: Frown, color: 'text-red-500' },
};

const behaviorLabels = {
  excelente: { label: 'Excelente', color: 'bg-green-100 text-green-800' },
  bueno: { label: 'Bueno', color: 'bg-blue-100 text-blue-800' },
  regular: { label: 'Regular', color: 'bg-amber-100 text-amber-800' },
  necesita_apoyo: { label: 'Necesita apoyo', color: 'bg-red-100 text-red-800' },
};

export default function DiaryCard({ entry, studentName, onClick }) {
  const MoodIcon = entry.mood ? moodIcons[entry.mood]?.icon || Meh : Meh;
  const moodColor = entry.mood ? moodIcons[entry.mood]?.color || 'text-slate-400' : 'text-slate-400';
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 cursor-pointer"
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          {studentName && (
            <h3 className="font-semibold text-slate-800">{studentName}</h3>
          )}
          <div className="flex items-center gap-2 text-sm text-slate-500 mt-1">
            <Calendar className="w-3 h-3" />
            {format(new Date(entry.date), "EEEE d 'de' MMMM", { locale: es })}
          </div>
        </div>
        <MoodIcon className={`w-6 h-6 ${moodColor}`} />
      </div>
      
      <p className="text-slate-700 text-sm mb-3 line-clamp-3">{entry.notes_text}</p>
      
      <div className="flex flex-wrap gap-2">
        {entry.behavior && (
          <Badge className={behaviorLabels[entry.behavior]?.color || 'bg-slate-100'}>
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
        <div className="flex items-center gap-1 mt-3 text-xs text-slate-500">
          <User className="w-3 h-3" />
          {entry.teacher_name}
        </div>
      )}
    </motion.div>
  );
}