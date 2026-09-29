import React from 'react';
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, AlertCircle, Bell, CheckCircle, Clock, XCircle } from 'lucide-react';

const priorityConfig = {
  URGENT: { color: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 border-red-200 dark:border-red-900', icon: AlertTriangle },
  IMPORTANT: { color: 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-900', icon: AlertCircle },
  NORMAL: { color: 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-900', icon: Bell },
};

const statusConfig = {
  PENDING: { color: 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300', icon: Clock },
  ACTIVE: { color: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300', icon: CheckCircle },
  SUSPENDED: { color: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300', icon: XCircle },
  PAID: { color: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300', icon: CheckCircle },
  OVERDUE: { color: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300', icon: AlertTriangle },
};

export function PriorityBadge({ priority }) {
  const config = priorityConfig[priority] || priorityConfig.NORMAL;
  const Icon = config.icon;
  
  return (
    <Badge className={`${config.color} border font-medium gap-1`}>
      <Icon className="w-3 h-3" />
      {priority === 'URGENT' ? 'Urgente' : priority === 'IMPORTANT' ? 'Importante' : 'Normal'}
    </Badge>
  );
}

export function StatusBadge({ status }) {
  const config = statusConfig[status] || statusConfig.PENDING;
  const Icon = config.icon;
  
  const labels = {
    PENDING: 'Pendiente',
    ACTIVE: 'Activo',
    SUSPENDED: 'Suspendido',
    PAID: 'Pagado',
    OVERDUE: 'Vencido',
  };
  
  return (
    <Badge className={`${config.color} font-medium gap-1`}>
      <Icon className="w-3 h-3" />
      {labels[status] || status}
    </Badge>
  );
}