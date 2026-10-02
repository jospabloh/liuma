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

**Dentro de la app** este manual tiene una versión corta, buscable y filtrada
por rol: la página **Ayuda** (`/Ayuda`, menú → Soporte → Ayuda), cuyo contenido
vive en `src/lib/help/helpContent.js`. Si cambias un flujo, actualiza los dos.

---

## 0. Primeros pasos

### Dirección: abrir la escuela

1. **Registro.** Entra con tu correo, elige **«Soy Directivo»**, escribe el
   nombre de la escuela (logo opcional) y, en el último paso, acepta el
   [Aviso de Privacidad](/aviso-de-privacidad) y el compromiso de tratar los
   datos sensibles de los alumnos sólo para su cuidado. La escuela queda creada
   con una **prueba gratuita de 30 días** y tú como su administrador.
2. **Configuración** (`/ConfiguracionInicial`): la lista de pasos de arranque
   (datos de la escuela, documentos, calendario). Se marcan conforme avanzas.
3. **Gestión de escuela** (`/GestionEscuela`): crea los salones y da de alta a
   los alumnos (nombre, salón, fecha de nacimiento). Hoy ninguna pantalla
   captura tipo de sangre, alergias ni notas médicas: el modelo `Student` los
   tiene y *Mis hijos* los muestra si existen, pero no hay formulario para ellos.
4. **Invitar.** En tu **Inicio** aparece el **código de la escuela**. Compártelo
   con maestros y familias: lo piden al registrarse.
5. **Aprobar** (`/Aprobaciones`): cada persona que se registra con el código
   queda *pendiente* y no ve nada de la escuela hasta que la apruebas.
6. **Vincular familias con alumnos.** Un padre o madre aprobado sólo ve a los
   alumnos con los que está vinculado. El vínculo se hace desde la ficha del
   alumno (**Gestión de escuela** → salón → alumno → **Vincular**); el maestro
   del salón también puede hacerlo desde su salón.

### Maestros

1. Pide el código a la dirección, regístrate con **«Soy Maestro/a»** y escríbelo.
2. Espera la aprobación. La dirección te asigna tus salones; sólo verás a sus
   alumnos.
3. Vincula a las familias de tus alumnos desde la ficha de cada uno
   (**Gestión de salón → alumno → Vincular**).

### Familias

1. Pide el código a la escuela, regístrate con **«Soy Padre/Madre»** y
   escríbelo.
2. Acepta el Aviso de Privacidad y el **consentimiento expreso** para los datos
   de salud de tus hijos.
3. La escuela aprueba tu cuenta y te vincula con tus hijos; entonces aparecen en
   **Mis hijos**. Si no los ves, pregunta en la escuela si ya te aprobaron y
   vincularon.

### Guías rápidas por rol

| Rol | Lo del día a día |
|---|---|
| **Dirección** | *Operación diaria* para el resumen; *Avisos* y *Alerta de emergencia* para comunicar; *Pagos* para conceptos, cargos y pagos; *Ausencias* para aprobar solicitudes; *Reportes* para indicadores; *Licencias* para el estado de la suscripción; *Permisos y roles* para roles y «Descargar datos de la escuela». |
| **Maestros** | *Asistencia* (salón + fecha → presente/ausente/tarde/justificado); *Bitácoras* para ver quién tiene la del día y *Crear bitácora* para hacerla; *Tareas*; *Avisos* a las familias del salón. |
| **Familias** | *Hoy* con todo lo del día; *Avisos*, *Tareas* y *Bitácora* de tus hijos; *Pagos*; *Solicitar ausencia*; *Contactos de emergencia*. |

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

## 2. Cómo navegar

La navegación sale de una sola fuente (`src/components/nav/navRegistry.js`), por
lo que el menú es idéntico en todos los accesos:

- **En computadora (pantalla ancha):** una **barra lateral fija a la izquierda**
  muestra todo el menú de tu rol agrupado por área. La sección donde estás se
  resalta con un borde de color de marca a la izquierda. Cambiar de sección **no
  te regresa al inicio** — la navegación es interna.
- **En móvil:** una **barra inferior** de cuatro accesos — Inicio · Hoy · Avisos
  · Más. "Más" abre el buscador de comandos.
- **Buscador de comandos (⌘K / Ctrl+K):** desde cualquier pantalla, escribe para
  saltar a cualquier sección de tu rol. También se abre con el botón de búsqueda
  del encabezado de cada página.
- **Tema Claro / Oscuro / Sistema:** un pequeño círculo anclado a una esquina de
  la pantalla, visible desde cualquier página. Al pulsarlo se despliega una
  pista de tres opciones (Claro · Oscuro · Sistema); "Sistema" sigue el modo
  del dispositivo y cambia en vivo si el dispositivo cambia, sin recargar. La
  preferencia se recuerda entre sesiones.

---

## 2b. Iniciar sesión

La pantalla de inicio de sesión (`/login`) tiene la marca de LIUMA — ya no
redirige a una página genérica externa. Ingresa tu correo y contraseña para
entrar. Si tu navegador ya recuerda tu sesión, verás un botón "Continuar
como…" con tu nombre para volver a entrar sin escribir tu contraseña de
nuevo; también puedes elegir usar otra cuenta.

Si el correo o la contraseña no coinciden, verás un mensaje genérico de
error — por seguridad, la app nunca indica si el problema fue el correo o la
contraseña.

---

## 2c. Una cuenta, una escuela

Cada cuenta de LIUMA pertenece a **una sola escuela**. No hay selector de
escuela ni enlace para unirse a una segunda: se retiraron el 2026-09-10 (ver
CLAUDE.md, «Retirado: el selector de escuela»). Quien necesite usar LIUMA en
otra escuela se registra ahí con otro correo.

---

## 3. Secciones compartidas (Admin + Maestro + Padre)

| Página | Ruta | Qué hace | Acciones clave |
|---|---|---|---|
| **Inicio** | `/Home` | Tablero principal; dirige al inicio según tu rol. | Aterrizas en tu panel; el admin ve el modal de bienvenida/prueba en su primera visita. |
| **Operación Diaria** | `/OperacionDiaria` | Línea de tiempo del día: asistencia, tareas, bitácora, avisos y eventos (filtrada por rol). | Filtrar por categoría/urgencia; abrir el origen. |
| **Calendario Escolar** | `/CalendarioEscolar` | Calendario mensual con eventos de hoy y próximos. | Ver eventos; el **admin** crea/edita/elimina eventos. |
| **Soporte** | `/Soporte` | Mesa de ayuda: preguntar a Lumi o abrir y seguir tickets. Al crear un ticket, la app adjunta automáticamente el diagnóstico técnico (pantalla, versión, navegador y eventos recientes) — sólo escribes tu problema. | "Preguntar a Lumi"; "Crear ticket"; ver/responder tus tickets. |
| **Ayuda** | `/Ayuda` | Este manual en versión corta: primeros pasos y guía rápida de tu rol, con buscador. Al pie, el Aviso de Privacidad, los Términos, la versión y el correo de soporte. | Buscar; leer. |
| **Historial de Cambios** | `/HistorialCambios` | Resumen en lenguaje sencillo de las novedades recientes de LIUMA, con la versión actual en el pie. | Sólo lectura. |

---

## 4. Sección Padre / Madre

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
| **Pagos** | `/Pagos` | Padre | Cargos pendientes/pagados por hijo (vencidos calculados en pantalla). | Filtrar por hijo; ver cargos por concepto/vencimiento/estado. |
| **Contactos de Emergencia** | `/ContactosEmergencia` | Padre | Contactos de emergencia por hijo (teléfono, parentesco, autorización de recogida). | Agregar/eliminar contacto; marcar "autorizado para recoger". |
| **Solicitar Ausencia** | `/SolicitarAusencia` | Padre | Notificar una ausencia planeada con motivo. | Elegir hijo + fecha + motivo; enviar; ver estado. |
| **Pedidos de Uniformes** | `/PedidosUniformes` | Padre | Pedir uniformes con tallas/medidas y seguimiento. | Crear pedido; ver historial/estado. |

---

## 5. Sección Maestro

| Página | Ruta | Acceso | Qué hace | Acciones clave |
|---|---|---|---|---|
| **Asistencia** | `/Asistencia` | Maestro, Padre | El maestro registra asistencia diaria; el padre consulta el historial de sus hijos. | Maestro: salón/fecha → presente/ausente/tarde/justificado. Padre: ver resumen. |
| **Gestión de Salón** | `/GestionSalon` | Admin, Maestro | Un salón: plantilla docente + alumnos inscritos. | Admin: "Asignar"/quitar maestros. Ambos: abrir el detalle de un alumno. |
| **Gestión de Alumno** | `/GestionAlumno` | Admin, Maestro | Un alumno: datos + tutores vinculados. | "Vincular" un padre (con parentesco); desvincular. |
| **Bitácoras del Maestro** | `/BitacorasMaestro` | Maestro | Avance de bitácoras del día en los salones asignados. | Ver quién tiene/falta entrada; abrir un salón. |
| **Crear Bitácora** | `/CrearBitacora` | Maestro | Asistente de 4 pasos para crear la bitácora diaria de un alumno (texto opcional con Lumi). | Elegir alumno; llenar campos; revisar y decidir si se notifica a los padres. |
| **Tarea del Maestro** | `/TareaMaestro` | Maestro | Listar y crear tareas para sus salones. | "+ Crear" (salón, materia, título, descripción, fecha); ver lista. |
| **Avisos del Maestro** | `/AvisosMaestro` | Maestro | Asistente de 3 pasos para enviar avisos a los padres del salón. | Salón + prioridad; redactar; confirmar y enviar. |

### Páginas compartidas Admin + Maestro

| Página | Ruta | Acceso | Qué hace | Acciones clave |
|---|---|---|---|---|
| **Gestión de Ausencias** | `/GestionAusencias` | Admin | Revisar solicitudes de ausencia; aprobar/rechazar y actualizar asistencia. | Abrir solicitud PENDIENTE; aprobar/rechazar con nota. |
| **Resumen de Asistencia** | `/ResumenAsistencia` | Admin | Analítica de asistencia por periodo y salón. | Elegir periodo (día/semana/mes); filtrar por salón. |

---

## 6. Sección Administrador / Directivo

> **Gestión de Salón** y **Gestión de Alumno** son hoy sólo de maestros
> (`routeAccess.js`): la dirección ve salones y alumnos desde *Gestión de
> escuela*, pero la asignación de maestros y el vínculo con las familias los
> hace el maestro. Si eso cambia, actualiza también §0 y `helpContent.js`.

| Página | Ruta | Qué hace | Acciones clave |
|---|---|---|---|
| **Gestión de Escuela** | `/GestionEscuela` | Estructura escolar: salones + alumnos, con control de cupo por licencia. | Crear salones; agregar alumnos (bloqueado en sólo-lectura o sobre cupo). |
| **Configuración Inicial** | `/ConfiguracionInicial` | Lista de configuración por categoría (General/Guardería/Escuela/Colegio). | Marcar pasos; subir documentos. Lumi puede guiar este proceso. |
| **Gestión de Documentos** | `/GestionDocumentos` | Documentos oficiales (MENU/COMMUNICATION/MINUTA/UNIFORM_CATALOG). | Subir PDF + metadatos; marcar vigente; eliminar versiones viejas. |
| **Gestión de Descuentos** | `/GestionDescuentos` | Descuentos sobre conceptos de pago. | Crear descuento %/fijo con vigencia; activar/desactivar. |
| **Gestión de Pedidos** | `/GestionPedidosAdmin` | Seguimiento de pedidos de uniformes. | Avanzar estado (Pendiente→Proceso→Listo→Entregado); notas. |
| **Pagos (Admin)** | `/PagosAdmin` | Registro de cargos y pagos con vencimiento automático y recordatorios. | Crear conceptos; generar cargos (con descuento); registrar pagos. |
| **Aprobaciones** | `/Aprobaciones` | Cola de aprobación de usuarios nuevos. | Aprobar/rechazar usuarios (auditado). |
| **Permisos y Roles** | `/PermisosRoles` | Matriz de permisos / roles con control "maker-checker"; también la zona de peligro de la cuenta. | Solicitar cambios de rol (los de admin requieren aprobación de un segundo admin); definir overrides por usuario; plantillas/rollback. **Zona de peligro:** "Descargar mis datos" exporta todo lo que la escuela posee en un archivo; "Solicitar eliminación de la escuela" abre un ticket de soporte de alta prioridad — no borra nada directamente, lo atiende una persona. |
| **Auditoría** | `/AuditoriaAdmin` | Visor del registro de auditoría (cambios de permisos, eventos sensibles). | Buscar/filtrar por actor/entidad/acción/motivo; exportar CSV. |
| **Avisos (Admin)** | `/AvisosAdmin` | Difusión de avisos a toda la escuela / salón / alumno. | Asistente de 3 pasos: alcance → mensaje → confirmar. |
| **Alerta de Emergencia** | `/AlertaEmergencia` | Alerta de emergencia a padres y maestros. | Redactar mensaje; enviar alerta de alta prioridad (doble confirmación). |
| **Reportes** | `/Reportes` | Tablero de indicadores (asistencia, bitácoras, pagos pendientes, avisos). | Filtrar por fecha/salón/estado; exportar CSV/PDF. |
| **Soporte (Admin)** | `/SoporteAdmin` | Consola de gestión de tickets para el admin escolar / propietario. | Filtrar por prioridad/estado; responder; cambiar estado. |
| **Panel de Soporte** | `/PanelSoporte` | Tablero de triaje de soporte (pendientes/urgentes/SLA incumplido). | Ver métricas; entrar a un ticket. |
| **Mi Licencia** | `/LicenseAdmin` | Doble modo: el admin escolar ve su suscripción (sólo lectura); el propietario de plataforma administra todas las escuelas. | Admin: ver estado. Propietario: confirmar pagos, fijar nivel/vigencia/estado. |

---

## 7. Asistente Lumi (IA)

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

## 8. Notificaciones, soporte y suscripción

- **Notificaciones:** avisos, bitácoras enviadas, ausencias y alertas se
  entregan en la app y por correo. **No hay pantalla de preferencias de canal**:
  los campos `notification_preferences` existen en los datos, pero nada en la
  app permite editarlos. Quien no quiera recibir correos lo pide por Soporte.
- **Soporte:** primero Lumi; si se requiere seguimiento, se abre un ticket
  (`SupportTicket`) con número, estado y SLA. Los admins lo gestionan en
  `/SoporteAdmin` y `/PanelSoporte`.
- **Suscripción y prueba:** cada escuela nueva empieza con una **prueba de 30
  días**. Sin licencia pagada —prueba vencida, falta de pago o escuela sin
  registro de suscripción— la escuela queda en **sólo lectura**: se puede
  consultar todo y la dirección puede descargar los datos, pero no registrar
  nada, hasta pagar (decisión del dueño, 2026-09-29: fallar cerrado). La dirección ve avisos **antes** del
  vencimiento y un banner de sólo lectura **después**, siempre con la forma de
  pagar (Mercado Pago; mientras no haya enlace configurado, WhatsApp). La
  suscripción se lee con la función `getMySubscription` y el servidor
  (`guardedEntityWrite`) aplica la misma regla, así que ambos lados coinciden.
  Una **prueba** vencida bloquea al día siguiente. Una licencia **pagada** que
  vence sin renovarse sigue editable hasta que Mission Control escribe
  `view_only` (8 días), porque ese periodo de gracia lo corre Mission Control,
  no LIUMA (estándar ACACIA, módulo 1); a los 15 días → `suspended` (en LIUMA
  también es sólo lectura); a los 45 → elegible para borrado con aviso. Los
  Términos prometen menos que eso (sólo lectura al vencer) a propósito, hasta que
  un abogado decida qué gracia se compromete por escrito.
  La licencia se consulta en `/LicenseAdmin`. Detalle comercial en los
  [Términos del servicio](/terminos).

---

## 8b. Gestión de sesiones activas (AppSession)

Cada vez que un usuario inicia sesión en un navegador o dispositivo, la app
registra una **sesión activa** (`AppSession`). La sesión se mantiene actualizada
con un latido cada 60 segundos.

**Lo que esto significa para los usuarios:**

- Cada pestaña o dispositivo abierto genera su propia sesión.
- La sesión registra el tipo de navegador y sistema operativo
  (por ejemplo, "Chrome · macOS") pero **no** el contenido de las páginas
  visitadas.

**Control desde Mission Control (ACACIA — propietario de plataforma):**

- El equipo de ACACIA puede ver las sesiones activas de todos los usuarios
  para soporte operativo.
- Si es necesario (por seguridad o soporte), ACACIA puede **forzar el cierre
  de sesión** de un usuario en tiempo real. La app detecta el cierre en el
  siguiente latido y desconecta al usuario automáticamente.

**Alcance de datos:**

- Cada usuario sólo puede ver y modificar sus propias sesiones.
- La plataforma (ACACIA) puede leer y revocar sesiones a través del rol de
  servicio. No hay acceso cruzado entre usuarios ni entre escuelas.

---

## 9. Privacidad

- **Aislamiento por escuela:** cada inquilino ve sólo sus datos
  (`school_id`).
- **Datos de alumnos:** padres ven sólo a sus hijos; maestros sólo a los alumnos
  de sus salones; admins a su escuela.
- **Aviso de Privacidad y Términos:** públicos dentro de la app en
  [`/aviso-de-privacidad`](/aviso-de-privacidad) y [`/terminos`](/terminos)
  (sin sesión, porque quien los lee todavía no tiene perfil). **Vigentes desde
  el 2 de octubre de 2026** (versión `2026-10-02`). Identifican a ACACIA (razón
  social, RFC y domicilio de la sociedad); la escuela es la **responsable** y
  ACACIA el **encargado** (Base44 y sus proveedores, subencargados). Nombran a
  los proveedores (Base44 —hosting, datos y correo—; Anthropic, Google y OpenAI
  como modelos de IA que Base44 elige para Lumi; Mercado Pago sólo para el cobro
  de la licencia), la tabla de conservación con días, el procedimiento ARCO
  (20 días hábiles), la revocación y «Eliminar mi cuenta y mis datos». El texto
  vive en `src/lib/legal/legalDocs.js`; la investigación y sus fuentes, en
  `docs/legal-research-2026-10.md`.
- **Consentimiento (LFPDPPP):** el onboarding pide aceptar el aviso y los
  términos y, para familias, el consentimiento expreso para los datos sensibles
  de sus hijos; el personal se compromete a tratarlos sólo para el cuidado del
  alumno. El servidor (`provisionOnboardingProfile`) escribe un
  `ConsentRecord` con la versión aceptada (`PRIVACY_NOTICE_VERSION`, hoy
  `2026-10-02`), la fecha y el navegador, y rechaza cualquier otra versión.

---

*Las rutas y accesos de este manual reflejan `routeAccess.js`. Cualquier cambio
de control de acceso debe reflejarse aquí y en `docs/authorization-matrix.md`.*
