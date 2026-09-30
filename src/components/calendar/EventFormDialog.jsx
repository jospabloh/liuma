import React, { useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from 'sonner';
import { schoolToday } from '@/lib/dates';
import { Switch } from "@/components/ui/switch";
import { guardedCreate, guardedUpdate } from '@/lib/authorization/guardedWrite';
import { humanizeError } from '@/lib/errorMessages';
import FieldError from '@/components/forms/FieldError';
import { cn } from '@/lib/utils';
import {
  EVENT_FIELD_ORDER,
  INVALID_FIELD_CLASS,
  firstErrorField,
  hasErrors,
  validateEventForm,
} from '@/lib/forms/directorForms';

export default function EventFormDialog({ isOpen, onClose, event, schoolId, classrooms }) {
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState({});
  const fieldRefs = useRef({});
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    date: schoolToday(),
    time: '',
    end_time: '',
    location: '',
    scope: 'SCHOOL',
    classroom_id: '',
    requires_confirmation: false,
    has_cost: false,
    cost_amount: '',
    cost_concept: '',
    confirmation_deadline: ''
  });

  useEffect(() => {
    setErrors({});
    if (event) {
      setFormData({
        title: event.title || '',
        description: event.description || '',
        date: event.date || schoolToday(),
        time: event.time || '',
        end_time: event.end_time || '',
        location: event.location || '',
        scope: event.scope || 'SCHOOL',
        classroom_id: event.classroom_id || '',
        requires_confirmation: event.requires_confirmation || false,
        has_cost: event.has_cost || false,
        cost_amount: event.cost_amount?.toString() || '',
        cost_concept: event.cost_concept || '',
        confirmation_deadline: event.confirmation_deadline || ''
      });
    } else {
      setFormData({
        title: '',
        description: '',
        date: schoolToday(),
        time: '',
        end_time: '',
        location: '',
        scope: 'SCHOOL',
        classroom_id: '',
        requires_confirmation: false,
        has_cost: false,
        cost_amount: '',
        cost_concept: '',
        confirmation_deadline: ''
      });
    }
  }, [event, isOpen]);

  const saveEventMutation = useMutation({
    mutationFn: async (data) => {
      // Event writes are platform-owner only under RLS: guardedEntityWrite
      // checks the caller is an ADMIN of this school (P10b).
      if (event) {
        return await guardedUpdate('Event', event.id, data);
      } else {
        return await guardedCreate('Event', { ...data, school_id: schoolId });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['events']);
      toast.success(event ? 'Evento actualizado' : 'Evento creado');
      onClose();
    },
    onError: (error) => {
      toast.error(humanizeError(error));
    },
  });

  // Field-level Spanish errors (QA 2026-09-30): the form used to lean on the
  // browser's own `required` tooltip, and accepted "Por salón" with no salón,
  // an end time before the start and a paid event with no amount.
  const handleSubmit = (e) => {
    e.preventDefault();
    const found = validateEventForm(formData);
    setErrors(found);
    if (hasErrors(found)) {
      fieldRefs.current[firstErrorField(found, EVENT_FIELD_ORDER)]?.focus?.();
      return;
    }

    const data = {
      ...formData,
      title: formData.title.trim(),
      classroom_id: formData.scope === 'CLASSROOM' ? formData.classroom_id : '',
      cost_amount: formData.has_cost ? Number(String(formData.cost_amount).trim()) : null,
    };

    saveEventMutation.mutate(data);
  };

  const update = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const fieldProps = (field) => ({
    id: `event-${field}`,
    ref: (el) => { fieldRefs.current[field] = el; },
    'aria-invalid': Boolean(errors[field]),
    'aria-describedby': errors[field] ? `event-${field}-error` : undefined,
  });
  const invalid = (field) => errors[field] && INVALID_FIELD_CLASS;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{event ? 'Editar Evento' : 'Nuevo Evento'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <Label htmlFor="event-title">Título *</Label>
            <Input
              {...fieldProps('title')}
              value={formData.title}
              onChange={(e) => update('title', e.target.value)}
              placeholder="Nombre del evento"
              className={cn(invalid('title'))}
            />
            <FieldError id="event-title-error" message={errors.title} />
          </div>

          <div>
            <Label htmlFor="event-description">Descripción</Label>
            <Textarea
              {...fieldProps('description')}
              value={formData.description}
              onChange={(e) => update('description', e.target.value)}
              placeholder="Detalles del evento"
              rows={3}
              className={cn(invalid('description'))}
            />
            <FieldError id="event-description-error" message={errors.description} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="event-date">Fecha *</Label>
              <Input
                {...fieldProps('date')}
                type="date"
                value={formData.date}
                onChange={(e) => update('date', e.target.value)}
                className={cn(invalid('date'))}
              />
              <FieldError id="event-date-error" message={errors.date} />
            </div>
            <div>
              <Label htmlFor="event-time">Hora inicio</Label>
              <Input
                {...fieldProps('time')}
                type="time"
                value={formData.time}
                onChange={(e) => update('time', e.target.value)}
                className={cn(invalid('time'))}
              />
              <FieldError id="event-time-error" message={errors.time} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="event-end_time">Hora fin</Label>
              <Input
                {...fieldProps('end_time')}
                type="time"
                value={formData.end_time}
                onChange={(e) => update('end_time', e.target.value)}
                className={cn(invalid('end_time'))}
              />
              <FieldError id="event-end_time-error" message={errors.end_time} />
            </div>
            <div>
              <Label htmlFor="event-location">Ubicación</Label>
              <Input
                {...fieldProps('location')}
                value={formData.location}
                onChange={(e) => update('location', e.target.value)}
                placeholder="Lugar"
                className={cn(invalid('location'))}
              />
              <FieldError id="event-location-error" message={errors.location} />
            </div>
          </div>

          <div>
            <Label>Alcance</Label>
            <Select
              value={formData.scope}
              onValueChange={(value) => {
                update('scope', value);
                if (errors.classroom_id) setErrors((prev) => ({ ...prev, classroom_id: undefined }));
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SCHOOL">Toda la escuela</SelectItem>
                <SelectItem value="CLASSROOM">Por salón</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {formData.scope === 'CLASSROOM' && (
            <div>
              <Label htmlFor="event-classroom_id">Salón *</Label>
              <Select value={formData.classroom_id} onValueChange={(value) => update('classroom_id', value)}>
                <SelectTrigger {...fieldProps('classroom_id')} className={cn(invalid('classroom_id'))}>
                  <SelectValue placeholder="Selecciona un salón" />
                </SelectTrigger>
                <SelectContent>
                  {classrooms.map(classroom => (
                    <SelectItem key={classroom.id} value={classroom.id}>
                      {classroom.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError id="event-classroom_id-error" message={errors.classroom_id} />
            </div>
          )}

          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label>¿Requiere confirmación de asistencia?</Label>
              <Switch
                checked={formData.requires_confirmation}
                onCheckedChange={(checked) => update('requires_confirmation', checked)}
              />
            </div>

            {formData.requires_confirmation && (
              <div>
                <Label htmlFor="event-confirmation_deadline">Fecha límite de confirmación</Label>
                <Input
                  {...fieldProps('confirmation_deadline')}
                  type="date"
                  max={formData.date || undefined}
                  value={formData.confirmation_deadline}
                  onChange={(e) => update('confirmation_deadline', e.target.value)}
                  className={cn(invalid('confirmation_deadline'))}
                />
                <FieldError id="event-confirmation_deadline-error" message={errors.confirmation_deadline} />
              </div>
            )}

            <div className="flex items-center justify-between">
              <Label>¿Tiene costo?</Label>
              <Switch
                checked={formData.has_cost}
                onCheckedChange={(checked) => update('has_cost', checked)}
              />
            </div>

            {formData.has_cost && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="event-cost_amount">Monto *</Label>
                  <Input
                    {...fieldProps('cost_amount')}
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    value={formData.cost_amount}
                    onChange={(e) => update('cost_amount', e.target.value)}
                    placeholder="0.00"
                    className={cn(invalid('cost_amount'))}
                  />
                  <FieldError id="event-cost_amount-error" message={errors.cost_amount} />
                </div>
                <div>
                  <Label htmlFor="event-cost_concept">Concepto</Label>
                  <Input
                    {...fieldProps('cost_concept')}
                    value={formData.cost_concept}
                    onChange={(e) => update('cost_concept', e.target.value)}
                    placeholder="Ej: Entrada"
                    className={cn(invalid('cost_concept'))}
                  />
                  <FieldError id="event-cost_concept-error" message={errors.cost_concept} />
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saveEventMutation.isPending}>
              {saveEventMutation.isPending ? 'Guardando...' : (event ? 'Actualizar' : 'Crear Evento')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}