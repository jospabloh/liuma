import React from 'react';
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, AlertCircle, Bell, CheckCircle, Clock, XCircle } from 'lucide-react';

const priorityConfig = {
  URGENT: { color: 'bg-red-100 text-red-800 border-red-200', icon: AlertTriangle },
  IMPORTANT: { color: 'bg-amber-100 text-amber-800 border-amber-200', icon: AlertCircle },
  NORMAL: { color: 'bg-blue-100 text-blue-800 border-blue-200', icon: Bell },
};

const statusConfig = {
  PENDING: { color: 'bg-amber-100 text-amber-800', icon: Clock },
  ACTIVE: { color: 'bg-green-100 text-green-800', icon: CheckCircle },
  SUSPENDED: { color: 'bg-red-100 text-red-800', icon: XCircle },
  PAID: { color: 'bg-green-100 text-green-800', icon: CheckCircle },
  OVERDUE: { color: 'bg-red-100 text-red-800', icon: AlertTriangle },
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