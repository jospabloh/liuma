import React, { useEffect, useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { humanizeError } from '@/lib/errorMessages';
import {
  DISPLAY_NAME_MAX, dismissNamePrompt, userDisplayName, validateDisplayName,
} from '@/lib/userDisplayName';

/**
 * "¿Cómo te llamas?" — asked once after sign-in when the account has no real
 * name (full_name empty or an email handle), and reachable afterwards from the
 * account menu (SideNav footer, command palette "Cuenta"). Saves to the User
 * custom field `display_name` through `auth.updateMe`: the SDK cannot write
 * `full_name` (see src/lib/userDisplayName.js).
 *
 * `mode="prompt"` is the one-time question ("Ahora no" remembers the answer on
 * this device); `mode="edit"` is the menu entry ("Cancelar" just closes).
 */
export default function DisplayNameDialog({ open, onOpenChange, user, mode = 'edit' }) {
  const queryClient = useQueryClient();
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(userDisplayName(user));
      setError('');
    }
  }, [open, user]);

  const close = () => {
    if (mode === 'prompt') dismissNamePrompt(user?.id);
    onOpenChange(false);
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    const checked = validateDisplayName(value);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await base44.auth.updateMe({ display_name: checked.value });
      // Every screen reads the user from this one key (Home, NavContext,
      // GuardedRoute): patch it now so the greeting changes without waiting
      // for the refetch, then confirm against the server.
      queryClient.setQueryData(['currentUser'], (prev) => (prev ? { ...prev, display_name: checked.value } : prev));
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      onOpenChange(false);
    } catch (err) {
      setError(humanizeError(err) || 'No se pudo guardar tu nombre. Inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{mode === 'prompt' ? '¿Cómo te llamas?' : 'Tu nombre'}</DialogTitle>
            <DialogDescription>
              Así te saludaremos en LIUMA y así aparecerás en avisos, bitácoras y mensajes.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={inputId}>Nombre</Label>
            <Input
              id={inputId}
              value={value}
              onChange={(e) => { setValue(e.target.value); if (error) setError(''); }}
              placeholder="Por ejemplo: Ana López"
              autoComplete="name"
              autoCapitalize="words"
              maxLength={DISPLAY_NAME_MAX}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              autoFocus
            />
            {error && (
              <p id={errorId} role="alert" className="text-sm text-destructive">{error}</p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={close} disabled={saving}>
              {mode === 'prompt' ? 'Ahora no' : 'Cancelar'}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
