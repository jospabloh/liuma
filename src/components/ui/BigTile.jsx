import React from 'react';
import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';

export default function BigTile({ 
  icon: Icon, 
  title, 
  subtitle, 
  badge, 
  badgeColor = 'bg-red-500',
  href,
  onClick,
  color = 'from-slate-50 to-white',
  iconColor = 'text-indigo-600',
  delay = 0
}) {
  const content = (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.98 }}
      className={`relative bg-gradient-to-br ${color} rounded-2xl p-6 shadow-sm border border-slate-100 cursor-pointer overflow-hidden group`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className={`w-14 h-14 rounded-xl bg-white shadow-sm flex items-center justify-center ${iconColor}`}>
            <Icon className="w-7 h-7" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
            {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {badge !== undefined && badge > 0 && (
            <span className={`${badgeColor} text-white text-xs font-bold px-2.5 py-1 rounded-full min-w-[24px] text-center`}>
              {badge}
            </span>
          )}
          <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-slate-500 transition-colors" />
        </div>
      </div>
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
    </motion.div>
  );

  if (href) {
    return <Link to={href}>{content}</Link>;
  }
  
  return <div onClick={onClick}>{content}</div>;
}