import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { schoolRead } from '@/lib/data/schoolRead';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { motion } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { Phone, Plus, User, Shield, Loader2, Trash2 } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { createPageUrl } from '@/utils';
import { toast } from "sonner";
import { familyCreate, familyDelete, familyUpdate } from '@/lib/authorization/familyWrite';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function ContactosEmergencia() {
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(window.location.search);
  const studentId = urlParams.get('studentId');
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    relationship: '',
    phone: '',
    is_authorized_pickup: false,
    notes: '',
  });

  const { userProfile } = useCurrentProfile();
  // Solo la dirección autoriza quién puede recoger a un alumno; el servidor
  // (guardedFamilyWrite) ignora el campo si lo manda alguien más.
  const canAuthorizePickup = userProfile?.app_role === 'ADMIN';

  const { data: student } = useQuery({
    queryKey: ['student', studentId],
    queryFn: async () => {
      const students = await schoolRead('Student', { id: studentId });
      return students[0];
    },
    enabled: !!studentId,
  });

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ['emergencyContacts', studentId],
    queryFn: () => schoolRead('EmergencyContact', { student_id: studentId }),
    enabled: !!studentId,
  });

  const createContactMutation = useMutation({
    mutationFn: (data) => familyCreate('EmergencyContact', data),
    onSuccess: () => {
      queryClient.invalidateQueries(['emergencyContacts']);
      toast.success('Contacto agregado');
      setShowForm(false);
      setFormData({
        name: '',
        relationship: '',
        phone: '',
        is_authorized_pickup: false,
        notes: '',
      });
    },
    onError: () => {
      toast.error('Error al agregar contacto');
    }
  });

  const deleteContactMutation = useMutation({
    mutationFn: (contactId) => familyDelete('EmergencyContact', contactId),
    onSuccess: () => {
      queryClient.invalidateQueries(['emergencyContacts']);
      toast.success('Contacto eliminado');
    },
    onError: () => {
      toast.error('No se pudo eliminar el contacto');
    },
  });

  // La dirección confirma (o retira) la autorización de recoger sobre un
  // contacto que ya existe — p. ej. uno que agregó un padre.
  const togglePickupMutation = useMutation({
    mutationFn: ({ contactId, authorized }) =>
      familyUpdate('EmergencyContact', contactId, { is_authorized_pickup: authorized }),
    onSuccess: (_result, { authorized }) => {
      queryClient.invalidateQueries(['emergencyContacts']);
      toast.success(authorized ? 'Autorizado para recoger' : 'Autorización retirada');
    },
    onError: () => {
      toast.error('No se pudo actualizar la autorización');
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    // La escuela la deduce el servidor a partir del alumno.
    createContactMutation.mutate({
      ...formData,
      is_authorized_pickup: canAuthorizePickup ? formData.is_authorized_pickup : false,
      student_id: studentId,
    });
  };

  if (isLoading) return <LoadingScreen message="Cargando..." />;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 pb-24">
      <PageHeader
        title="Contactos de emergencia"
        subtitle={student ? `${student.first_name} ${student.last_name}` : ''}
        showBack
        backTo={createPageUrl('MisHijos')}
        action={
          <Button onClick={() => setShowForm(true)} className="gap-1">
            <Plus className="w-4 h-4" /> Agregar
          </Button>
        }
      />

      {contacts.length === 0 ? (
        <EmptyState
          icon={Phone}
          title="Sin contactos de emergencia"
          description="Agrega contactos para casos de emergencia."
          action={
            <Button onClick={() => setShowForm(true)}>
              <Plus className="w-4 h-4 mr-1" /> Agregar contacto
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {contacts.map((contact, index) => (
            <motion.div
              key={contact.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="bg-card text-card-foreground border border-border rounded-2xl shadow-sm p-4"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center">
                    <User className="w-5 h-5 text-brand" />
                  </div>
                  <div>
                    <h3 className="font-medium text-card-foreground">{contact.name}</h3>
                    <p className="text-sm text-muted-foreground">{contact.relationship}</p>
                    <a
                      href={`tel:${contact.phone}`}
                      className="flex items-center gap-1 text-brand font-medium mt-1"
                    >
                      <Phone className="w-4 h-4" />
                      {contact.phone}
                    </a>
                    {canAuthorizePickup ? (
                      <div className="flex items-center gap-2 mt-2">
                        <Switch
                          id={`pickup-${contact.id}`}
                          checked={!!contact.is_authorized_pickup}
                          disabled={togglePickupMutation.isPending}
                          onCheckedChange={(checked) =>
                            togglePickupMutation.mutate({ contactId: contact.id, authorized: checked })
                          }
                        />
                        <Label htmlFor={`pickup-${contact.id}`} className="text-sm cursor-pointer">
                          Autorizado para recoger
                        </Label>
                      </div>
                    ) : contact.is_authorized_pickup && (
                      <Badge className="mt-2 bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300 gap-1">
                        <Shield className="w-3 h-3" /> Autorizado para recoger
                      </Badge>
                    )}
                    {contact.notes && (
                      <p className="text-sm text-muted-foreground mt-2">{contact.notes}</p>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Eliminar contacto"
                  onClick={() => deleteContactMutation.mutate(contact.id)}
                  disabled={deleteContactMutation.isPending}
                  className="text-red-500 hover:text-red-700 hover:bg-red-50"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Add Contact Modal */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar contacto de emergencia</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Nombre completo *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Nombre del contacto"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Relación *</Label>
              <Input
                value={formData.relationship}
                onChange={(e) => setFormData({ ...formData, relationship: e.target.value })}
                placeholder="Ej: Tío, Vecino, Amigo..."
                className="mt-1"
              />
            </div>
            <div>
              <Label>Teléfono *</Label>
              <Input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="10 dígitos"
                className="mt-1"
              />
            </div>
            {canAuthorizePickup ? (
              <div className="flex items-center gap-3 bg-muted rounded-xl p-4">
                <Switch
                  checked={formData.is_authorized_pickup}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_authorized_pickup: checked })}
                  id="authorized-pickup"
                />
                <Label htmlFor="authorized-pickup" className="cursor-pointer">
                  <span className="font-medium">Autorizado para recoger</span>
                  <p className="text-sm text-muted-foreground">Esta persona puede recoger al alumno de la escuela</p>
                </Label>
              </div>
            ) : (
              <div className="flex items-start gap-3 bg-muted rounded-xl p-4">
                <Shield className="w-4 h-4 mt-0.5 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">
                  Quién puede recoger al alumno lo autoriza la dirección de la escuela. Si esta persona
                  debe poder recogerlo, avísale a la escuela después de agregarla.
                </p>
              </div>
            )}
            <div>
              <Label>Notas (opcional)</Label>
              <Input
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Información adicional..."
                className="mt-1"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)} className="flex-1">
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={!formData.name || !formData.relationship || !formData.phone || createContactMutation.isPending}
                className="flex-1"
              >
                {createContactMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Agregar'
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}