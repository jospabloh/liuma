# Incidente post-launch (Severidad Alta) — owner con “Acceso denegado”

- **ID:** INC-2026-05-18-OWNER-AUTH
- **Fecha de apertura:** 2026-05-18
- **Severidad:** Alta
- **Módulo vinculado:** Autorización / GuardedRoute
- **Estado:** Cerrado

## Resumen
Se detectó que el creator/owner podía quedar bloqueado en rutas permitidas cuando el provisioning del `UserProfile` no era consistente por tenant. Se aplicó override controlado para owner por email configurado, con aislamiento estricto por tenant y auditoría explícita de cada uso.

## Validación de provisioning del creator en tenant
Checklist aplicado para el perfil evaluado:
- `UserProfile`: requerido.
- `app_role=ADMIN`: requerido.
- `status=ACTIVE`: requerido.
- `is_super_admin=true`: requerido solo si el campo existe.

Resultado técnico: se implementó validación explícita en política (`verifyCreatorProvisioning`) para detectar provisioning incompleto y evitar diagnósticos ambiguos.

## Mitigación aplicada
1. Se mantuvo override solo para owner configurado (`VITE_OWNER_EMAIL`).
2. Se reforzó que el override solo aplica si `actorSchoolId === targetSchoolId`.
3. Se dejó denegación por defecto para no-owner y casos cross-tenant.
4. Se normalizó el evento de auditoría a `owner_override`.

## Evidencia de pruebas
- Owner autorizado en mismo tenant.
- No-owner denegado sin permisos de rol.
- Cross-tenant denegado incluso para owner.
- Validación de provisioning para creator ACTIVE/ADMIN y falla en estados incompletos.

## Postmortem corto
- **Causa raíz:** provisioning parcial de perfil creator y ausencia de chequeo explícito de integridad de perfil en diagnóstico de autorización.
- **Impacto:** bloqueo de acceso en secciones permitidas para owner en escenarios de provisioning incompleto.
- **Resolución:** override controlado + auditoría + pruebas de aislamiento y provisioning.

## Acción preventiva
Agregar control operativo en alta/reprovisioning de tenant para no finalizar proceso si falta `UserProfile` ACTIVE con `app_role=ADMIN` (y `is_super_admin=true` cuando aplique).

## Adenda 2026-06-04 — Remediación de exposición de secreto (owner identity)
Las variables `VITE_OWNER_EMAIL` y `VITE_OWNER_USER_ID` quedaban embebidas en el bundle del cliente (prefijo `VITE_`), exponiendo la identidad del owner y permitiendo verificaciones de owner manipulables en el cliente.

Cambios aplicados:
- `GuardedRoute` ya no lee `import.meta.env.VITE_OWNER_*`. El override de owner se deriva del `UserProfile` persistido en backend con `is_super_admin=true` (protegido por RLS de Base44), con `identity_source=profile`.
- El onboarding dejó de leer el email del owner y de auto-asignar `is_super_admin` desde el cliente. Ese campo privilegiado lo controla exclusivamente el backend (reglas de entidad / RLS de Base44); la elevación a owner es una operación de servidor.
- Acción pendiente de operación: rotar/retirar las variables `VITE_OWNER_EMAIL` y `VITE_OWNER_USER_ID` de los entornos (local, Vercel, Base44) ya que no son necesarias en el cliente, y garantizar que `is_super_admin` solo se pueda escribir server-side.
