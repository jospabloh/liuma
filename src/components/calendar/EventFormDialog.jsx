import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from 'sonner';
import { format } from 'date-fns';

export default function EventFormDialog({ isOpen, onClose, event, schoolId, classrooms }) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    time: '',
    end_time: '',
    location: '',
    scope: 'SCHOOL',
    classroom_id: ''
  });

  useEffect(() => {
    if (event) {
      setFormData({
        title: event.title || '',
        description: event.description || '',
        date: event.date || format(new Date(), 'yyyy-MM-dd'),
        time: event.time || '',
        end_time: event.end_time || '',
        location: event.location || '',
        scope: event.scope || 'SCHOOL',
        classroom_id: event.classroom_id || ''
      });
    } else {
      setFormData({
        title: '',
        description: '',
        date: format(new Date(), 'yyyy-MM-dd'),
        time: '',
        end_time: '',
        location: '',
        scope: 'SCHOOL',
        classroom_id: ''
      });
    }
  }, [event, isOpen]);

  const saveEventMutation = useMutation({
    mutationFn: async (data) => {
      if (event) {
        return await base44.entities.Event.update(event.id, data);
      } else {
        return await base44.entities.Event.create({ ...data, school_id: schoolId });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['events']);
      toast.success(event ? 'Evento actualizado' : 'Evento creado');
      onClose();
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.title || !formData.date) {
      toast.error('El título y la fecha son obligatorios');
      return;
    }
    saveEventMutation.mutate(formData);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{event ? 'Editar Evento' : 'Nuevo Evento'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Título *</Label>
            <Input
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Nombre del evento"
              required
            />
          </div>

          <div>
            <Label>Descripción</Label>
            <Textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Detalles del evento"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Fecha *</Label>
              <Input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                required
              />
            </div>
            <div>
              <Label>Hora inicio</Label>
              <Input
                type="time"
                value={formData.time}
                onChange={(e) => setFormData({ ...formData, time: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Hora fin</Label>
              <Input
                type="time"
                value={formData.end_time}
                onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
              />
            </div>
            <div>
              <Label>Ubicación</Label>
              <Input
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                placeholder="Lugar"
              />
            </div>
          </div>

          <div>
            <Label>Alcance</Label>
            <Select value={formData.scope} onValueChange={(value) => setFormData({ ...formData, scope: value })}>
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
              <Label>Salón</Label>
              <Select value={formData.classroom_id} onValueChange={(value) => setFormData({ ...formData, classroom_id: value })}>
                <SelectTrigger>
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
            </div>
          )}

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