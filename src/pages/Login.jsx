import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { LogIn } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import { AuthError, EmailField, PasswordField, SubmitButton } from "@/components/auth/parts";
import { getRememberedIdentity, clearRememberedIdentity } from "@/lib/lastIdentity";

// Pantalla de inicio de sesión propia de LIUMA, en lugar de la página genérica
// hospedada por Base44. Usa `base44.auth.loginViaEmailPassword`, que el SDK
// soporta de forma independiente al flujo de `redirectToLogin` (ver
// AuthContext/App.jsx: solo se usa `redirectToLogin` para el "Continuar como"
// silencioso vía cookie, cuando ya hay una identidad recordada).
//
// No hay flujo de registro / "olvidé mi contraseña" propio todavía en esta app
// (las cuentas se aprovisionan por invitación de la escuela), así que no se
// agregan enlaces a pantallas que no existen.
export default function Login() {
  const remembered = getRememberedIdentity();
  const [email, setEmail] = useState(remembered?.email || "");
  const [recognized, setRecognized] = useState(Boolean(remembered?.email));
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const firstName = remembered?.name ? remembered.name.split(" ")[0] : null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await base44.auth.loginViaEmailPassword(email.trim(), password);
      window.location.href = "/";
    } catch {
      setError("Correo o contraseña incorrectos. Inténtalo de nuevo.");
      setLoading(false);
    }
  };

  const useOtherAccount = () => {
    clearRememberedIdentity();
    setRecognized(false);
    setEmail("");
  };

  return (
    <AuthLayout
      icon={LogIn}
      title={recognized && firstName ? `Hola de nuevo, ${firstName}` : "Bienvenido a LIUMA"}
      subtitle={
        recognized
          ? "Confirma tu contraseña para continuar."
          : "Inicia sesión para ver la actividad de tu escuela."
      }
    >
      <AuthError>{error}</AuthError>

      <form onSubmit={handleSubmit} className="space-y-4">
        <EmailField
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus={!recognized}
        />
        <PasswordField
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          autoFocus={recognized}
        />
        <SubmitButton loading={loading} idle="Iniciar sesión" busy="Entrando…" />
      </form>

      {recognized && (
        <button
          type="button"
          onClick={useOtherAccount}
          className="mt-4 w-full text-center text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Usar otra cuenta
        </button>
      )}
    </AuthLayout>
  );
}
