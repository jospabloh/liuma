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
