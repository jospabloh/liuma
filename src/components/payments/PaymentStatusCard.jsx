import React from 'react';
import { motion } from 'framer-motion';
import { CheckCircle, AlertTriangle, Clock } from 'lucide-react';
import { formatMoney } from '@/lib/payments/money';

const statusConfig = {
  'Al día': {
    icon: CheckCircle,
    color: 'bg-green-50 dark:bg-green-950/40 border-green-200 dark:border-green-900',
    iconColor: 'text-green-600 dark:text-green-400',
    textColor: 'text-green-700 dark:text-green-300',
  },
  'Próximo a vencer': {
    icon: Clock,
    color: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900',
    iconColor: 'text-amber-600 dark:text-amber-400',
    textColor: 'text-amber-700 dark:text-amber-300',
  },
  'Vencido': {
    icon: AlertTriangle,
    color: 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900',
    iconColor: 'text-red-600 dark:text-red-400',
    textColor: 'text-red-700 dark:text-red-300',
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
            <p className="font-bold text-foreground">{formatMoney(totalPending)}</p>
          )}
          {nextDueDate && (
            <p className="text-xs text-muted-foreground">Vence: {nextDueDate}</p>
          )}
        </div>
      </div>
    </motion.div>
  );
}