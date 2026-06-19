import React from 'react';
import { motion } from 'framer-motion';
import { CheckCircle, AlertTriangle, Clock } from 'lucide-react';

const statusConfig = {
  'Al día': {
    icon: CheckCircle,
    color: 'bg-green-50 border-green-200',
    iconColor: 'text-green-600',
    textColor: 'text-green-700',
  },
  'Próximo a vencer': {
    icon: Clock,
    color: 'bg-amber-50 border-amber-200',
    iconColor: 'text-amber-600',
    textColor: 'text-amber-700',
  },
  'Vencido': {
    icon: AlertTriangle,
    color: 'bg-red-50 border-red-200',
    iconColor: 'text-red-600',
    textColor: 'text-red-700',
  },
};

export default function PaymentStatusCard({ 
  studentName, 
  status, 
  totalPending, 
  nextDueDate,
  onClick 
}) {
  const config = statusConfig[status] || statusConfig['Al día'];
  const Icon = config.icon;
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`rounded-xl p-4 border cursor-pointer ${config.color}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full bg-card flex items-center justify-center ${config.iconColor}`}>
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">{studentName}</h3>
            <p className={`text-sm font-medium ${config.textColor}`}>{status}</p>
          </div>
        </div>
        <div className="text-right">
          {totalPending > 0 && (
            <p className="font-bold text-foreground">${totalPending.toLocaleString()}</p>
          )}
          {nextDueDate && (
            <p className="text-xs text-muted-foreground">Vence: {nextDueDate}</p>
          )}
        </div>
      </div>
    </motion.div>
  );
}