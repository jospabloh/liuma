import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ShoppingBag, Plus, Trash2, Download } from 'lucide-react';
import { toast } from 'sonner';
import { getLinkedStudents } from '@/lib/relations/getLinkedStudents';
import { familyCreate } from '@/lib/authorization/familyWrite';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

export default function PedidosUniformes() {
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState('');
  const [orderItems, setOrderItems] = useState([{ product: '', size: '', quantity: 1 }]);
  const [measurements, setMeasurements] = useState({
    pecho: '',
    cintura: '',
    cadera: '',
    largo: '',
    estatura: '',
  });
  const [notes, setNotes] = useState('');

  const queryClient = useQueryClient();

  const { user, userProfile, isLoading: profileLoading } = useCurrentProfile();

  const { data: linkedStudents = { students: [], studentIds: [], orphanedLinkIds: [] } } = useQuery({
    queryKey: ['linkedStudents', user?.id],
    queryFn: () => getLinkedStudents(user),
    enabled: !!user,
  });

  const students = linkedStudents.students;

  const { data: catalog } = useQuery({
    queryKey: ['uniformCatalog', userProfile?.school_id],
    queryFn: async () => {
      const docs = await base44.entities.OfficialDocument.filter({
        school_id: userProfile.school_id,
        document_type: 'UNIFORM_CATALOG',
        is_current: true
      });
      return docs[0];
    },
    enabled: !!userProfile?.school_id,
  });

  const { data: orders, isLoading } = useQuery({
    queryKey: ['uniformOrders', user?.id],
    queryFn: () => base44.entities.UniformOrder.filter({ parent_id: user.id }, '-created_date'),
    enabled: !!user?.id,
  });

  const createOrderMutation = useMutation({
    // guardedFamilyWrite comprueba el vínculo con el alumno y fija escuela,
    // padre y estado del lado del servidor.
    mutationFn: (data) => familyCreate('UniformOrder', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['uniformOrders'] });
      toast.success('Pedido enviado exitosamente');
      setShowOrderForm(false);
      resetForm();
    },
    onError: () => {
      toast.error('Error al enviar el pedido');
    },
  });

  const resetForm = () => {
    setSelectedStudent('');
    setOrderItems([{ product: '', size: '', quantity: 1 }]);
    setMeasurements({ pecho: '', cintura: '', cadera: '', largo: '', estatura: '' });
    setNotes('');
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!selectedStudent) {
      toast.error('Selecciona un estudiante');
      return;
    }

    const validItems = orderItems.filter(item => item.product && item.size);
    if (validItems.length === 0) {
      toast.error('Agrega al menos un producto');
      return;
    }

    createOrderMutation.mutate({
      school_id: userProfile.school_id,
      student_id: selectedStudent,
      parent_id: user.id,
      parent_name: user.full_name,
      items: validItems,
      measurements,
      notes,
    });
  };

  const addItem = () => {
    setOrderItems([...orderItems, { product: '', size: '', quantity: 1 }]);
  };

  const removeItem = (index) => {
    setOrderItems(orderItems.filter((_, i) => i !== index));
  };

  const updateItem = (index, field, value) => {
    const newItems = [...orderItems];
    newItems[index][field] = value;
    setOrderItems(newItems);
  };

  const statusLabels = {
    PENDING: { label: 'Pendiente', color: 'bg-yellow-100 text-yellow-800' },
    PROCESSING: { label: 'En Proceso', color: 'bg-blue-100 text-blue-800' },
    READY: { label: 'Listo', color: 'bg-green-100 text-green-800' },
    DELIVERED: { label: 'Entregado', color: 'bg-muted text-muted-foreground' },
    CANCELLED: { label: 'Cancelado', color: 'bg-red-100 text-red-800' },
  };

  if (profileLoading || isLoading) {
    return <LoadingScreen message="Cargando pedidos..." />;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 pb-24">
        <PageHeader
          title="Pedidos de Uniformes"
          subtitle="Gestiona los pedidos de uniformes para tus hijos"
          showBack
        />

        {catalog && (
          <Card className="mb-6 bg-brand/10 border-brand/30">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-brand">Catálogo de Uniformes</CardTitle>
                  <CardDescription>Consulta tallas, precios y tiempos de entrega</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(catalog.file_url, '_blank')}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Ver Catálogo
                </Button>
              </div>
            </CardHeader>
          </Card>
        )}

        <div className="mb-6">
          <Dialog open={showOrderForm} onOpenChange={setShowOrderForm}>
            <DialogTrigger asChild>
              <Button className="w-full">
                <Plus className="w-4 h-4 mr-2" />
                Nuevo Pedido
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Nuevo Pedido de Uniforme</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label>Estudiante</Label>
                  <Select value={selectedStudent} onValueChange={setSelectedStudent}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona un estudiante" />
                    </SelectTrigger>
                    <SelectContent>
                      {students?.map((student) => (
                        <SelectItem key={student.id} value={student.id}>
                          {student.first_name} {student.last_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="border-t border-border pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-base">Productos</Label>
                    <Button type="button" size="sm" variant="outline" onClick={addItem}>
                      <Plus className="w-4 h-4 mr-1" />
                      Agregar
                    </Button>
                  </div>
                  {orderItems.map((item, index) => (
                    <div key={index} className="flex gap-2 mb-2">
                      <Input
                        placeholder="Producto (ej: Playera blanca)"
                        value={item.product}
                        onChange={(e) => updateItem(index, 'product', e.target.value)}
                        className="flex-1"
                      />
                      <Input
                        placeholder="Talla"
                        value={item.size}
                        onChange={(e) => updateItem(index, 'size', e.target.value)}
                        className="w-24"
                      />
                      <Input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => updateItem(index, 'quantity', parseInt(e.target.value))}
                        className="w-20"
                      />
                      {orderItems.length > 1 && (
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          aria-label="Quitar artículo"
                          onClick={() => removeItem(index)}
                        >
                          <Trash2 className="w-4 h-4 text-red-600" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>

                <div className="border-t border-border pt-4">
                  <Label className="text-base mb-2 block">Medidas (cm)</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-sm">Pecho</Label>
                      <Input
                        value={measurements.pecho}
                        onChange={(e) => setMeasurements({ ...measurements, pecho: e.target.value })}
                        placeholder="cm"
                      />
                    </div>
                    <div>
                      <Label className="text-sm">Cintura</Label>
                      <Input
                        value={measurements.cintura}
                        onChange={(e) => setMeasurements({ ...measurements, cintura: e.target.value })}
                        placeholder="cm"
                      />
                    </div>
                    <div>
                      <Label className="text-sm">Cadera</Label>
                      <Input
                        value={measurements.cadera}
                        onChange={(e) => setMeasurements({ ...measurements, cadera: e.target.value })}
                        placeholder="cm"
                      />
                    </div>
                    <div>
                      <Label className="text-sm">Largo</Label>
                      <Input
                        value={measurements.largo}
                        onChange={(e) => setMeasurements({ ...measurements, largo: e.target.value })}
                        placeholder="cm"
                      />
                    </div>
                    <div>
                      <Label className="text-sm">Estatura</Label>
                      <Input
                        value={measurements.estatura}
                        onChange={(e) => setMeasurements({ ...measurements, estatura: e.target.value })}
                        placeholder="cm"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <Label>Notas adicionales</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Especificaciones especiales, preferencias, etc."
                    rows={3}
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={createOrderMutation.isPending}
                >
                  Enviar Pedido
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="space-y-4">
          {orders?.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <ShoppingBag className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No tienes pedidos de uniformes</p>
                <p className="text-sm text-muted-foreground mt-1">Realiza tu primer pedido</p>
              </CardContent>
            </Card>
          ) : (
            orders?.map((order) => {
              const student = students?.find(s => s.id === order.student_id);
              return (
                <motion.div
                  key={order.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <Card>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-lg">
                            {student?.first_name} {student?.last_name}
                          </CardTitle>
                          <CardDescription>
                            {new Date(order.created_date).toLocaleDateString('es-MX')}
                          </CardDescription>
                        </div>
                        <Badge className={statusLabels[order.status].color}>
                          {statusLabels[order.status].label}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        <p className="font-medium text-sm text-card-foreground">Productos:</p>
                        <ul className="text-sm text-muted-foreground space-y-1">
                          {order.items.map((item, idx) => (
                            <li key={idx}>
                              • {item.product} - Talla {item.size} (x{item.quantity})
                            </li>
                          ))}
                        </ul>
                        {order.notes && (
                          <div className="mt-3 pt-3 border-t border-border">
                            <p className="text-xs text-muted-foreground">Notas: {order.notes}</p>
                          </div>
                        )}
                        {order.admin_notes && (
                          <div className="mt-2 p-2 bg-brand/10 rounded">
                            <p className="text-xs text-brand">
                              <strong>Nota del administrador:</strong> {order.admin_notes}
                            </p>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}