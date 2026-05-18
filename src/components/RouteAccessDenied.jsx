import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useNavigate } from 'react-router-dom';

export default function RouteAccessDenied({ redirectTo = '/Home' }) {
  const navigate = useNavigate();

  return (
    <div className="min-h-[50vh] flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardContent className="p-6 text-center space-y-4">
          <AlertTriangle className="mx-auto w-8 h-8 text-amber-600" />
          <h1 className="text-lg font-semibold">Acceso denegado</h1>
          <p className="text-sm text-slate-600">No tienes permisos para ver esta sección.</p>
          <Button onClick={() => navigate(redirectTo)}>Ir a una página permitida</Button>
        </CardContent>
      </Card>
    </div>
  );
}
