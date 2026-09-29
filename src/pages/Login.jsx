import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { LogIn, KeyRound, UserPlus, MailCheck } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthError, AuthNotice, EmailField, PasswordField, SubmitButton } from "@/components/auth/parts";
import { getRememberedIdentity, clearRememberedIdentity } from "@/lib/lastIdentity";
import { describeLoginError, describeOtpError, describeSignupError, isNetworkError, NETWORK_ERROR_MESSAGE } from "@/lib/errorMessages";
import { MIN_PASSWORD_LENGTH, readResetToken } from "@/lib/authLinks";

// Pantalla de inicio de sesión propia de LIUMA, en lugar de la página genérica
// hospedada por Base44. Usa los métodos de correo+contraseña del SDK
// (`loginViaEmailPassword`, `resetPasswordRequest`/`resetPassword`,
// `register`/`verifyOtp`); `redirectToLogin` solo se usa para el "Continuar
// como" silencioso vía cookie (ver AuthContext/App.jsx).
//
// Cinco pasos en una sola pantalla, porque cada uno es la salida del anterior:
//   login   → entrar (y de aquí a "olvidé" o "crear cuenta")
//   forgot  → pedir el correo de recuperación
//   reset   → poner contraseña nueva (llega con ?reset_token=… del correo)
//   signup  → crear cuenta (el director que va a probar LIUMA, o un padre al
//             que la escuela le pasó el código); después de entrar, Home abre
//             el onboarding: crear escuela o unirse con código
//   verify  → el código que Base44 manda por correo al registrarse
//
// Antes no existía ninguno de los cuatro últimos: un padre que olvidaba su
// contraseña no tenía por dónde volver, y un director que llegaba a /login no
// encontraba cómo empezar la prueba.
//
// NO VERIFICADO desde este entorno: que el registro abierto esté habilitado en
// la configuración de autenticación de la app en Base44, y la forma exacta del
// enlace del correo de recuperación (ver authLinks.js). Si el registro está
// cerrado, `register` responde 403 y la pantalla lo dice en español.

const COPY = {
  login: { icon: LogIn },
  forgot: { icon: KeyRound, title: "Recupera tu contraseña", subtitle: "Te enviaremos un enlace a tu correo para crear una nueva." },
  reset: { icon: KeyRound, title: "Crea una contraseña nueva", subtitle: `Usa al menos ${MIN_PASSWORD_LENGTH} caracteres.` },
  signup: { icon: UserPlus, title: "Crea tu cuenta", subtitle: "Para directores que empiezan su prueba y para familias o maestros que ya tienen el código de su escuela." },
  verify: { icon: MailCheck, title: "Revisa tu correo", subtitle: "Te enviamos un código para confirmar que el correo es tuyo." },
};

function LinkButton({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-sm font-medium text-primary underline-offset-4 hover:underline"
    >
      {children}
    </button>
  );
}

export default function Login() {
  const location = useLocation();
  const navigate = useNavigate();
  const resetToken = readResetToken(location.search);
  const remembered = getRememberedIdentity();

  const [mode, setMode] = useState(resetToken ? "reset" : "login");
  const [email, setEmail] = useState(remembered?.email || "");
  const [recognized, setRecognized] = useState(Boolean(remembered?.email) && !resetToken);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  const firstName = remembered?.name ? remembered.name.split(" ")[0] : null;

  const go = (next, { keepNotice = false } = {}) => {
    setError("");
    if (!keepNotice) setNotice("");
    setPassword("");
    setConfirm("");
    setCode("");
    setMode(next);
  };

  const run = async (fn) => {
    setError("");
    setLoading(true);
    try {
      await fn();
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = (e) => {
    e.preventDefault();
    run(async () => {
      try {
        await base44.auth.loginViaEmailPassword(email.trim(), password);
        window.location.href = "/";
      } catch (err) {
        setError(describeLoginError(err).message);
      }
    });
  };

  const handleForgot = (e) => {
    e.preventDefault();
    run(async () => {
      try {
        await base44.auth.resetPasswordRequest(email.trim());
      } catch (err) {
        // Only a network failure is worth reporting. "No account with that
        // e-mail" gets the same answer as success, so this form can't be used
        // to find out who has an account at a school.
        if (isNetworkError(err)) {
          setError(NETWORK_ERROR_MESSAGE);
          return;
        }
      }
      go("login", { keepNotice: true });
      setNotice(`Si hay una cuenta con ${email.trim()}, te llegará un correo con el enlace para crear una contraseña nueva. Revisa también tu carpeta de spam.`);
    });
  };

  const handleReset = (e) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }
    if (password !== confirm) {
      setError("Las dos contraseñas no coinciden.");
      return;
    }
    run(async () => {
      try {
        await base44.auth.resetPassword({ resetToken, newPassword: password });
        // Drop the token from the URL so a reload doesn't reopen this form.
        navigate("/login", { replace: true });
        go("login", { keepNotice: true });
        setNotice("Listo, tu contraseña cambió. Ya puedes iniciar sesión.");
      } catch (err) {
        setError(
          isNetworkError(err)
            ? NETWORK_ERROR_MESSAGE
            : "El enlace ya no es válido o venció. Pide uno nuevo desde «¿Olvidaste tu contraseña?».",
        );
      }
    });
  };

  const handleSignup = (e) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }
    run(async () => {
      try {
        await base44.auth.register({ email: email.trim(), password });
        setError("");
        setMode("verify");
      } catch (err) {
        setError(describeSignupError(err).message);
      }
    });
  };

  const handleVerify = (e) => {
    e.preventDefault();
    run(async () => {
      try {
        await base44.auth.verifyOtp({ email: email.trim(), otpCode: code.trim() });
      } catch (err) {
        setError(describeOtpError(err).message);
        return;
      }
      try {
        await base44.auth.loginViaEmailPassword(email.trim(), password);
        window.location.href = "/";
      } catch {
        // Verified but the automatic sign-in failed: send them to the normal
        // form rather than leaving them on a code screen that already worked.
        go("login", { keepNotice: true });
        setNotice("Tu correo quedó confirmado. Inicia sesión para continuar.");
      }
    });
  };

  const handleResend = () => {
    run(async () => {
      try {
        await base44.auth.resendOtp(email.trim());
        setNotice("Te enviamos un código nuevo.");
      } catch (err) {
        setError(describeOtpError(err).message);
      }
    });
  };

  const useOtherAccount = () => {
    clearRememberedIdentity();
    setRecognized(false);
    setEmail("");
  };

  const meta = COPY[mode];
  const title = mode === "login"
    ? (recognized && firstName ? `Hola de nuevo, ${firstName}` : "Bienvenido a LIUMA")
    : meta.title;
  const subtitle = mode === "login"
    ? (recognized ? "Confirma tu contraseña para continuar." : "Inicia sesión para ver la actividad de tu escuela.")
    : meta.subtitle;

  return (
    <AuthLayout icon={meta.icon} title={title} subtitle={subtitle}>
      <AuthNotice>{notice}</AuthNotice>
      <AuthError>{error}</AuthError>

      {mode === "login" && (
        <>
          <form onSubmit={handleLogin} className="space-y-4">
            <EmailField value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={!recognized} />
            <PasswordField
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus={recognized}
              labelRight={<LinkButton onClick={() => go("forgot")}>¿Olvidaste tu contraseña?</LinkButton>}
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

          <div className="mt-6 rounded-xl border border-border bg-muted/40 p-4 text-center text-sm text-muted-foreground">
            ¿Tu escuela es nueva en LIUMA o aún no tienes cuenta?{" "}
            <LinkButton onClick={() => { setRecognized(false); go("signup"); }}>Crea tu cuenta</LinkButton>
            <p className="mt-1 text-xs">Los directores empiezan con 30 días de prueba.</p>
          </div>
        </>
      )}

      {mode === "forgot" && (
        <form onSubmit={handleForgot} className="space-y-4">
          <EmailField value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          <SubmitButton loading={loading} idle="Enviar enlace" busy="Enviando…" />
          <div className="text-center"><LinkButton onClick={() => go("login")}>Volver a iniciar sesión</LinkButton></div>
        </form>
      )}

      {mode === "reset" && (
        <form onSubmit={handleReset} className="space-y-4">
          <PasswordField
            label="Contraseña nueva"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            autoFocus
          />
          <PasswordField
            id="password-confirm"
            label="Repite la contraseña"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
          />
          <SubmitButton loading={loading} idle="Guardar contraseña" busy="Guardando…" />
          <div className="text-center"><LinkButton onClick={() => { navigate("/login", { replace: true }); go("login"); }}>Volver a iniciar sesión</LinkButton></div>
        </form>
      )}

      {mode === "signup" && (
        <form onSubmit={handleSignup} className="space-y-4">
          <EmailField value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          <PasswordField
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            placeholder={`Al menos ${MIN_PASSWORD_LENGTH} caracteres`}
          />
          <SubmitButton loading={loading} idle="Crear cuenta" busy="Creando…" />
          <p className="text-center text-sm text-muted-foreground">
            ¿Ya tienes cuenta? <LinkButton onClick={() => go("login")}>Inicia sesión</LinkButton>
          </p>
        </form>
      )}

      {mode === "verify" && (
        <form onSubmit={handleVerify} className="space-y-4">
          <p className="text-center text-sm text-muted-foreground">
            Escribe el código que enviamos a <strong className="text-foreground">{email.trim()}</strong>.
          </p>
          <div className="space-y-2">
            <Label htmlFor="otp">Código</Label>
            <Input
              id="otp"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              className="h-12 text-center text-lg tracking-[0.3em]"
              required
              autoFocus
            />
          </div>
          <SubmitButton loading={loading} idle="Confirmar" busy="Confirmando…" />
          <div className="flex items-center justify-between">
            <LinkButton onClick={handleResend}>Enviar otro código</LinkButton>
            <LinkButton onClick={() => go("signup")}>Cambiar correo</LinkButton>
          </div>
        </form>
      )}
    </AuthLayout>
  );
}
