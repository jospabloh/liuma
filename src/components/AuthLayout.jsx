import React from "react";
import { GraduationCap } from "lucide-react";

// Layout de marca para las pantallas de autenticación de LIUMA. Dos columnas en
// desktop: el formulario a la izquierda y un panel de marca a la derecha (oculto
// en móvil). Antes de iniciar sesión no conocemos la escuela del usuario, así
// que usamos el color de marca por defecto (ver --tenant-primary / DEFAULT_THEME
// en src/lib/tenantTheme.js) — el tema real de cada escuela se aplica después,
// una vez autenticado, vía TenantThemeRuntime.
export default function AuthLayout({ icon: Icon, title, subtitle = null, footer = null, children }) {
  return (
    <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-2">
      {/* Columna del formulario */}
      <div className="flex min-h-screen flex-col px-6 py-8 lg:min-h-0 lg:px-12">
        <div className="flex items-center gap-2 text-lg font-black">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <GraduationCap className="h-5 w-5" aria-hidden="true" />
          </div>
          LIUMA
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <div className="mb-7 text-center">
            {Icon && (
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
                <Icon className="h-6 w-6 text-primary" aria-hidden="true" />
              </div>
            )}
            <h1 className="text-2xl font-black tracking-tight">{title}</h1>
            {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
          </div>

          {children}

          {footer && <p className="mt-6 text-center text-sm text-muted-foreground">{footer}</p>}
        </div>

        <p className="text-center text-xs text-muted-foreground">LIUMA · Gestión escolar</p>
      </div>

      {/* Panel de marca (desktop) */}
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-primary/25 via-primary/5 to-background lg:block">
        <div className="absolute inset-0 flex flex-col justify-center px-12">
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
            Escuela y familia · un solo lugar
          </span>
          <h2 className="mt-5 text-4xl font-black leading-tight">
            Toda la escuela,
            <br />
            <span className="text-primary">conectada</span>.
          </h2>
          <p className="mt-4 max-w-sm text-sm text-muted-foreground">
            Asistencia, tareas, avisos, calendario, pagos y pedidos de uniformes en
            un solo lugar — cada escuela ve únicamente sus propios datos.
          </p>
        </div>
      </div>
    </div>
  );
}
