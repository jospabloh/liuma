# Authorization matrix

## Route-access matrix

### ADMIN-only routes
- /Aprobaciones
- /AlertaEmergencia
- /AuditoriaAdmin
- /AvisosAdmin
- /CalendarioEscolar
- /ConfiguracionInicial
- /GestionDescuentos
- /GestionDocumentos
- /GestionEscuela
- /GestionPedidosAdmin
- /PagosAdmin
- /PermisosRoles
- /Reportes

### TEACHER-only routes
- /AvisosMaestro
- /BitacorasMaestro
- /CrearBitacora
- /GestionAlumno
- /GestionAusencias
- /GestionSalon
- /ResumenAsistencia
- /TareaMaestro

### PARENT-only routes
- /Asistencia
- /Avisos
- /Bitacora
- /EventosParaPadres
- /MisHijos
- /Tarea

### Shared routes
- ADMIN + PARENT: /ContactosEmergencia, /Pagos, /PedidosUniformes, /SolicitarAusencia
- ADMIN + TEACHER + PARENT: /Home, /OperacionDiaria

## Entity authorization

| Entity | ADMIN | TEACHER | PARENT | Row-level constraints |
|---|---|---|---|---|
| Notice | Read/Write | Read/Write | Read | school_id + (classroom_id OR student_id by scope) |
| Attendance | Read/Write | Read/Write | Read | school_id + classroom_id + student_id |
| Homework | Read/Write | Read/Write | Read | school_id + classroom_id |
| DiaryEntry | Read/Write | Read/Write | Read | school_id + classroom_id + student_id |
| ChargeItem | Read/Write | No access | Read | school_id + student_id(parent-student link) |
| PaymentConcept | Read/Write | No access | No access | school_id |
| PaymentRecord | Read/Write | No access | No access | school_id + student_id |

## Parent-student link

For `PARENT`, every `student_id` scoped query must come from active `ParentStudent` links (`parent_id = current user`, `status = ACTIVE`).
