import React, { useState } from 'react';
import { schoolRead } from '@/lib/data/schoolRead';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Percent, Plus, Trash2, Edit } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import ReadOnlyBanner from '@/components/subscription/ReadOnlyBanner';
import { useCanWrite, guardWrite } from '@/hooks/useCanWrite';
import { guardedCreate, guardedUpdate, guardedDelete } from '@/lib/authorization/guardedWrite';
import { DISCOUNT_FIELD_ERRORS, formatMoney, validateDiscount } from '@/lib/payments/money';

// The fields that make up what a discount takes off — the ones
// validateDiscount checks. Same list as guardedEntityWrite/_schoolWrite.ts's
// DISCOUNT_TERMS.
const DISCOUNT_TERMS = ['discount_type', 'discount_value', 'valid_from', 'valid_until', 'applicable_to_concepts'];
// '' / undefined / null / [] all mean "not set"; a stored number and the
// form's Number() of it compare equal.
const termValue = (value) =>
  (value === '' || value === undefined || (Array.isArray(value) && value.length === 0) ? null : value);

export default function GestionDescuentos() {
  const { canWrite } = useCanWrite();
  const [showForm, setShowForm] = useState(false);
  const [editingDiscount, setEditingDiscount] = useState(null);
  const [formError, setFormError] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    discount_type: 'PERCENTAGE',
    discount_value: '',
    applicable_to_concepts: [],
    is_active: true,
    valid_from: '',
    valid_until: '',
  });

  const queryClient = useQueryClient();

  const { userProfile, isLoading: profileLoading } = useCurrentProfile();

  const { data: discounts, isLoading } = useQuery({
    queryKey: ['discounts', userProfile?.school_id],
    queryFn: () => schoolRead('Discount', { school_id: userProfile.school_id }, '-created_date'),
    enabled: !!userProfile?.school_id,
  });

  const createDiscountMutation = useMutation({
    mutationFn: (data) => guardedCreate('Discount', {
      ...data,
      school_id: userProfile.school_id,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discounts'] });
      toast.success('Descuento creado');
      resetForm();
    },
  });

  const updateDiscountMutation = useMutation({
    mutationFn: ({ id, data }) => guardedUpdate('Discount', id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discounts'] });
      toast.success('Descuento actualizado');
      resetForm();
    },
  });

  const deleteDiscountMutation = useMutation({
    mutationFn: (id) => guardedDelete('Discount', id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discounts'] });
      toast.success('Descuento eliminado');
    },
  });

  const resetForm = () => {
    setShowForm(false);
    setEditingDiscount(null);
    setFormError(null);
    setFormData({
      name: '',
      description: '',
      discount_type: 'PERCENTAGE',
      discount_value: '',
      applicable_to_concepts: [],
      is_active: true,
      valid_from: '',
      valid_until: '',
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!guardWrite(canWrite, () => toast.error('Tu licencia está en modo solo lectura. Reactívala para gestionar descuentos.'))) return;

    const data = {
      ...formData,
      name: formData.name.trim(),
      discount_value: Number(formData.discount_value),
      valid_from: formData.valid_from || null,
      valid_until: formData.valid_until || null,
    };
    // Same rule the server enforces (guardedEntityWrite → validateDiscount):
    // a percentage in (0, 100], a fixed amount above 0 in whole cents, at
    // least one concept type, and "hasta" not before "desde". A 150 % or a
    // -10 % discount used to be saved as typed.
    // On an edit that leaves the terms as they were (renaming it, switching
    // it off), the terms are not re-sent and not re-checked — the server
    // skips the check the same way — so a discount saved malformed before
    // this rule existed can still be deactivated without fixing it first.
    const termsChanged = !editingDiscount || DISCOUNT_TERMS.some(
      (field) => JSON.stringify(termValue(data[field])) !== JSON.stringify(termValue(editingDiscount[field])),
    );
    if (termsChanged) {
      const check = validateDiscount(data);
      if (!check.ok) {
        setFormError(check.field);
        return;
      }
    }
    setFormError(null);

    if (editingDiscount) {
      const patch = { ...data };
      if (!termsChanged) DISCOUNT_TERMS.forEach((field) => { delete patch[field]; });
      updateDiscountMutation.mutate({ id: editingDiscount.id, data: patch });
    } else {
      createDiscountMutation.mutate(data);
    }
  };

  const handleEdit = (discount) => {
    setEditingDiscount(discount);
    setFormData({
      name: discount.name,
      description: discount.description || '',
      discount_type: discount.discount_type,
      discount_value: discount.discount_value.toString(),
      applicable_to_concepts: discount.applicable_to_concepts || [],
      is_active: discount.is_active,
      valid_from: discount.valid_from || '',
      valid_until: discount.valid_until || '',
    });
    setShowForm(true);
  };

  const toggleConcept = (concept) => {
    const current = formData.applicable_to_concepts;
    if (current.includes(concept)) {
      setFormData({
        ...formData,
        applicable_to_concepts: current.filter(c => c !== concept)
      });
    } else {
      setFormData({
        ...formData,
        applicable_to_concepts: [...current, concept]
      });
    }
  };

  const conceptLabels = {
    INSCRIPCION: 'Inscripción',
    COLEGIATURA: 'Colegiatura',
    HORARIO_EXTENDIDO: 'Horario extendido',
    EVENTO: 'Eventos',
    OTRO: 'Otros',
  };

  if (profileLoading || isLoading) {
    return <LoadingScreen message="Cargando descuentos..." />;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 pb-24">
        <ReadOnlyBanner />
        <PageHeader
          title="Gestión de descuentos"
          subtitle="Configura descuentos para pagos escolares"
          showBack
          action={
            <Dialog open={showForm} onOpenChange={(open) => { if (!open) resetForm(); setShowForm(open); }}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Nuevo Descuento
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>{editingDiscount ? 'Editar' : 'Nuevo'} descuento</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <Label>Nombre del descuento</Label>
                    <Input
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Ej: Descuento por hermano"
                      required
                    />
                  </div>

                  <div>
                    <Label>Descripción</Label>
                    <Textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="Descripción del descuento"
                      rows={2}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Tipo</Label>
                      <Select
                        value={formData.discount_type}
                        onValueChange={(value) => setFormData({ ...formData, discount_type: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="PERCENTAGE">Porcentaje</SelectItem>
                          <SelectItem value="FIXED_AMOUNT">Monto fijo</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>Valor</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0.01"
                        max={formData.discount_type === 'PERCENTAGE' ? '100' : undefined}
                        inputMode="decimal"
                        value={formData.discount_value}
                        onChange={(e) => setFormData({ ...formData, discount_value: e.target.value })}
                        placeholder={formData.discount_type === 'PERCENTAGE' ? '10' : '100'}
                        aria-invalid={formError === 'discount_value'}
                        required
                      />
                    </div>
                  </div>

                  {formError === 'discount_value' && (
                    <p role="alert" className="text-xs text-destructive -mt-2">{DISCOUNT_FIELD_ERRORS.discount_value}</p>
                  )}

                  <div>
                    <Label className="mb-2 block">Aplica a conceptos:</Label>
                    <div className="space-y-2">
                      {Object.entries(conceptLabels).map(([key, label]) => (
                        <div key={key} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={formData.applicable_to_concepts.includes(key)}
                            onChange={() => toggleConcept(key)}
                            className="w-4 h-4"
                          />
                          <span className="text-sm">{label}</span>
                        </div>
                      ))}
                    </div>
                    {formError === 'applicable_to_concepts' && (
                      <p role="alert" className="text-xs text-destructive mt-1">{DISCOUNT_FIELD_ERRORS.applicable_to_concepts}</p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Válido desde</Label>
                      <Input
                        type="date"
                        value={formData.valid_from}
                        onChange={(e) => setFormData({ ...formData, valid_from: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>Válido hasta</Label>
                      <Input
                        type="date"
                        min={formData.valid_from || undefined}
                        value={formData.valid_until}
                        onChange={(e) => setFormData({ ...formData, valid_until: e.target.value })}
                        aria-invalid={formError === 'valid_until'}
                      />
                    </div>
                  </div>
                  {['valid_from', 'valid_until', 'discount_type'].includes(formError) && (
                    <p role="alert" className="text-xs text-destructive -mt-2">{DISCOUNT_FIELD_ERRORS[formError]}</p>
                  )}

                  <div className="flex items-center gap-2">
                    <Switch
                      checked={formData.is_active}
                      onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                    />
                    <Label>Descuento activo</Label>
                  </div>

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={createDiscountMutation.isPending || updateDiscountMutation.isPending}
                  >
                    {editingDiscount ? 'Actualizar' : 'Crear'} Descuento
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          }
        />

        <div className="space-y-4">
          {discounts?.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Percent className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No hay descuentos configurados</p>
              </CardContent>
            </Card>
          ) : (
            discounts?.map((discount) => (
              <motion.div
                key={discount.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <Card>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <CardTitle className="text-lg">{discount.name}</CardTitle>
                          {discount.is_active ? (
                            <Badge className="bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300">Activo</Badge>
                          ) : (
                            <Badge className="bg-muted text-muted-foreground">Inactivo</Badge>
                          )}
                        </div>
                        <CardDescription>
                          {discount.discount_type === 'PERCENTAGE' 
                            ? `${discount.discount_value}%` 
                            : formatMoney(discount.discount_value)} de descuento
                        </CardDescription>
                      </div>
                      <div className="flex gap-2">
                        <Button size="icon" variant="outline" aria-label="Editar descuento" onClick={() => handleEdit(discount)}>
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="outline"
                          aria-label="Eliminar descuento"
                          onClick={() => deleteDiscountMutation.mutate(discount.id)}
                        >
                          <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  {(discount.description || discount.applicable_to_concepts?.length > 0) && (
                    <CardContent className="space-y-2">
                      {discount.description && (
                        <p className="text-sm text-muted-foreground">{discount.description}</p>
                      )}
                      {discount.applicable_to_concepts?.length > 0 && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Aplica a:</p>
                          <div className="flex flex-wrap gap-1">
                            {discount.applicable_to_concepts.map(concept => (
                              <Badge key={concept} variant="outline" className="text-xs">
                                {conceptLabels[concept]}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  )}
                </Card>
              </motion.div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}