import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Lock, Loader2, Eye, EyeOff } from "lucide-react";

// Piezas compartidas por las pantallas de autenticación, para que se vean
// consistentes con la marca.
//
// Nota: no incluimos botones de "Continuar con Google/Apple" aquí. El SDK de
// Base44 (`base44.auth.loginWithProvider`) soporta esos proveedores, pero cuáles
// están habilitados es una configuración del backend de esta app específica
// (ajustes de autenticación en Base44) que no se puede verificar desde este
// repo. Mostrar botones para proveedores no habilitados fallaría en silencio o
// confundiría al usuario, así que los omitimos hasta confirmar cuáles aplican.

export function AuthError({ children }) {
  if (!children) return null;
  return (
    <div className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">
      {children}
    </div>
  );
}

export function EmailField(props) {
  return (
    <div className="space-y-2">
      <Label htmlFor="email">Correo electrónico</Label>
      <div className="relative">
        <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="tu@correo.com"
          className="h-12 pl-10"
          required
          {...props}
        />
      </div>
    </div>
  );
}

// Show/hide toggle: on a phone, a mistyped password with no way to see it is
// the most common reason a parent "forgets" it. The placeholder is words, not
// dots — "••••••••" looked like a saved password already filled in.
export function PasswordField({ id = "password", label = "Contraseña", labelRight = null, placeholder = "Tu contraseña", ...props }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        {labelRight}
      </div>
      <div className="relative">
        <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          id={id}
          type={visible ? "text" : "password"}
          placeholder={placeholder}
          className="h-12 pl-10 pr-12"
          required
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
          aria-pressed={visible}
          aria-controls={id}
          className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

/** A green confirmation line, the counterpart of AuthError. */
export function AuthNotice({ children }) {
  if (!children) return null;
  return (
    <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" role="status">
      {children}
    </div>
  );
}

export function SubmitButton({ loading, idle, busy }) {
  return (
    <Button type="submit" className="h-12 w-full font-medium" disabled={loading}>
      {loading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {busy}
        </>
      ) : (
        idle
      )}
    </Button>
  );
}
