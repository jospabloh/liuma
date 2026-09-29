import React from 'react';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useNavigate } from 'react-router-dom';
import { routeDenialCopy } from '@/lib/authorization/routeDenialCopy';

// What a person sees when a route is not for them. Plain Spanish, no internal
// codes: this used to print the raw reason code (forbidden_action) and tell
// a school director to "solicita acceso a tu administrador" — they ARE the
// administrator. The reason code still goes to the audit log (GuardedRoute);
// here it only picks the wording.
export default function RouteAccessDenied({ redirectTo = '/Home', reasonCode, profileStatus, message }) {
  const navigate = useNavigate();
  const copy = routeDenialCopy({ reasonCode, profileStatus });

  return (
    <div className="min-h-[50vh] flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardContent className="p-6 text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
            <Lock className="h-6 w-6 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-semibold text-foreground">{copy.title}</h1>
          <p className="text-sm text-muted-foreground">{message || copy.body}</p>
          <Button onClick={() => navigate(redirectTo)}>Ir al inicio</Button>
        </CardContent>
      </Card>
    </div>
  );
}
