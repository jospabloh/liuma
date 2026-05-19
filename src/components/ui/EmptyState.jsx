import React from 'react';
import { motion } from 'framer-motion';

export default function EmptyState({ 
  icon: Icon, 
  title, 
  description,
  action 
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-12 px-6 text-center space-y-2"
    >
      {Icon && (
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-2">
          <Icon className="w-8 h-8 text-muted-foreground" />
        </div>
      )}
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      {description && <p className="text-sm text-muted-foreground max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </motion.div>
  );
}
