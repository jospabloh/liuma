# Manual de Usuario — LIUMA

> Generado a partir del código real de la aplicación: rutas en
> `src/pages/`, control de acceso en `src/lib/authorization/routeAccess.js`,
> entidades en `base44/entities/` y el asistente Lumi en
> `base44/agents/lumi.jsonc` + `src/lib/lumi/capabilities.js`.
> Cada página indica **quién puede acceder** según `routeAccess.js`.

LIUMA es una plataforma multi-inquilino (multi-escuela) para la gestión escolar
diaria: asistencia, tareas, bitácora, avisos, calendario, pagos, pedidos de
uniformes y comunicación entre la escuela y las familias. Cada escuela ("tenant")
ve únicamente sus propios datos.

---

## 1. Roles y acceso

| Rol | Quién | Alcance |
|---|---|---|
| **Administrador / Directivo** (`ADMIN`) | Dirección y coordinación de la escuela | Toda la escuela |
| **Maestro** (`TEACHER`) | Docentes | Sólo sus salones asignados |
| **Padre / Madre** (`PARENT`) | Familias | Sólo sus hijos vinculados |

El acceso a cada pantalla se decide por rol. Existe además una identidad de
**propietario de plataforma** (ACACIA) para soporte y administración de licencias
entre escuelas.

---

## 2. Secciones compartidas (Admin + Maestro + Padre)

| Página | Ruta | Qué hace | Acciones clave |
|---|---|---|---|
| **Inicio** | `/Home` | Tablero principal; dirige al inicio según tu rol. | Aterrizas en tu panel; el admin ve el modal de bienvenida/prueba en su primera visita. |
| **Operación Diaria** | `/OperacionDiaria` | Línea de tiempo del día: asistencia, tareas, bitácora, avisos y eventos (filtrada por rol). | Filtrar por categoría/urgencia; abrir el origen. |
| **Calendario Escolar** | `/CalendarioEscolar` | Calendario mensual con eventos de hoy y próximos. | Ver eventos; el **admin** crea/edita/elimina eventos. |
| **Soporte** | `/Soporte` | Mesa de ayuda: preguntar a Lumi o abrir y seguir tickets. | "Preguntar a Lumi"; "Crear ticket"; ver/responder tus tickets. |

---

## 3. Sección Padre / Madre

| Página | Ruta | Acceso | Qué hace | Acciones clave |
|---|---|---|---|---|
| **Mis Hijos** | `/MisHijos` | Padre | Lista de hijos vinculados (edad, tipo de sangre, alergias, salón). | Ver perfiles; abrir contactos de emergencia o la bitácora. |
| **Eventos para Padres** | `/EventosParaPadres` | Padre | Confirmar asistencia a eventos. **Aceptar un evento de pago genera un cargo** (ChargeItem). | Elegir hijo; aceptar/declinar evento. |
| **Avisos** | `/Avisos` | Padre | Bandeja de avisos con filtros de prioridad/lectura; rastrea urgentes sin confirmar. | Filtrar; abrir aviso; marcar como leído. |
| **Tarea** | `/Tarea` | Padre | Tareas de los hijos por fecha de entrega (hoy / esta semana). | Filtrar por hijo; abrir tarea con archivos. |
| **Bitácora** | `/Bitacora` | Padre | Bitácora diaria (ánimo, comidas, sueño, aprendizaje, incidencias). | Navegar fechas; abrir una entrada. |

### Páginas compartidas Padre + Admin

| Página | Ruta | Acceso | Qué hace | Acciones clave |
|---|---|---|---|---|
| **Pagos** | `/Pagos` | Padre, Admin | Cargos pendientes/pagados por hijo (vencidos calculados en pantalla). | Filtrar por hijo; ver cargos por concepto/vencimiento/estado. |
| **Contactos de Emergencia** | `/ContactosEmergencia` | Padre, Admin | Contactos de emergencia por hijo (teléfono, parentesco, autorización de recogida). | Agregar/eliminar contacto; marcar "autorizado para recoger". |
| **Solicitar Ausencia** | `/SolicitarAusencia` | Padre, Admin | Notificar una ausencia planeada con motivo. | Elegir hijo + fecha + motivo; enviar; ver estado. |
| **Pedidos de Uniformes** | `/PedidosUniformes` | Padre, Admin | Pedir uniformes con tallas/medidas y seguimiento. | Crear pedido; ver historial/estado. |

---

## 4. Sección Maestro

| Página | Ruta | Acceso | Qué hace | Acciones clave |
|---|---|---|---|---|
| **Asistencia** | `/Asistencia` | Maestro, Padre | El maestro registra asistencia diaria; el padre consulta el historial de sus hijos. | Maestro: salón/fecha → presente/ausente/tarde/justificado. Padre: ver resumen. |
| **Gestión de Salón** | `/GestionSalon` | Maestro | Un salón: plantilla docente + alumnos inscritos. | "Asignar" maestros; abrir el detalle de un alumno. |
| **Gestión de Alumno** | `/GestionAlumno` | Maestro | Un alumno: datos + tutores vinculados. | "Vincular" un padre (con parentesco); desvincular. |
| **Bitácoras del Maestro** | `/BitacorasMaestro` | Maestro | Avance de bitácoras del día en los salones asignados. | Ver quién tiene/falta entrada; abrir un salón. |
| **Crear Bitácora** | `/CrearBitacora` | Maestro | Asistente de 4 pasos para crear la bitácora diaria de un alumno (texto opcional con Lumi). | Elegir alumno; llenar campos; revisar y decidir si se notifica a los padres. |
| **Tarea del Maestro** | `/TareaMaestro` | Maestro | Listar y crear tareas para sus salones. | "+ Crear" (salón, materia, título, descripción, fecha); ver lista. |
| **Avisos del Maestro** | `/AvisosMaestro` | Maestro | Asistente de 3 pasos para enviar avisos a los padres del salón. | Salón + prioridad; redactar; confirmar y enviar. |

### Páginas compartidas Admin + Maestro

| Página | Ruta | Acceso | Qué hace | Acciones clave |
|---|---|---|---|---|
| **Gestión de Ausencias** | `/GestionAusencias` | Admin, Maestro | Revisar solicitudes de ausencia; aprobar/rechazar y actualizar asistencia. | Abrir solicitud PENDIENTE; aprobar/rechazar con nota. |
| **Resumen de Asistencia** | `/ResumenAsistencia` | Admin, Maestro | Analítica de asistencia por periodo y salón. | Elegir periodo (día/semana/mes); filtrar por salón. |

---

## 5. Sección Administrador / Directivo

| Página | Ruta | Qué hace | Acciones clave |
|---|---|---|---|
| **Gestión de Escuela** | `/GestionEscuela` | Estructura escolar: salones + alumnos, con control de cupo por licencia. | Crear salones; agregar alumnos (bloqueado en sólo-lectura o sobre cupo). |
| **Configuración Inicial** | `/ConfiguracionInicial` | Lista de configuración por categoría (General/Guardería/Escuela/Colegio). | Marcar pasos; subir documentos. Lumi puede guiar este proceso. |
| **Gestión de Documentos** | `/GestionDocumentos` | Documentos oficiales (MENU/COMMUNICATION/MINUTA/UNIFORM_CATALOG). | Subir PDF + metadatos; marcar vigente; eliminar versiones viejas. |
| **Gestión de Descuentos** | `/GestionDescuentos` | Descuentos sobre conceptos de pago. | Crear descuento %/fijo con vigencia; activar/desactivar. |
| **Gestión de Pedidos** | `/GestionPedidosAdmin` | Seguimiento de pedidos de uniformes. | Avanzar estado (Pendiente→Proceso→Listo→Entregado); notas. |
| **Pagos (Admin)** | `/PagosAdmin` | Registro de cargos y pagos con vencimiento automático y recordatorios. | Crear conceptos; generar cargos (con descuento); registrar pagos. |
| **Aprobaciones** | `/Aprobaciones` | Cola de aprobación de usuarios nuevos. | Aprobar/rechazar usuarios (auditado). |
| **Permisos y Roles** | `/PermisosRoles` | Matriz de permisos / roles con control "maker-checker". | Solicitar cambios de rol (los de admin requieren aprobación de un segundo admin); definir overrides por usuario; plantillas/rollback. |
| **Auditoría** | `/AuditoriaAdmin` | Visor del registro de auditoría (cambios de permisos, eventos sensibles). | Buscar/filtrar por actor/entidad/acción/motivo; exportar CSV. |
| **Avisos (Admin)** | `/AvisosAdmin` | Difusión de avisos a toda la escuela / salón / alumno. | Asistente de 3 pasos: alcance → mensaje → confirmar. |
| **Alerta de Emergencia** | `/AlertaEmergencia` | Alerta de emergencia a padres y maestros. | Redactar mensaje; enviar alerta de alta prioridad (doble confirmación). |
| **Reportes** | `/Reportes` | Tablero de indicadores (asistencia, bitácoras, pagos pendientes, avisos). | Filtrar por fecha/salón/estado; exportar CSV/PDF. |
| **Soporte (Admin)** | `/SoporteAdmin` | Consola de gestión de tickets para el admin escolar / propietario. | Filtrar por prioridad/estado; responder; cambiar estado. |
| **Panel de Soporte** | `/PanelSoporte` | Tablero de triaje de soporte (pendientes/urgentes/SLA incumplido). | Ver métricas; entrar a un ticket. |
| **Mi Licencia** | `/LicenseAdmin` | Doble modo: el admin escolar ve su suscripción (sólo lectura); el propietario de plataforma administra todas las escuelas. | Admin: ver estado. Propietario: confirmar pagos, fijar nivel/vigencia/estado. |

---

## 6. Asistente Lumi (IA)

Lumi es el asistente conversacional, en español (México). Definido en
`base44/agents/lumi.jsonc` con reglas de alcance en
`src/lib/lumi/capabilities.js`.

**Lo que Lumi sí hace:**
- **Crear bitácora por dictado** (maestros): captura ánimo, comidas, sueño,
  baño (pipí/popó), notas, necesidades (pañales/pomada/muda), uniforme y un
  mensaje del maestro, y **crea una `DiaryEntry`**.
- **Asistencia** (maestros): puede **crear/actualizar `Attendance`**
  (presente/ausente/tarde/justificado) y responder "quién faltó hoy / esta
  semana" y patrones de ausentismo.
- **Consultas** (según rol): tareas, avisos/eventos, documentos oficiales
  vigentes, menú semanal, estado de pedidos de uniformes, información de
  pagos/cargos, historial de comportamiento/ánimo/comida/sueño, y guía de
  configuración inicial de la escuela.
- **Soporte:** puede encaminar una solicitud de soporte (`support_request`).

**Lo que Lumi no hace:** no tiene escritura sobre pagos, avisos, permisos,
alumnos ni configuración de la escuela (sólo lectura ahí). No inventa datos:
responde "Aún no hay información registrada" cuando no la hay.

**Límites de alcance (forzados):** los padres sólo ven a sus hijos vinculados;
los maestros sólo sus salones; los admins sólo su escuela. Sin `school_id` no
hay acceso. Una solicitud de un padre con un `student_id` que no es su hijo se
bloquea (`student_scope_mismatch`).

| Intención | Entidad | Roles |
|---|---|---|
| Consulta de tareas | Homework | Admin, Maestro, Padre |
| Estado de asistencia | Attendance | Admin, Maestro, Padre |
| Resumen de avisos | Notice | Admin, Maestro, Padre |
| Recordatorios de pago | ChargeItem | Admin, Padre |
| Resumen de comportamiento | DiaryEntry | Admin, Maestro, Padre |
| Agendar/recordar | Notice | Admin, Maestro, Padre |
| Solicitud de soporte | SupportTicket | Admin, Maestro, Padre |

---

## 7. Notificaciones, soporte y suscripción

- **Notificaciones:** avisos y eventos se entregan en la app y por correo; las
  preferencias de canal se administran desde la configuración de la escuela.
- **Soporte:** primero Lumi; si se requiere seguimiento, se abre un ticket
  (`SupportTicket`) con número, estado y SLA. Los admins lo gestionan en
  `/SoporteAdmin` y `/PanelSoporte`.
- **Suscripción y prueba:** las escuelas inician con una prueba; en estado
  `view_only`/`suspended` la app pasa a **sólo lectura** (banners y modales lo
  indican). La licencia se administra en `/LicenseAdmin`.

---

## 8. Privacidad

- **Aislamiento por escuela:** cada inquilino ve sólo sus datos
  (`school_id`).
- **Datos de alumnos:** padres ven sólo a sus hijos; maestros sólo a los alumnos
  de sus salones; admins a su escuela.
- **Consentimiento (LFPDPPP):** el onboarding requiere aceptar el Aviso de
  Privacidad y el consentimiento expreso para datos sensibles de menores; la
  aceptación se registra (`ConsentRecord` / `AuditLog`).

---

*Las rutas y accesos de este manual reflejan `routeAccess.js`. Cualquier cambio
de control de acceso debe reflejarse aquí y en `docs/authorization-matrix.md`.*
