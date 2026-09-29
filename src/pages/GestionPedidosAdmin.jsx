import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Package } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useSchoolStudents } from '@/hooks/useSchoolStudents';

export default function GestionPedidosAdmin() {
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [newStatus, setNewStatus] = useState('');
  const [adminNotes, setAdminNotes] = useState('');

  const queryClient = useQueryClient();

  const { userProfile, isLoading: profileLoading } = useCurrentProfile();

  const { data: orders, isLoading } = useQuery({
    queryKey: ['allUniformOrders', userProfile?.school_id],
    queryFn: () => base44.entities.UniformOrder.filter({ school_id: userProfile.school_id }, '-created_date'),
    enabled: !!userProfile?.school_id,
  });

  // All students, inactive included: an order can outlive the student's
  // enrolment and must still show whose it is.
  const { data: students } = useSchoolStudents(userProfile?.school_id, { activeOnly: false });

  const updateOrderMutation = useMutation({
    mutationFn: ({ orderId, data }) => base44.entities.UniformOrder.update(orderId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allUniformOrders'] });
      toast.success('Pedido actualizado');
      setSelectedOrder(null);
    },
    onError: () => toast.error('No se pudo actualizar el pedido. Intenta de nuevo.'),
  });

  const handleUpdateOrder = () => {
    updateOrderMutation.mutate({
      orderId: selectedOrder.id,
      data: {
        status: newStatus,
        admin_notes: adminNotes,
      },
    });
  };

  const openOrderDialog = (order) => {
    setSelectedOrder(order);
    setNewStatus(order.status);
    setAdminNotes(order.admin_notes || '');
  };

  const statusLabels = {
    PENDING: { label: 'Pendiente', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/60 dark:text-yellow-300' },
    PROCESSING: { label: 'En proceso', color: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300' },
    READY: { label: 'Listo', color: 'bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300' },
    DELIVERED: { label: 'Entregado', color: 'bg-muted text-muted-foreground' },
    CANCELLED: { label: 'Cancelado', color: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300' },
  };

  if (profileLoading || isLoading) {
    return <LoadingScreen message="Cargando pedidos..." />;
  }

  const pendingCount = orders?.filter(o => o.status === 'PENDING').length || 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 pb-24">
        <PageHeader
          title="Gestión de Pedidos"
          subtitle={`${orders?.length || 0} pedidos totales • ${pendingCount} pendientes`}
          showBack
        />

        <div className="space-y-4">
          {orders?.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Package className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No hay pedidos de uniformes</p>
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
                  <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => openOrderDialog(order)}>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-lg">
                            {student?.first_name} {student?.last_name}
                          </CardTitle>
                          <CardDescription>
                            {order.parent_name} • {new Date(order.created_date).toLocaleDateString('es-MX')}
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
                        {Object.keys(order.measurements).some(key => order.measurements[key]) && (
                          <div className="mt-2 pt-2 border-t border-border">
                            <p className="text-xs text-muted-foreground">
                              <strong>Medidas:</strong>{' '}
                              {Object.entries(order.measurements)
                                .filter(([_, value]) => value)
                                .map(([key, value]) => `${key}: ${value}cm`)
                                .join(', ')}
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

        <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Actualizar Pedido</DialogTitle>
            </DialogHeader>
            {selectedOrder && (
              <div className="space-y-4">
                <div>
                  <Label>Estado del Pedido</Label>
                  <Select value={newStatus} onValueChange={setNewStatus}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PENDING">Pendiente</SelectItem>
                      <SelectItem value="PROCESSING">En proceso</SelectItem>
                      <SelectItem value="READY">Listo</SelectItem>
                      <SelectItem value="DELIVERED">Entregado</SelectItem>
                      <SelectItem value="CANCELLED">Cancelado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Notas del Administrador</Label>
                  <Textarea
                    value={adminNotes}
                    onChange={(e) => setAdminNotes(e.target.value)}
                    placeholder="Notas internas sobre el pedido"
                    rows={3}
                  />
                </div>

                <Button
                  onClick={handleUpdateOrder}
                  className="w-full"
                  disabled={updateOrderMutation.isPending}
                >
                  Actualizar Pedido
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}