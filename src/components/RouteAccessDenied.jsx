import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useNavigate } from 'react-router-dom';

export default function RouteAccessDenied({ redirectTo = '/Home', message = 'No tienes permisos para ver esta sección.', reasonCode }) {
  const navigate = useNavigate();

  return (
    <div className="min-h-[50vh] flex items-center justify-center p-4">
      <Card className="max-w-md w-full border-amber-200">
        <CardContent className="p-6 text-center space-y-4">
          <AlertTriangle className="mx-auto w-8 h-8 text-amber-600" />
          <h1 className="text-lg font-semibold text-foreground">Acceso denegado</h1>
          <p className="text-sm text-muted-foreground">{message}</p>
          <p className="text-xs text-muted-foreground">Si crees que esto es un error, solicita acceso a tu administrador.</p>
          {reasonCode && <p className="text-xs text-muted-foreground">Código de referencia: {reasonCode}</p>}
          <Button onClick={() => navigate(redirectTo)}>Volver a una ruta permitida</Button>
        </CardContent>
      </Card>
    </div>
  );
}
