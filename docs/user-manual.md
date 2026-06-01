# LIUMA – Manual de Usuario
**Versión 1.0.0 | Actualizado: 2026-06-01**

---

## Tabla de contenidos

1. [Introducción](#1-introducción)
2. [Acceso y autenticación](#2-acceso-y-autenticación)
3. [Roles y permisos](#3-roles-y-permisos)
4. [Panel del Administrador (Directivo)](#4-panel-del-administrador-directivo)
5. [Panel del Maestro](#5-panel-del-maestro)
6. [Panel del Padre / Tutor](#6-panel-del-padre--tutor)
7. [Módulo de Pagos](#7-módulo-de-pagos)
8. [Calendario Escolar](#8-calendario-escolar)
9. [Pedidos de Uniformes](#9-pedidos-de-uniformes)
10. [Alerta de Emergencia](#10-alerta-de-emergencia)
11. [Asistente Lumi (IA)](#11-asistente-lumi-ia)
12. [Permisos y Roles (Administración)](#12-permisos-y-roles-administración)
13. [Auditoría](#13-auditoría)
14. [Novedades – versión 1.0.0](#14-novedades--versión-100)
15. [Preguntas frecuentes](#15-preguntas-frecuentes)

---

## 1. Introducción

**LIUMA** es una plataforma SaaS de gestión escolar diseñada para instituciones educativas de América Latina. Permite a directivos, maestros y padres de familia colaborar en un entorno seguro, multiescuela (multi-tenant) con control de acceso basado en roles (RBAC) y trazabilidad completa mediante auditoría.

### Módulos disponibles

| Módulo | Directivo | Maestro | Padre |
|---|---|---|---|
| Gestión de escuela | ✅ | — | — |
| Gestión de alumnos | ✅ | ✅ | — |
| Gestión de salón | ✅ | ✅ | — |
| Asistencia | ✅ | ✅ | 👁 Ver |
| Bitácora / Diario | ✅ | ✅ | 👁 Ver |
| Tareas | ✅ | ✅ | 👁 Ver |
| Avisos | ✅ | ✅ | 👁 Ver |
| Calendario escolar | ✅ | ✅ | ✅ |
| Pagos | ✅ Admin | — | 👁 Ver propios |
| Pedidos de uniformes | ✅ | — | ✅ |
| Alertas de emergencia | ✅ | — | — |
| Gestión de ausencias | ✅ | ✅ | Solicitar |
| Descuentos | ✅ | — | — |
| Documentos oficiales | ✅ | — | — |
| Reportes | ✅ | — | — |
| Permisos y roles | ✅ | — | — |
| Auditoría | ✅ | — | — |
| Lumi (IA) | ✅ | ✅ | ✅ |

---

## 2. Acceso y autenticación

### Inicio de sesión

1. Abre la URL de tu escuela en el navegador.
2. Si no tienes sesión activa, serás redirigido automáticamente a la pantalla de inicio de sesión de Base44.
3. Ingresa con tu cuenta registrada. Si no estás registrado, contacta al administrador de tu escuela.

### Cierre de sesión

- Haz clic en el menú de usuario (esquina superior derecha) → **Cerrar sesión**.
- Tu sesión se limpia automáticamente y serás redirigido a la pantalla de inicio de sesión.

### Tokens de acceso

- El token de sesión se almacena en `localStorage` del navegador.
- Al pasar `?clear_access_token=true` en la URL se elimina el token almacenado (útil para depuración).

---

## 3. Roles y permisos

LIUMA define tres roles principales:

| Rol | Nombre en la app | Descripción |
|---|---|---|
| `ADMIN` | Directivo | Acceso completo a todos los módulos de la escuela. |
| `TEACHER` | Maestro | Acceso a sus salones, alumnos y actividades pedagógicas. |
| `PARENT` | Padre/Tutor | Acceso de solo lectura a la información de sus hijos. |

### Reglas generales

- **Acceso denegado por defecto**: si un rol no está explícitamente autorizado para un módulo, se le niega el acceso y el evento queda registrado en auditoría.
- **Aislamiento por escuela (tenant)**: cada usuario solo ve datos de su propia escuela. El cruce entre escuelas está bloqueado en todas las capas.
- **Aislamiento por salón (maestros)**: un maestro solo accede a los alumnos y datos del salón al que está asignado.
- **Aislamiento por hijo (padres)**: un padre solo accede a la información de los hijos que tiene registrados.

### Plantillas de permisos (v1.0.0)

Desde la versión 1.0.0 el módulo **Permisos y Roles** incluye dos plantillas predefinidas:

- **Plantilla Admin**: todos los permisos activados (`true`) para todos los recursos.
- **Plantilla Miembro (Por Defecto)**: todos los permisos desactivados (`false`). El administrador otorga acceso según lo requiera cada usuario.

Los recursos cubiertos por la matriz de permisos son:

> Students · Classrooms · Attendance · Homework · Diary · Notices · Payments · Documents · Reports · **Calendar** · **Events** · **Uniforms** · **Discounts** · **Emergency Alerts** · **Absences** · AI · Audit · Tenant Danger Zone

*(Los recursos en negrita fueron agregados en la versión 1.0.0)*

---

## 4. Panel del Administrador (Directivo)

### Gestión de Escuela (`GestionEscuela`)

- Edita el nombre, logo, colores y datos generales de la escuela.
- Configura la paleta de colores del tema (se valida contraste automáticamente).
- Revisa el estado de la suscripción escolar.

### Configuración Inicial (`ConfiguracionInicial`)

- Guía paso a paso para completar la configuración de la escuela: salones, alumnos, maestros, plantillas de avisos.
- Se muestra solo cuando la escuela aún no ha completado la configuración.

### Gestión de Alumnos (`GestionAlumno`)

- Crea, edita y archiva alumnos.
- Asocia alumnos a salones y tutores.
- Consulta historial de asistencia, calificaciones y documentos por alumno.

### Gestión de Salones (`GestionSalon`)

- Crea y edita salones.
- Asigna maestros a salones (relación TeacherClassroom).

### Gestión de Ausencias (`GestionAusencias`)

- Revisa solicitudes de ausencia enviadas por padres.
- Aprueba o rechaza ausencias con comentario.

### Resumen de Asistencia (`ResumenAsistencia`)

- Vista consolidada de asistencia por salón y período.
- Exportable a PDF.

### Avisos Admin (`AvisosAdmin`)

- Crea avisos de alcance escolar, de salón o individual.
- Programa avisos y visualiza métricas de entrega.

### Reportes (`Reportes`)

- Genera reportes de asistencia, pagos y rendimiento.
- Exporta en PDF o CSV.

### Aprobaciones (`Aprobaciones`)

- Bandeja de cambios de rol y rollbacks de permisos pendientes de aprobación (maker-checker).
- Los cambios de alto riesgo (ADMIN ↔ otro rol) requieren la firma de un segundo administrador.

---

## 5. Panel del Maestro

### Operación Diaria (`OperacionDiaria`)

- Vista rápida de las tareas del día: tomar asistencia, revisar avisos, consultar tareas pendientes.

### Asistencia (`Asistencia`)

- Registra asistencia alumno por alumno para su salón.
- Marca ausencia justificada / injustificada / tardanza.

### Bitácora / Diario (`BitacorasMaestro`, `CrearBitacora`)

- Crea entradas de diario de clase para el salón.
- Los padres pueden ver las entradas correspondientes a sus hijos.

### Tareas (`TareaMaestro`)

- Crea y edita tareas asignadas al salón.
- Establece fecha de entrega y descripción.

### Avisos Maestro (`AvisosMaestro`)

- Publica avisos de alcance de salón o individual.

### Gestión de Ausencias (`GestionAusencias`)

- Consulta solicitudes de ausencia enviadas por padres para sus alumnos.

---

## 6. Panel del Padre / Tutor

### Mis Hijos (`MisHijos`)

- Vista de todos los hijos registrados bajo el tutor.
- Acceso rápido a información de cada hijo.

### Asistencia (`Asistencia`)

- Consulta el registro de asistencia de tus hijos.

### Tareas (`Tarea`)

- Consulta las tareas asignadas a tus hijos con fechas y estatus.

### Bitácora (`Bitacora`)

- Lee las entradas del diario de clase del maestro.

### Avisos (`Avisos`)

- Recibe y lee avisos de la escuela o del salón.

### Solicitar Ausencia (`SolicitarAusencia`)

- Envía una solicitud de ausencia para tu hijo con fecha y motivo.
- El administrador aprueba o rechaza la solicitud.

### Contactos de Emergencia (`ContactosEmergencia`)

- Registra y actualiza los contactos de emergencia de tus hijos.

### Eventos para Padres (`EventosParaPadres`)

- Consulta los eventos escolares abiertos para padres y confirma asistencia.

---

## 7. Módulo de Pagos

### Pagos – vista del padre (`Pagos`)

- Consulta los cargos pendientes y el historial de pagos de tus hijos.
- Los pagos en línea se procesan a través de Stripe (si la escuela tiene Stripe habilitado).

### Pagos Admin (`PagosAdmin`)

- Registra pagos recibidos manualmente.
- Genera conceptos de pago (PaymentConcept) y cargos individuales (ChargeItem).
- Aplica descuentos configurados.

### Descuentos (`GestionDescuentos`)

- Crea y edita descuentos aplicables a cargos (porcentaje o monto fijo).
- Vincula descuentos a alumnos específicos o grupos.

---

## 8. Calendario Escolar

- Disponible para todos los roles.
- Los administradores crean y editan eventos.
- Maestros y padres visualizan los eventos publicados.
- Compatible con dispositivos móviles.

---

## 9. Pedidos de Uniformes

### Padres (`PedidosUniformes`)

- Selecciona tallas y artículos disponibles.
- Envía el pedido al administrador.

### Administrador (`GestionPedidosAdmin`)

- Revisa todos los pedidos recibidos.
- Actualiza el estatus (pendiente / listo / entregado).

---

## 10. Alerta de Emergencia

- Disponible solo para administradores (`AlertaEmergencia`).
- Envía una alerta inmediata a todos los usuarios activos de la escuela.
- El evento queda registrado en el log de auditoría.

---

## 11. Asistente Lumi (IA)

Lumi es el asistente de inteligencia artificial integrado en la aplicación. Aparece como un botón flotante en la mayoría de las páginas (solo visible para usuarios con perfil activo).

### Capacidades principales

| Intento | Roles | Descripción |
|---|---|---|
| `homework_lookup` | Admin, Maestro, Padre | Consulta tareas por alumno o salón |
| `attendance_check` | Admin, Maestro, Padre | Verifica asistencia |
| `payment_status` | Admin, Padre | Estado de pagos |
| `student_profile` | Admin, Maestro | Datos del alumno |
| `attendance_summary` | Admin, Maestro | Resumen de asistencia |
| `payment_follow_up` | Admin | Seguimiento de pagos vencidos |
| `behavior_report` | Admin, Maestro | Reporte de conducta |
| `announcements` | Admin, Maestro | Gestión de avisos |
| `homework_assistant` | Admin, Maestro | Asistente de creación de tareas |

### Acciones rápidas

El panel de Lumi muestra acciones rápidas contextualizadas según el rol del usuario. Pulsa el botón de Lumi (esquina inferior derecha) para abrirlo.

### Política de denegación

Si una capacidad está fuera del alcance de tu rol, Lumi responde con un mensaje de denegación claro e indica el motivo.

---

## 12. Permisos y Roles (Administración)

Módulo exclusivo para administradores. Permite:

### Cambio de rol de usuario

1. Selecciona el usuario en el selector.
2. Elige el nuevo rol (`ADMIN`, `TEACHER`, `PARENT`).
3. Escribe el **motivo** del cambio (obligatorio).
4. Pulsa **Solicitar cambio de rol**.
   - Cambios a/desde `ADMIN` requieren aprobación de un segundo administrador (maker-checker).
   - El dueño de la app puede aplicar cambios directamente sin maker-checker.

### Overrides de permisos

Permite otorgar o denegar permisos específicos a usuarios individuales, por encima o por debajo de lo que su rol permite.

- Solo se pueden crear overrides para usuarios **no ADMIN**.
- Requiere motivo escrito.
- El override queda registrado en auditoría con antes/después.

### Rollback de permisos

Revierte un override activo:

- Rollbacks normales se aplican inmediatamente.
- Rollbacks sobre `manage_permissions` son de alto riesgo y requieren maker-checker.

### Plantillas de permisos

- **Plantilla Admin**: todos los permisos activados.
- **Plantilla Miembro (Por Defecto)**: todos los permisos desactivados. Úsala como base para configurar el acceso de nuevos usuarios.

Puedes crear plantillas personalizadas adicionales con nombre propio.

### Danger Zone

Operaciones irreversibles o de alto impacto:

| Operación | Confirmación |
|---|---|
| Eliminar tenant | Frase escrita + preview del tenant |
| Suspender tenant | Frase escrita + warning |
| Resetear datos del tenant | Frase escrita + confirmación irreversible |
| Transferir propiedad del tenant | Frase escrita + maker-checker |

Todas las operaciones de la Danger Zone quedan registradas en el log de auditoría.

---

## 13. Auditoría

Módulo exclusivo para administradores (`AuditoriaAdmin`).

### ¿Qué se registra?

- Decisiones de política RBAC (permite/deniega)
- Cambios de permisos y roles (antes/después con diff)
- Overrides aplicados / revertidos
- Accesos denegados por ruta
- Acciones del dueño (owner override)
- Interacciones con Lumi (AI)

### Acceso al log

- Solo los administradores activos del tenant pueden acceder.
- Los registros de cambios de permisos son visibles para el administrador que los realizó o para admins con `can_view_all_tenant_permission_changes`.

### Retención

La política de retención está definida en `docs/audit-retention-policy.md`.

---

## 14. Novedades – versión 1.0.0

### Correcciones de errores

| # | Área | Descripción |
|---|---|---|
| PR #82 | Onboarding | Bloqueo temprano cuando un usuario no-dueño intenta crear una escuela con rol ADMIN. |
| PR #81 | Móvil | El hook `useIsMobile` ya no causa un flash visual en la primera carga al inicializarse desde `matchMedia`. |
| PR #80 | Estilos | Las reglas CSS globales de touch-target y zoom de iOS ya no afectan el diseño de escritorio. |
| PR #79 | Lumi Chat | El chat ya no queda oculto bajo el teclado virtual en dispositivos móviles. |

### Nuevas funcionalidades

| Área | Descripción |
|---|---|
| Permisos | Matriz ampliada con Calendar, Events, Uniforms, Discounts, Emergency Alerts y Absences. |
| Permisos | Nueva Plantilla Miembro con todos los permisos en `false` por defecto. |
| Carga de páginas | Todas las páginas se cargan de forma diferida (lazy loading) con indicador de carga. |
| Tests | 83 pruebas unitarias e integración pasan con 0 fallas. |

### Cambios que afectan a todos los tenants

- La matriz de permisos ahora incluye 6 recursos adicionales. Los administradores deben revisar y configurar explícitamente estos recursos en el módulo **Permisos y Roles**.
- La Plantilla Miembro se pre-carga en la vista de plantillas para facilitar la configuración de acceso de nuevos usuarios.

---

## 15. Preguntas frecuentes

**¿Puedo tener múltiples escuelas en la misma cuenta?**  
Sí. La plataforma es multi-tenant. Cada escuela es un tenant independiente con datos completamente aislados.

**¿Qué pasa si accedo a una ruta no permitida?**  
Se muestra una pantalla de acceso denegado con un código de referencia. El evento queda registrado en auditoría.

**¿Lumi tiene acceso a todos mis datos?**  
Lumi respeta el mismo RBAC que el resto de la plataforma. Solo accede a los datos que tu rol permite.

**¿Cómo reporto un problema?**  
Contacta al administrador de tu escuela. Los administradores pueden revisar el log de auditoría y contactar al soporte de LIUMA.

**¿Los datos de mi escuela están separados de otras escuelas?**  
Sí. El aislamiento multi-tenant se aplica en todas las capas: consultas de base de datos, lógica de negocio y UI. No es posible ver datos de otra escuela.

**¿Qué es el maker-checker?**  
Es un mecanismo de aprobación de cuatro ojos para cambios de alto riesgo. El solicitante inicia el cambio y un segundo administrador distinto debe aprobarlo antes de que se aplique.
