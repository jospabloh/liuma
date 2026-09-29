import React from 'react';
import { Badge } from '@/components/ui/badge';
import {
  SUPPORT_STATUS,
  SUPPORT_PRIORITIES,
  SUPPORT_CATEGORIES,
} from '@/lib/support/constants';

export const STATUS_LABELS = {
  [SUPPORT_STATUS.OPEN]: 'Abierto',
  [SUPPORT_STATUS.AI_RESOLVED]: 'Resuelto por Lumi',
  [SUPPORT_STATUS.ESCALATED]: 'Escalado',
  [SUPPORT_STATUS.IN_PROGRESS]: 'En proceso',
  [SUPPORT_STATUS.WAITING_USER]: 'Esperando tu respuesta',
  [SUPPORT_STATUS.RESOLVED]: 'Resuelto',
  [SUPPORT_STATUS.CLOSED]: 'Cerrado',
};

const STATUS_COLORS = {
  [SUPPORT_STATUS.OPEN]: 'bg-muted text-muted-foreground',
  [SUPPORT_STATUS.AI_RESOLVED]: 'bg-brand/10 text-brand',
  [SUPPORT_STATUS.ESCALATED]: 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300',
  [SUPPORT_STATUS.IN_PROGRESS]: 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300',
  [SUPPORT_STATUS.WAITING_USER]: 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300',
  [SUPPORT_STATUS.RESOLVED]: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300',
  [SUPPORT_STATUS.CLOSED]: 'bg-muted text-muted-foreground',
};

export const PRIORITY_LABELS = {
  [SUPPORT_PRIORITIES.LOW]: 'Baja',
  [SUPPORT_PRIORITIES.NORMAL]: 'Normal',
  [SUPPORT_PRIORITIES.HIGH]: 'Alta',
  [SUPPORT_PRIORITIES.URGENT]: 'Urgente',
};

const PRIORITY_COLORS = {
  [SUPPORT_PRIORITIES.LOW]: 'bg-muted text-muted-foreground',
  [SUPPORT_PRIORITIES.NORMAL]: 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300',
  [SUPPORT_PRIORITIES.HIGH]: 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300',
  [SUPPORT_PRIORITIES.URGENT]: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300',
};

export const CATEGORY_LABELS = {
  [SUPPORT_CATEGORIES.ACADEMIC]: 'Académico (tareas, asistencia, avisos)',
  [SUPPORT_CATEGORIES.PAYMENTS]: 'Pagos y cargos',
  [SUPPORT_CATEGORIES.ACCOUNT]: 'Cuenta y vinculación de alumnos',
  [SUPPORT_CATEGORIES.TECHNICAL]: 'Problema técnico de la app',
  [SUPPORT_CATEGORIES.FEATURE]: 'Sugerencia o nueva funcionalidad',
  [SUPPORT_CATEGORIES.BILLING]: 'Suscripción / facturación LIUMA',
  [SUPPORT_CATEGORIES.OTHER]: 'Otro',
};

export function SupportStatusBadge({ status }) {
  return (
    <Badge className={`${STATUS_COLORS[status] || STATUS_COLORS.OPEN} border-0 font-medium`}>
      {STATUS_LABELS[status] || status}
    </Badge>
  );
}

export function SupportPriorityBadge({ priority }) {
  return (
    <Badge className={`${PRIORITY_COLORS[priority] || PRIORITY_COLORS.NORMAL} border-0 font-medium`}>
      {PRIORITY_LABELS[priority] || priority}
    </Badge>
  );
}
