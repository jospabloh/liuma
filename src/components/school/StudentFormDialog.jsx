import React, { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import FieldError from '@/components/forms/FieldError';
import { cn } from '@/lib/utils';
import { formatLocalDate } from '@/lib/dates';
import {
  BLOOD_TYPES,
  INVALID_FIELD_CLASS,
  MAX_LONG_TEXT,
  STUDENT_FIELD_ORDER,
  emptyStudentForm,
  firstErrorField,
  hasErrors,
  studentFormFromRecord,
  validateStudentForm,
} from '@/lib/forms/directorForms';

/**
 * "Nuevo alumno" and "Editar alumno" — one form, so the fields a director can
 * set when enrolling a child and the ones they can correct later never drift
 * apart. It includes the medical fields (tipo de sangre, alergias, notas
 * médicas): before this, no screen could write them, so MisHijos' "Alergias"
 * line never had anything to show (QA 2026-09-30).
 *
 * The dialog only collects and validates; the page does the write, through
 * guardedEntityWrite (guardedCreate / guardedUpdate 'Student'), which is
 * ADMIN-only on the server.
 *
 * Props: open, onOpenChange, mode ('create' | 'edit'), student (edit),
 * classrooms (every classroom of the school), isPending, onSubmit(form).
 */
export default function StudentFormDialog({ open, onOpenChange, mode = 'create', student = null, classrooms = [], isPending = false, onSubmit }) {
  const isEdit = mode === 'edit';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar alumno' : 'Nuevo alumno'}</DialogTitle>
          <DialogDescription>
            Los campos con * son obligatorios. Los datos médicos solo los ven la dirección, los maestros del salón y la familia del alumno.
          </DialogDescription>
        </DialogHeader>
        {/* Radix unmounts closed dialog content, so the body (and its state)
            is created fresh on every open: each edit starts from the stored
            record, never from a half-typed, cancelled one. */}
        <StudentFormBody
          isEdit={isEdit}
          student={student}
          classrooms={classrooms}
          isPending={isPending}
          onCancel={() => onOpenChange(false)}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

function StudentFormBody({ isEdit, student, classrooms, isPending, onCancel, onSubmit }) {
  const [form, setForm] = useState(() => (isEdit ? studentFormFromRecord(student) : emptyStudentForm()));
  const [errors, setErrors] = useState({});
  const fieldRefs = useRef({});

  // Active classrooms, plus the student's current one even if it has been
  // retired — otherwise the select would show blank and look unassigned.
  const options = classrooms.filter((c) => c.is_active || c.id === student?.classroom_id);
  const classroomIds = options.map((c) => c.id);
  // A blood type stored before this form existed may be free text ("O Rh+").
  // Keep it selectable so editing the allergies never forces it to change.
  const legacyBloodType = isEdit && student?.blood_type && !BLOOD_TYPES.includes(student.blood_type) ? student.blood_type : '';

  const update = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const found = validateStudentForm(form, { classroomIds, legacyBloodType });
    setErrors(found);
    if (hasErrors(found)) {
      const first = firstErrorField(found, STUDENT_FIELD_ORDER);
      fieldRefs.current[first]?.focus?.();
      return;
    }
    onSubmit(form);
  };

  const fieldProps = (field) => ({
    id: `student-${field}`,
    ref: (el) => { fieldRefs.current[field] = el; },
    'aria-invalid': Boolean(errors[field]),
    'aria-describedby': errors[field] ? `student-${field}-error` : undefined,
  });

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <Label htmlFor="student-first_name">Nombre *</Label>
        <Input
          {...fieldProps('first_name')}
          value={form.first_name}
          onChange={(e) => update('first_name', e.target.value)}
          placeholder="Nombre"
          autoComplete="off"
          className={cn('mt-1', errors.first_name && INVALID_FIELD_CLASS)}
        />
        <FieldError id="student-first_name-error" message={errors.first_name} />
      </div>
      <div>
        <Label htmlFor="student-last_name">Apellidos *</Label>
        <Input
          {...fieldProps('last_name')}
          value={form.last_name}
          onChange={(e) => update('last_name', e.target.value)}
          placeholder="Apellidos"
          autoComplete="off"
          className={cn('mt-1', errors.last_name && INVALID_FIELD_CLASS)}
        />
        <FieldError id="student-last_name-error" message={errors.last_name} />
      </div>
      <div>
        <Label htmlFor="student-classroom_id">Salón *</Label>
        <Select value={form.classroom_id} onValueChange={(value) => update('classroom_id', value)}>
          <SelectTrigger {...fieldProps('classroom_id')} className={cn('mt-1', errors.classroom_id && INVALID_FIELD_CLASS)}>
            <SelectValue placeholder="Seleccionar salón" />
          </SelectTrigger>
          <SelectContent>
            {options.map((classroom) => (
              <SelectItem key={classroom.id} value={classroom.id}>
                {classroom.name}{classroom.is_active ? '' : ' (inactivo)'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {options.length === 0 && (
          <p className="mt-1 text-sm text-muted-foreground">Primero crea un salón en la pestaña «Salones».</p>
        )}
        <FieldError id="student-classroom_id-error" message={errors.classroom_id} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="student-birth_date">Fecha de nacimiento</Label>
          <Input
            {...fieldProps('birth_date')}
            type="date"
            max={formatLocalDate()}
            value={form.birth_date}
            onChange={(e) => update('birth_date', e.target.value)}
            className={cn('mt-1', errors.birth_date && INVALID_FIELD_CLASS)}
          />
          <FieldError id="student-birth_date-error" message={errors.birth_date} />
        </div>
        <div>
          <Label htmlFor="student-blood_type">Tipo de sangre</Label>
          <select
            {...fieldProps('blood_type')}
            value={form.blood_type}
            onChange={(e) => update('blood_type', e.target.value)}
            className={cn('ui-field mt-1 w-full', errors.blood_type && INVALID_FIELD_CLASS)}
          >
            <option value="">Sin registrar</option>
            {legacyBloodType && <option value={legacyBloodType}>{legacyBloodType}</option>}
            {BLOOD_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <FieldError id="student-blood_type-error" message={errors.blood_type} />
        </div>
      </div>
      <div>
        <Label htmlFor="student-allergies">Alergias</Label>
        <Textarea
          {...fieldProps('allergies')}
          value={form.allergies}
          onChange={(e) => update('allergies', e.target.value)}
          placeholder="Ej: cacahuate, penicilina. Déjalo vacío si no tiene."
          rows={2}
          maxLength={MAX_LONG_TEXT}
          className={cn('mt-1', errors.allergies && INVALID_FIELD_CLASS)}
        />
        <FieldError id="student-allergies-error" message={errors.allergies} />
      </div>
      <div>
        <Label htmlFor="student-medical_notes">Notas médicas</Label>
        <Textarea
          {...fieldProps('medical_notes')}
          value={form.medical_notes}
          onChange={(e) => update('medical_notes', e.target.value)}
          placeholder="Padecimientos, medicamentos o indicaciones que el salón deba conocer."
          rows={3}
          maxLength={MAX_LONG_TEXT}
          className={cn('mt-1', errors.medical_notes && INVALID_FIELD_CLASS)}
        />
        <FieldError id="student-medical_notes-error" message={errors.medical_notes} />
      </div>
      <div className="flex gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
          Cancelar
        </Button>
        {/* Disabled only while saving: an empty required field is reported
            under the field, not by a grey button with no reason. */}
        <Button type="submit" disabled={isPending} className="flex-1">
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : isEdit ? 'Guardar cambios' : 'Agregar'}
        </Button>
      </div>
    </form>
  );
}
