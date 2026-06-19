import React from 'react';
import { motion } from 'framer-motion';
import { Calendar, User } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { PriorityBadge } from '@/components/ui/StatusBadge';

const priorityStyles = {
  URGENT: 'border-l-4 border-l-red-500 bg-red-50',
  IMPORTANT: 'border-l-4 border-l-amber-500 bg-amber-50',
  NORMAL: 'border-l-4 border-l-blue-500 bg-card',
};

export default function NoticeCard({ notice, onClick }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`rounded-xl p-4 shadow-sm cursor-pointer ${priorityStyles[notice.priority] || priorityStyles.NORMAL}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <PriorityBadge priority={notice.priority} />
            {notice.is_emergency && (
              <span className="text-xs font-bold text-red-600 uppercase animate-pulse">
                ⚠️ Emergencia
              </span>
            )}
          </div>
          <h3 className="font-semibold text-card-foreground mb-1">{notice.title}</h3>
          <p className="text-sm text-muted-foreground line-clamp-2">{notice.content}</p>
          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {format(new Date(notice.created_date), "d MMM, HH:mm", { locale: es })}
            </span>
            {notice.author_name && (
              <span className="flex items-center gap-1">
                <User className="w-3 h-3" />
                {notice.author_name}
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}