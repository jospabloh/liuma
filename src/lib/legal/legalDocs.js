/**
 * LIUMA legal texts — Aviso de Privacidad and Términos del servicio.
 *
 * VIGENTE desde el 2 de octubre de 2026 (owner decision: the text is final and
 * the owner accepts the risk of publishing it without an outside lawyer's
 * review). The research behind every clause — articles of the LFPDPPP of
 * 2025, Código Civil Federal, Código de Comercio, LFPC, Código Fiscal, and
 * what Base44 publishes about itself — is in docs/legal-research-2026-10.md,
 * with sources. Read it before changing a clause: several sentences here are
 * there because a law requires them, and a few because Base44's own pages
 * forced a less comfortable wording (see BASE44_AI_TRAINING_EXCLUDED).
 *
 * Pure data (no JSX, no imports beyond constants) so `node --test` can load it
 * and assert what the notice has to say. The page that renders it is
 * src/components/legal/LegalDocumentPage.jsx, mounted by src/App.jsx at
 * PRIVACY_NOTICE_PATH / SERVICE_TERMS_PATH as PUBLIC routes.
 *
 * Changing the text: edit it here and bump PRIVACY_NOTICE_VERSION /
 * SERVICE_TERMS_VERSION in src/lib/consent/privacyNotice.js AND in
 * base44/functions/provisionOnboardingProfile/entry.ts (a test fails if they
 * differ). Every ConsentRecord pins the version it accepted.
 *
 * Commercial numbers (trial length, plans) are read from licenseModel.js rather
 * than retyped, because the audit found the published terms contradicting the
 * app (acaciaco-site terminos.html said the 30-day trial was StockFlow/FlowFin
 * only while the app seeds one for every new school).
 */
import {
  PRIVACY_NOTICE_VERSION,
  PRIVACY_NOTICE_STATUS,
  PRIVACY_NOTICE_PATH,
  SERVICE_TERMS_VERSION,
  SERVICE_TERMS_PATH,
} from '../consent/privacyNotice.js';
import { TRIAL_DURATION_DAYS, PLAN_TIERS, PLAN_CATALOG } from '../license/licenseModel.js';

// ── Who ACACIA is ────────────────────────────────────────────────────────────
// Legal identity of the persona moral, as registered with the SAT (Constancia
// de Situación Fiscal of 2026-10-01). The ONLY place these values are typed:
// every sentence below that names ACACIA reads them from here, and a test
// fails if the RFC appears anywhere else in this file. Never put a natural
// person's RFC, CURP or home address in any legal text — the company's are the
// only ones that belong here.
export const ACACIA_LEGAL_IDENTITY = Object.freeze({
  legalName: 'ACACIA CONSULTORIA EN INFORMATICA Y COMPUTO, S.A. de C.V.',
  tradeName: 'ACACIA',
  rfc: 'ACI1902061S9',
  address: 'Calle Arroyo El Molino 1001, Int. 102, Col. San Telmo, C.P. 20115, Aguascalientes, Aguascalientes, México',
  email: 'contacto@acaciaco.com.mx',
  website: 'https://acaciaco.com.mx',
});

const ID = ACACIA_LEGAL_IDENTITY;
export const ACACIA_LEGAL_NAME = ID.legalName;
export const ACACIA_CONTACT_EMAIL = ID.email;
export const ACACIA_SUPPORT_EMAIL = 'soporte@acaciaco.com.mx';
export const ARCO_EMAIL_SUBJECT = 'Derechos ARCO – LIUMA';

/** The sentence that identifies ACACIA in both documents. */
export function acaciaIdentityLine() {
  return ID.legalName + ' ("' + ID.tradeName + '"), RFC ' + ID.rfc + ', con domicilio en ' + ID.address
    + ', correo ' + ID.email + ' y sitio ' + ID.website;
}

export const LEGAL_EFFECTIVE_DATE = '2 de octubre de 2026';

// LFPDPPP 2025, art. 31: answer within 20 días (hábiles, art. 2 VIII), make it
// effective within 15 more; each term can be extended once.
export const ARCO_RESPONSE_DAYS = 20;
export const ARCO_EFFECT_DAYS = 15;

// The in-app path the consent package (v1.9.0) builds. Quoted, not linked:
// the notice is public and the button lives behind a session.
export const ACCOUNT_DELETION_LABEL = 'Eliminar mi cuenta y mis datos';

// Days after an unpaid renewal date, per Mission Control's liuma lifecycle
// config (acacia-mission-control/api/_lib/licenseControl.js → liuma.lifecycle).
// Mission Control runs the lifecycle, not LIUMA (standard, module 1), so these
// are quoted here, not enforced here. If MC changes them, change them here.
export const LIFECYCLE_GRACE_DAYS = {
  toReadOnly: 8,
  toSuspended: 15,
  toDeletionEligible: 45,
};

// Days ACACIA takes to purge data from the active database once it is due
// (end of contract + download window, or an account deletion request).
// MIRRORED in base44/functions/deleteMyAccount/_deletion.ts (the e-mail that
// reminds ACACIA of the purge); tests/unit/account-deletion.test.js checks it.
export const PURGE_DAYS = 30;

// Lumi conversations. Until 2026-10-02 the notice promised they were deleted
// with the account. They cannot be, by LIUMA: the SDK's agents module has no
// delete, and Base44's platform API only lists and reads conversations
// (checked in its API catalog). The consent package (v1.9.0) changed the
// text to what is true — ACACIA asks Base44 — before any user accepted this
// version (production had only 2026-09-29 draft consents that day), so the
// version string did not need a bump.
const LUMI_CONVERSATIONS_PARAGRAPH = 'Las conversaciones con Lumi se guardan en tu cuenta para que puedas retomarlas; nadie de tu escuela puede verlas. Base44 las almacena y no ofrece a LIUMA una forma de borrarlas por sí misma: cuando eliminas tu cuenta, ACACIA solicita a Base44 su supresión.';

// ── Base44 and AI training ───────────────────────────────────────────────────
// docs.base44.com/Community-and-support/Privacy-and-security (read 2026-10-02):
// "Enterprise: your data is not used to train AI models. […] All other plans:
// your data can be used to train AI models. The Enterprise exclusion covers
// your whole workspace, including personal information that people submit
// through your app's forms." Nothing in this repo or the Base44 API shows the
// LIUMA workspace on Enterprise, so the notice may NOT promise "no training".
// Flip to true ONLY with evidence (Enterprise invoice, or a written exclusion
// from Base44) — the text below changes with it and a test pins that.
export const BASE44_AI_TRAINING_EXCLUDED = false;

// Model providers Base44 publishes for app agents and LLM calls. Lumi runs
// with model "automatic" (base44/agents/lumi.jsonc), so Base44 — not LIUMA —
// picks the model per message. Anthropic and OpenAI are in Base44's DPA
// sub-processor list (base44.com/dpa/exhibitc); Google Gemini is a model
// option in its agent docs. Base44 also lists "GLM" (Z.ai's model) as an agent
// model option, but does not say who runs it, where, or whether "Automatic"
// ever picks it — so the notice names GLM in a sentence (GLM_DISCLOSURE)
// instead of claiming a provider and a country it cannot source.
export const AI_MODEL_PROVIDERS = [
  { name: 'Anthropic', models: 'Claude', location: 'Estados Unidos' },
  { name: 'Google', models: 'Gemini', location: 'Estados Unidos' },
  { name: 'OpenAI', models: 'GPT', location: 'Estados Unidos' },
];

// docs.base44.com/Building-your-app/AI-agents-for-apps (read 2026-10-02):
// "Automatic […] picks a fast, general-purpose model for each message"; the
// options listed include GLM next to the Claude, Gemini and GPT models.
const GLM_DISCLOSURE = 'Base44 ofrece además el modelo GLM (desarrollado por Z.ai) entre sus opciones, y no publica qué modelo elige en cada mensaje ni, en el caso de GLM, qué empresa lo ejecuta ni en qué país.';

function aiProviderNames() {
  return AI_MODEL_PROVIDERS.map((p) => p.name + ' (' + p.models + ')').join(', ');
}

// Parties that process personal data on ACACIA's behalf. Base44 is ACACIA's
// subencargado; the companies Base44 lists in its DPA (Exhibit C) are, in turn,
// Base44's sub-processors. Named individually because a school's compliance
// review asks exactly this.
export const DATA_PROCESSORS = [
  {
    name: 'Base44',
    role: 'Plataforma en la nube (operada por Wix.com Ltd. y sus filiales) donde se ejecuta LIUMA: aloja la base de datos y los archivos, ejecuta las funciones del servidor, envía los correos y da acceso a los modelos de inteligencia artificial. Certificaciones publicadas: SOC 2 Tipo II e ISO/IEC 27001. Sus propios subencargados, según su lista pública: MongoDB (almacenamiento de datos), Render (servidores), Supabase (archivos y fotografías), SendGrid (envío de correo), Google Cloud (analítica), Datadog (registros técnicos), Logfire (registros técnicos, Reino Unido), Langfuse (registros de solicitudes a modelos de IA, Alemania), Anthropic y OpenAI (modelos de IA) y Wix.com Ltd. (Israel).',
    location: 'Estados Unidos (servidores); Israel, Alemania y Reino Unido (algunos subencargados)',
  },
  {
    name: 'Anthropic',
    role: 'Proveedor de modelos de inteligencia artificial (Claude), al que LIUMA accede sólo a través de Base44, para Lumi y la redacción asistida. Recibe el texto necesario para responder la solicitud en curso.',
    location: 'Estados Unidos',
  },
  {
    name: 'Google',
    role: 'Proveedor de modelos de inteligencia artificial (Gemini) que Base44 puede elegir para responder a Lumi. Recibe el texto necesario para responder la solicitud en curso.',
    location: 'Estados Unidos',
  },
  {
    name: 'OpenAI',
    role: 'Proveedor de modelos de inteligencia artificial (GPT) que Base44 puede elegir para responder a Lumi o a la redacción asistida. Recibe el texto necesario para responder la solicitud en curso.',
    location: 'Estados Unidos',
  },
  {
    name: 'Mercado Pago',
    role: 'Cobro de la licencia de la escuela a ACACIA. No recibe datos de alumnos ni de familias; ACACIA no almacena datos de tarjetas.',
    location: 'México',
  },
];

/** The processors that the notice must name (used by the page and the tests). */
export function processorNames() {
  return DATA_PROCESSORS.map((p) => p.name);
}

// ── Retention ────────────────────────────────────────────────────────────────
// LFPDPPP art. 10 (suprimir previo bloqueo when no longer needed; 72 months
// cap for data about a contractual breach), art. 12 (minimum period for
// sensitive data), art. 24 (bloqueo = prescripción of the actions). Days are
// días naturales unless said otherwise.
export const RETENTION_TABLE = [
  {
    data: 'Datos de la comunidad escolar: alumnos (incluidos sus datos de salud), bitácora diaria, asistencia, ausencias, tareas, avisos, eventos, contactos de emergencia, cargos y pagos escolares, uniformes, documentos y tickets de soporte',
    period: 'Mientras la escuela tenga contrato con LIUMA. La escuela puede corregirlos o borrarlos en cualquier momento. Al terminar el contrato, la escuela tiene ' + LIFECYCLE_GRACE_DAYS.toDeletionEligible + ' días para descargarlos y ACACIA los suprime de la base de datos activa dentro de los ' + PURGE_DAYS + ' días siguientes.',
    days: LIFECYCLE_GRACE_DAYS.toDeletionEligible + PURGE_DAYS,
    basis: 'LFPDPPP arts. 10 y 12; la escuela, como responsable, conserva por su cuenta los expedientes que la autoridad educativa o fiscal le exija.',
  },
  {
    data: 'Cuenta de una persona usuaria: nombre, correo, teléfono, fotografía, rol y perfil de madre, padre o tutor',
    period: 'Mientras la cuenta exista. Si la persona usa "' + ACCOUNT_DELETION_LABEL + '", su acceso se cierra de inmediato y la cuenta se suprime de la base de datos activa dentro de ' + PURGE_DAYS + ' días.',
    days: PURGE_DAYS,
    basis: 'LFPDPPP arts. 10 y 24.',
  },
  {
    data: 'Conversaciones con Lumi',
    period: 'Mientras la cuenta exista. Al eliminarla, ACACIA solicita a Base44 su supresión dentro de los ' + PURGE_DAYS + ' días siguientes: Base44 las almacena y no ofrece a LIUMA una forma de borrarlas por sí misma, así que el plazo en que desaparecen depende de Base44.',
    days: null,
    basis: 'LFPDPPP arts. 10 y 24.',
  },
  {
    data: 'Bitácora de auditoría y sesiones activas (acciones sensibles, dirección IP, navegador)',
    period: '730 días (2 años) desde que se registra cada evento; después se suprime.',
    days: 730,
    basis: 'Plazo de prescripción de la acción de daños (Código Civil Federal, art. 1934), para poder responder por un acceso indebido.',
  },
  {
    data: 'Constancia de consentimiento (cuenta, escuela, versión del aviso aceptada, fecha y navegador)',
    period: 'Mientras la cuenta exista y, después, bloqueada durante 3,650 días (10 años), sólo para acreditar que el consentimiento se otorgó.',
    days: 3650,
    basis: 'Bloqueo hasta la prescripción de las acciones (LFPDPPP arts. 2 III y 24; Código Civil Federal, art. 1159).',
  },
  {
    data: 'Facturación y pagos de la licencia de la escuela a ACACIA (ACACIA es responsable)',
    period: '1,825 días (5 años) contados desde la presentación de la declaración fiscal relacionada.',
    days: 1825,
    basis: 'Código Fiscal de la Federación, art. 30.',
  },
  {
    data: 'Datos de contacto y contrato de quien contrata LIUMA por la escuela (ACACIA es responsable)',
    period: 'Mientras dure el contrato y, después, bloqueados durante 3,650 días (10 años), sólo para atender reclamaciones derivadas del contrato.',
    days: 3650,
    basis: 'Prescripción ordinaria mercantil (Código de Comercio, art. 1047) y LFPDPPP art. 24.',
  },
  {
    data: 'Registros de cargos vencidos o adeudos de una familia con la escuela',
    period: 'Se suprimen con el resto de los datos de la escuela; en ningún caso se conservan más de 72 meses desde el incumplimiento.',
    days: 2190,
    basis: 'LFPDPPP art. 10, tercer párrafo.',
  },
  {
    data: 'Copias de respaldo',
    period: 'Base44 las genera automáticamente y conserva cada una por un periodo fijo; lo borrado de la base de datos activa desaparece de los respaldos cuando éstos se reemplazan. ACACIA no restaura datos borrados desde un respaldo salvo para recuperar el servicio ante una falla.',
    days: null,
    basis: 'LFPDPPP art. 18 (medidas de seguridad); Base44, Data Processing Addendum.',
  },
];

// ── Every entity → the words in the notice that disclose it ──────────────────
// tests/unit/legal-final.test.js fails if an entity in base44/entities/ has
// no entry here, or if its phrase is missing from the notice. Adding an entity
// therefore forces a decision about how the notice describes it.
export const ENTITY_DATA_CATEGORIES = {
  AbsenceNotification: 'solicitudes de ausencia',
  AppSession: 'sesiones activas',
  Attendance: 'asistencia',
  AuditLog: 'bitácora de auditoría',
  ChargeItem: 'cargos',
  Classroom: 'salón',
  ConsentRecord: 'constancia de tu consentimiento',
  DiaryEntry: 'bitácora diaria',
  Discount: 'descuentos',
  EmergencyContact: 'Contactos de emergencia',
  Event: 'eventos',
  EventResponse: 'respuestas a eventos',
  Homework: 'tareas',
  Notice: 'avisos',
  NoticeDelivery: 'entregas de avisos',
  NoticeRead: 'confirmaciones de lectura',
  OfficialDocument: 'documentos oficiales',
  ParentProfile: 'ocupación',
  ParentStudent: 'parentesco',
  PaymentConcept: 'conceptos de cobro',
  PaymentRecord: 'pagos',
  PendingChange: 'cambios de rol pendientes de aprobación',
  PermissionOverride: 'permisos individuales',
  School: 'datos de la escuela',
  SchoolSetupGuide: 'guía de configuración',
  SchoolSubscription: 'licencia de la escuela',
  Student: 'fecha de nacimiento',
  SupportTicket: 'tickets de soporte',
  SupportTicketMessage: 'mensajes',
  TeacherClassroom: 'salones asignados',
  UniformOrder: 'pedidos de uniforme',
  User: 'correo electrónico',
  UserProfile: 'rol',
  WeeklyMenu: 'menú semanal',
};

// ── Aviso de Privacidad ──────────────────────────────────────────────────────

function trainingParagraph() {
  if (BASE44_AI_TRAINING_EXCLUDED) {
    return 'Base44 no usa los datos de LIUMA para entrenar modelos de inteligencia artificial, y ACACIA no los usa ni autoriza que se usen para ese fin.';
  }
  return 'ACACIA no usa los datos de LIUMA para entrenar modelos de inteligencia artificial. Sin embargo, Base44 informa públicamente que, salvo en su plan Enterprise, puede usar los datos de las aplicaciones que aloja —incluida la información personal que se captura en ellas— para entrenar modelos de inteligencia artificial. Mientras ACACIA no cuente con esa exclusión, ese uso por parte de Base44 es posible. Si no estás de acuerdo, puedes no usar Lumi, pedir a tu escuela que no capture datos de salud en LIUMA, o revocar tu consentimiento (sección 10). ACACIA publicará en este aviso el cambio en cuanto la exclusión esté contratada.';
}

export const PRIVACY_NOTICE = {
  id: 'privacy',
  path: PRIVACY_NOTICE_PATH,
  title: 'Aviso de Privacidad de LIUMA',
  version: PRIVACY_NOTICE_VERSION,
  status: PRIVACY_NOTICE_STATUS,
  effectiveDate: LEGAL_EFFECTIVE_DATE,
  // Aviso simplificado (LFPDPPP art. 16 II): identidad, datos, finalidades y
  // opciones para limitar, más dónde está el integral (esta misma página).
  summary: [
    'La escuela en la que te registras es la responsable de tus datos y de los de tus hijos. ' + ID.legalName + ' (' + ID.tradeName + '), con domicilio en ' + ID.address + ', opera LIUMA por encargo de la escuela y sólo trata esos datos para prestarle el servicio.',
    'Tratamos datos de identificación y contacto de familias y personal, y datos de alumnos menores de edad, incluidos datos sensibles de salud (tipo de sangre, alergias, notas médicas) y la bitácora diaria, para la comunicación escolar, el cuidado del alumno y la administración de la escuela.',
    'Los datos sensibles de los menores sólo se tratan con el consentimiento expreso de su madre, padre o tutor, otorgado en LIUMA con su cuenta.',
    'No vendemos los datos ni los usamos para publicidad. Los proveedores que nos ayudan a operar (Base44 y los proveedores de inteligencia artificial ' + aiProviderNames() + ') están principalmente en Estados Unidos.',
    'Puedes limitar el uso de tus datos, ejercer tus derechos de Acceso, Rectificación, Cancelación y Oposición (ARCO) y revocar tu consentimiento ante tu escuela o escribiendo a ' + ID.email + '. Este es el aviso integral; está vigente desde el ' + LEGAL_EFFECTIVE_DATE + '.',
  ],
  sections: [
    {
      id: 'responsable',
      heading: '1. Quién es responsable de tus datos',
      paragraphs: [
        'La escuela, guardería o colegio que usa LIUMA (en adelante, "la escuela") es la responsable del tratamiento de los datos personales de su comunidad escolar: alumnos, madres, padres o tutores, y personal. La identidad y el domicilio de la escuela son los que la propia escuela te da a conocer al inscribir a tu hijo o al invitarte a LIUMA; la escuela adopta este aviso para el tratamiento que hace a través de LIUMA.',
        acaciaIdentityLine() + ', desarrolla y opera LIUMA. Respecto de los datos de la comunidad escolar, ACACIA actúa como encargado: los trata únicamente por cuenta de la escuela, conforme a sus instrucciones y para prestarle el servicio (Ley Federal de Protección de Datos Personales en Posesión de los Particulares, en adelante "la Ley", art. 2, fracción XII).',
        'ACACIA es responsable, por separado, de los datos de contacto, contrato y facturación de la persona que contrata LIUMA en nombre de la escuela, que trata para administrar la licencia, cobrarla y cumplir sus obligaciones fiscales.',
      ],
    },
    {
      id: 'datos',
      heading: '2. Qué datos tratamos',
      items: [
        'Cuenta de cada persona usuaria: nombre, correo electrónico, teléfono, fotografía (opcional), rol en la escuela (dirección, maestro o familia) y estado de la cuenta.',
        'Madres, padres y tutores: además, domicilio, ocupación, lugar y teléfono de trabajo (si los proporcionas) y parentesco con el alumno.',
        'Alumnos (menores de edad): nombre, fecha de nacimiento, fotografía (opcional), salón, asistencia y su motivo, tareas, bitácora diaria (ánimo, alimentación, sueño, siestas, baño, aprendizaje, conducta, incidencias, artículos que necesita y mensajes entre maestra y familia), solicitudes de ausencia y su motivo, respuestas a eventos, cargos, pagos y descuentos escolares, y pedidos de uniforme (tallas y medidas).',
        'Datos sensibles de los alumnos: tipo de sangre, alergias y notas médicas. También pueden revelar información de salud el motivo de una ausencia o una incidencia registrada en la bitácora diaria.',
        'Contactos de emergencia y personas autorizadas para recoger al alumno: nombre, parentesco, teléfono y notas. Si registras a otra persona, te corresponde informarle que lo haces.',
        'Personal de la escuela: además de su cuenta, salones asignados, permisos individuales, cambios de rol pendientes de aprobación y las tareas, avisos y documentos que publica.',
        'Datos de la escuela: nombre, domicilio, teléfono, correo, logotipo, código para unirse, licencia de la escuela, menú semanal, conceptos de cobro, documentos oficiales y su guía de configuración.',
        'Uso de la app: avisos y sus entregas de avisos y confirmaciones de lectura, respuestas a eventos, tickets de soporte y sus mensajes, y lo que escribes a Lumi.',
        'Datos técnicos: sesiones activas (tipo de navegador y sistema operativo), métricas de uso que el kit de Base44 registra (inicio y duración de la sesión, pantallas visitadas y página de procedencia, sin su contenido), la bitácora de auditoría de acciones sensibles (que puede incluir la dirección IP), la constancia de tu consentimiento y, cuando abres un ticket de soporte, un diagnóstico técnico (pantalla, versión de la app, navegador y eventos recientes). LIUMA no graba las sesiones ni la pantalla.',
        'Datos patrimoniales: los cargos y pagos escolares (montos, fechas, forma de pago y referencia) son datos patrimoniales de la familia. La escuela los trata para cumplir la relación que tiene con la familia, que no requiere un consentimiento adicional (arts. 7 y 9, fracción IV de la Ley). LIUMA no guarda números de tarjeta ni de cuenta bancaria.',
      ],
    },
    {
      id: 'finalidades',
      heading: '3. Para qué los usamos',
      paragraphs: ['Finalidades necesarias para la relación con la escuela (sin ellas no es posible usar LIUMA):'],
      items: [
        'Operar la comunicación entre la escuela y las familias: avisos, calendario, eventos, tareas y bitácora diaria.',
        'Registrar y consultar la asistencia y gestionar las solicitudes de ausencia.',
        'Cuidar al alumno: que el personal autorizado conozca sus alergias, tipo de sangre, notas médicas y contactos de emergencia, y pueda enviar alertas de emergencia. Esta finalidad requiere tu consentimiento expreso (sección 4).',
        'Llevar el control de cargos, pagos, descuentos y pedidos de uniformes de la escuela, y enviar recordatorios.',
        'Dar acceso a cada persona según su rol, aprobar cuentas nuevas, y mantener la seguridad, la auditoría y el soporte técnico de la plataforma.',
        'Responder tus preguntas con el asistente Lumi y ayudar al personal a redactar bitácoras y solicitudes de soporte, cuando decides usarlos.',
        'Para ACACIA como responsable: administrar el contrato y la licencia de la escuela, cobrarla y facturarla.',
      ],
      closing: 'Finalidades secundarias: ninguna. Ni la escuela a través de LIUMA ni ACACIA usan los datos para publicidad, mercadotecnia o perfiles comerciales, y no los venden ni los rentan. Si alguna vez se quisiera usarlos para algo distinto, se te pedirá antes un nuevo consentimiento (art. 11 de la Ley).',
    },
    {
      id: 'sensibles',
      heading: '4. Datos sensibles y de menores de edad',
      paragraphs: [
        'Los datos de salud de los alumnos son datos personales sensibles (art. 2, fracción VI de la Ley). Se tratan sólo con el consentimiento expreso y por escrito de la madre, padre o tutor que ejerce la patria potestad o la tutela y representa al menor (Código Civil Federal, art. 425). En LIUMA ese consentimiento se otorga con tu cuenta autenticada (tu inicio de sesión verificado funciona como mecanismo de autenticación), marcando la casilla de consentimiento expreso; LIUMA registra la cuenta que lo otorgó, la fecha, la versión de este aviso y el navegador (art. 8 de la Ley). Sin esa constancia no se completa el registro de una familia.',
        'La escuela se obliga a no capturar en LIUMA datos de salud de un alumno cuya madre, padre o tutor no haya otorgado ese consentimiento, ya sea en LIUMA o por escrito ante la propia escuela.',
        'Dentro de la escuela sólo ven los datos de salud quienes los necesitan para cuidar al alumno: la dirección y los maestros de su salón. Las familias sólo ven la información de sus propios hijos, y ninguna escuela ve datos de otra.',
        'El personal de la escuela, al registrarse, se compromete a tratar estos datos sólo para el cuidado del alumno y la operación escolar, y a guardar confidencialidad aun después de dejar la escuela (art. 20 de la Ley).',
      ],
    },
    {
      id: 'ia',
      heading: '5. Asistente de inteligencia artificial (Lumi)',
      paragraphs: [
        'LIUMA incluye un asistente, Lumi, que pueden usar familias, maestros y dirección, y funciones de redacción asistida para el personal. Cuando los usas, el texto de tu solicitud y la información de la escuela necesaria para responderla (que puede incluir datos del alumno, incluidos sus datos de salud si la pregunta trata de ellos) se envían, a través de Base44, a un modelo de inteligencia artificial para generar la respuesta. Base44 elige el modelo en cada mensaje; los proveedores de modelos que publica son ' + aiProviderNames() + '. ' + GLM_DISCLOSURE + ' Lumi sólo consulta lo que tu rol te permite ver en LIUMA.',
        LUMI_CONVERSATIONS_PARAGRAPH,
        trainingParagraph(),
        'Lumi no toma decisiones por ti ni sobre ti: sus respuestas son de apoyo y no sustituyen el criterio médico, los protocolos de emergencia de la escuela ni la información oficial que publica la escuela (art. 26, fracción II de la Ley).',
      ],
    },
    {
      id: 'remisiones',
      heading: '6. Encargados, remisiones y transferencias',
      paragraphs: [
        'Para operar LIUMA, ACACIA se apoya en los siguientes proveedores, que tratan los datos sólo por cuenta de ACACIA y de la escuela, bajo obligaciones de confidencialidad y seguridad. La comunicación de datos a un encargado es una remisión, no una transferencia, y no requiere tu consentimiento (art. 2, fracción XX de la Ley):',
      ],
      processors: true,
      items: [
        'Transferencias internacionales: los servidores de Base44 están en Estados Unidos; algunos subencargados de Base44 operan desde Israel (Wix.com Ltd.), Alemania (Langfuse) y el Reino Unido (Logfire). Los datos de LIUMA se almacenan y procesan en esos países con las medidas descritas en la sección 11.',
        'Transferencias a terceros: los datos sólo se transfieren sin tu consentimiento en los casos del art. 36 de la Ley, por ejemplo cuando la prevé una ley o un tratado del que México sea parte, cuando es necesaria para la atención médica de un alumno, para la procuración o administración de justicia, o para la defensa de un derecho en un proceso judicial. Quien reciba los datos asume las mismas obligaciones que corresponden a quien se los transfirió (art. 35 de la Ley).',
      ],
      closing: 'La escuela y ACACIA no transfieren datos a terceros para fines propios de esos terceros.',
    },
    {
      id: 'limitar',
      heading: '7. Cómo limitar el uso o la divulgación de tus datos',
      items: [
        'Los campos opcionales (fotografía, ocupación, lugar y teléfono de trabajo) pueden quedarse vacíos o borrarse en cualquier momento.',
        'Puedes no usar Lumi ni la redacción asistida; el resto de LIUMA funciona igual.',
        'Puedes pedir a la dirección de tu escuela que corrija o borre un registro.',
        'Puedes cerrar sesión y borrar el almacenamiento de LIUMA en tu navegador (sección 12).',
        'Puedes revocar tu consentimiento o eliminar tu cuenta (sección 10).',
      ],
    },
    {
      id: 'conservacion',
      heading: '8. Cuánto tiempo conservamos los datos',
      paragraphs: [
        'Los datos se conservan sólo mientras son necesarios para las finalidades de este aviso. Cuando dejan de serlo se suprimen, previo un periodo de bloqueo cuando la ley lo permite, durante el cual sólo se conservan para atender responsabilidades y no se usan para nada más (arts. 2 fracción III, 10, 12 y 24 de la Ley). Los días son naturales.',
      ],
      table: {
        caption: 'Plazos de conservación',
        columns: ['Datos', 'Plazo', 'Fundamento'],
        rows: RETENTION_TABLE.map((row) => [row.data, row.period, row.basis]),
      },
      closing: 'LIUMA no es el expediente oficial de control escolar del alumno: boletas, certificados y demás registros que la autoridad educativa pide los conserva la escuela en sus propios sistemas y plazos.',
    },
    {
      id: 'arco',
      heading: '9. Tus derechos ARCO',
      paragraphs: [
        'Puedes Acceder a tus datos y a los de tus hijos menores de edad, Rectificarlos, Cancelarlos u Oponerte a su tratamiento (arts. 21 a 26 de la Ley).',
        'Como la escuela es la responsable, dirige tu solicitud a la dirección de tu escuela. También puedes enviarla a ' + ID.email + ' con el asunto "' + ARCO_EMAIL_SUBJECT + '": ACACIA, como encargado, la hará llegar a tu escuela el mismo día hábil y la apoyará para atenderla; si se refiere a los datos de los que ACACIA es responsable (contrato y facturación), ACACIA la atiende directamente.',
        'Tu solicitud debe incluir (art. 28 de la Ley): tu nombre y un correo o domicilio para responderte; una identificación oficial (y, si actúas por otra persona, el documento que acredita tu representación; si es sobre un menor, el que acredita que eres su madre, padre o tutor); la descripción de los datos y del derecho que quieres ejercer; y cualquier dato que ayude a localizarlos, como el nombre de tu escuela. Para rectificar, indica el cambio y adjunta el documento que lo sustente.',
        'Recibirás respuesta en un plazo máximo de ' + ARCO_RESPONSE_DAYS + ' días hábiles desde que se reciba tu solicitud y, si procede, se hará efectiva dentro de los ' + ARCO_EFFECT_DAYS + ' días hábiles siguientes. Cada plazo puede ampliarse una sola vez por un periodo igual cuando el caso lo justifique (art. 31 de la Ley). La respuesta llega por el mismo medio en que enviaste la solicitud.',
        'El ejercicio de estos derechos es gratuito; sólo podrían cobrarse costos de reproducción o envío (art. 34 de la Ley). La dirección puede además descargar todos los datos de la escuela desde LIUMA.',
      ],
    },
    {
      id: 'revocacion',
      heading: '10. Revocar tu consentimiento y eliminar tu cuenta',
      paragraphs: [
        'Puedes revocar en cualquier momento tu consentimiento, sin efectos retroactivos (art. 7 de la Ley), por los mismos medios de la sección 9.',
        'Dentro de LIUMA puedes usar la opción "' + ACCOUNT_DELETION_LABEL + '" de tu cuenta. Al usarla, tu acceso se cierra de inmediato; tu cuenta, tu perfil y tus datos de contacto se suprimen de la base de datos activa dentro de ' + PURGE_DAYS + ' días; tus vínculos con tus hijos se revocan, y tus solicitudes que la escuela aún no atendía (ausencias y pedidos de uniforme) se cancelan. Los registros escolares de tus hijos (asistencia, bitácora, cargos y pagos) y lo que publicaste como personal de la escuela (avisos, tareas, bitácoras) pertenecen al expediente que lleva la escuela como responsable: se quedan con la escuela sin tu nombre y, para que también se cancelen, solicítalo a la escuela conforme a la sección 9. Tus conversaciones con Lumi las almacena Base44, que no ofrece a LIUMA una forma de borrarlas por sí misma: ACACIA solicita a Base44 su supresión en el mismo plazo. La constancia de tu consentimiento y de su retiro se conserva bloqueada en los términos de la sección 8.',
        'Si eres la única persona de la dirección de tu escuela, no puedes eliminar tu cuenta: la escuela se quedaría sin quien la represente. Desde la misma opción puedes solicitar la eliminación de la escuela, o pedir a ACACIA que nombre a otra persona de la dirección.',
        'Aceptar este aviso es obligatorio para usar LIUMA. Revocar el consentimiento sobre los datos sensibles de tu hijo implica que la escuela deje de tratarlos en LIUMA y puede impedir que siga ofreciéndote el servicio por este medio.',
      ],
    },
    {
      id: 'seguridad',
      heading: '11. Seguridad',
      paragraphs: [
        'Cada escuela sólo ve sus propios datos y cada persona sólo lo que su rol permite; esas reglas se aplican en el servidor, no sólo en la pantalla. Las acciones sensibles quedan registradas en una bitácora de auditoría y las cuentas nuevas requieren aprobación de la dirección.',
        'La información viaja cifrada (TLS 1.2 o superior) y se almacena cifrada (AES-256) en la infraestructura de Base44, que cuenta con certificaciones SOC 2 Tipo II e ISO/IEC 27001 y respaldos automáticos (art. 18 de la Ley).',
        'Si ocurre una vulneración de seguridad que afecte de forma significativa tus derechos, se te informará de inmediato para que puedas tomar medidas (art. 19 de la Ley).',
      ],
    },
    {
      id: 'cookies',
      heading: '12. Almacenamiento en tu navegador',
      paragraphs: [
        'LIUMA guarda en tu navegador (almacenamiento local y de sesión) sólo lo necesario para funcionar: tu sesión, un identificador de sesión para las métricas técnicas de Base44, el identificador de la conversación abierta con Lumi, tu preferencia de tema (claro, oscuro o del sistema), la última cuenta con la que entraste, el código de escuela de una invitación mientras te registras, por unos minutos la licencia de tu escuela, y una marca técnica para recargar la app después de una actualización. No usa cookies de publicidad ni de rastreo de terceros. Puedes borrarlo desde la configuración de tu navegador; tendrás que volver a iniciar sesión.',
      ],
    },
    {
      id: 'cambios',
      heading: '13. Cambios a este aviso',
      paragraphs: [
        'Cualquier cambio se publicará en esta misma página con una nueva versión y su fecha. Si el cambio afecta los datos sensibles, las finalidades o los proveedores, LIUMA te pedirá aceptar la nueva versión la siguiente vez que entres, y ACACIA avisará por correo a la dirección de cada escuela.',
      ],
    },
    {
      id: 'autoridad',
      heading: '14. Autoridad',
      paragraphs: [
        'Si consideras que tus derechos no fueron atendidos, puedes presentar una solicitud de protección de datos ante la Secretaría Anticorrupción y Buen Gobierno, autoridad en la materia desde el 21 de marzo de 2025, dentro de los 15 días hábiles siguientes a la respuesta, o desde que venza el plazo de respuesta si no la recibiste (arts. 2 fracción XV, 38 a 40 de la Ley).',
        'Vigente desde el ' + LEGAL_EFFECTIVE_DATE + '. Versión ' + PRIVACY_NOTICE_VERSION + '.',
      ],
    },
  ],
};

// ── Términos del servicio ────────────────────────────────────────────────────

function trialParagraph() {
  return 'Toda escuela nueva empieza con una prueba gratuita de ' + TRIAL_DURATION_DAYS + ' días naturales, con todas las funciones y sin tarjeta. La prueba no se renueva sola.';
}

function planItems() {
  return PLAN_TIERS.map((tier) => {
    const plan = PLAN_CATALOG[tier];
    const limit = plan.studentLimit == null ? 'alumnos ilimitados' : 'hasta ' + plan.studentLimit + ' alumnos';
    return plan.label + ': ' + plan.price + ', ' + limit + '.';
  });
}

export const SERVICE_TERMS = {
  id: 'terms',
  path: SERVICE_TERMS_PATH,
  title: 'Términos del servicio de LIUMA',
  version: SERVICE_TERMS_VERSION,
  status: PRIVACY_NOTICE_STATUS,
  effectiveDate: LEGAL_EFFECTIVE_DATE,
  summary: [
    'LIUMA es un servicio de ' + ID.legalName + ' (' + ID.tradeName + '). La escuela contrata la licencia; maestros y familias la usan por invitación de la escuela.',
    'La prueba gratuita dura ' + TRIAL_DURATION_DAYS + ' días y no pide tarjeta.',
    'Si la licencia no está pagada, la escuela pasa a modo de solo lectura: se puede consultar todo y la dirección puede descargar los datos, pero no se registra nada nuevo hasta pagar. No se borra nada por vencer la prueba.',
    'Los datos son de la escuela: puede descargarlos cuando quiera y pedir su eliminación. ACACIA los trata sólo por cuenta de la escuela.',
    'Estos términos se rigen por la ley mexicana; las controversias se resuelven ante los tribunales competentes de Aguascalientes, Aguascalientes.',
  ],
  sections: [
    {
      id: 'servicio',
      heading: '1. Las partes y el servicio',
      paragraphs: [
        'LIUMA es una plataforma de gestión y comunicación escolar desarrollada y operada por ' + acaciaIdentityLine() + '.',
        'Estos términos forman el contrato entre ACACIA y la escuela que contrata una licencia para su comunidad (dirección, maestros y familias). Quien crea la escuela en LIUMA declara tener facultades para obligarla. Las demás personas usuarias aceptan las reglas de uso de la sección 7 y el Aviso de Privacidad al registrarse.',
        'Para LIUMA prevalece lo que dicen estos términos sobre los términos generales publicados en ' + ID.website + '.',
      ],
    },
    {
      id: 'aceptacion',
      heading: '2. Aceptación',
      paragraphs: [
        'Estos términos y el Aviso de Privacidad se aceptan al registrarse en LIUMA, marcando la casilla correspondiente con una cuenta autenticada; LIUMA registra la versión aceptada y la fecha. La aceptación es obligatoria para usar el servicio.',
      ],
    },
    {
      id: 'prueba',
      heading: '3. Prueba gratuita',
      paragraphs: [
        trialParagraph(),
        'Durante la prueba la app muestra cuántos días quedan. Al terminar sin pago, la escuela pasa a modo de solo lectura (sección 5).',
      ],
    },
    {
      id: 'planes',
      heading: '4. Planes y pagos',
      paragraphs: ['Planes vigentes (precios mensuales en pesos mexicanos):'],
      items: planItems(),
      closing: 'El cobro se hace por Mercado Pago u otro medio que ACACIA indique; ACACIA no almacena datos de tarjetas. Cada pago confirmado extiende la licencia por el periodo pagado. Puede aplicar una cuota de activación única, que se informa antes de contratar. LIUMA avisa en la app antes de que venza la licencia, con el enlace para pagar.',
    },
    {
      id: 'vencimiento',
      heading: '5. Si la licencia no está pagada',
      items: [
        'Al terminar la prueba sin pago, o si no existe una licencia activa, la escuela entra en modo de solo lectura: todos pueden consultar la información y la dirección puede descargarla, pero no se pueden crear ni modificar registros. La alerta de emergencia sigue disponible para la dirección.',
        'Si una renovación no se paga, la escuela pasa a solo lectura; a los ' + LIFECYCLE_GRACE_DAYS.toSuspended + ' días la cuenta se marca como suspendida, que sigue siendo de solo lectura.',
        'Al pagar, el acceso completo se restablece sin perder información.',
        'A los ' + LIFECYCLE_GRACE_DAYS.toDeletionEligible + ' días sin pago los datos pueden eliminarse, siempre con aviso previo por correo a la dirección de la escuela.',
      ],
    },
    {
      id: 'cancelacion',
      heading: '6. Cancelación, eliminación de cuentas y devolución de los datos',
      paragraphs: [
        'La escuela puede cancelar cuando quiera escribiendo a ' + ID.email + '. La cancelación aplica al terminar el periodo pagado; no hay reembolsos por periodos ya cobrados salvo error imputable a ACACIA.',
        'La escuela puede descargar todos sus datos en cualquier momento desde Permisos y roles → Descargar datos de la escuela, y solicitar la eliminación de la escuela desde la misma pantalla. Al terminar el contrato tiene ' + LIFECYCLE_GRACE_DAYS.toDeletionEligible + ' días para descargarlos; después, ACACIA los suprime en los plazos del Aviso de Privacidad.',
        'Cada persona usuaria puede eliminar su propia cuenta con la opción "' + ACCOUNT_DELETION_LABEL + '", salvo la única persona de la dirección de una escuela, que primero debe pedir que se nombre a otra o solicitar la eliminación de la escuela.',
      ],
    },
    {
      id: 'uso',
      heading: '7. Uso aceptable',
      items: [
        'Cada persona usa su propia cuenta y es responsable de su contraseña.',
        'La escuela decide quién entra y con qué rol, y aprueba las cuentas de maestros y familias.',
        'No está permitido usar LIUMA para fines distintos de la operación escolar, cargar contenido ilícito, ni intentar acceder a información de otra escuela, de otras familias o de partes del sistema que tu rol no permite.',
        'ACACIA puede suspender una cuenta que incumpla estas reglas o ponga en riesgo la seguridad de otros, avisando a la dirección de la escuela.',
      ],
    },
    {
      id: 'escuela',
      heading: '8. Obligaciones de la escuela como responsable',
      items: [
        'Poner este Aviso de Privacidad a disposición de su comunidad, con su propio nombre y domicilio, o publicar el suyo, que no podrá contradecirlo.',
        'Contar con el consentimiento expreso de la madre, padre o tutor antes de capturar datos de salud de un alumno, y no capturarlos si no lo tiene.',
        'Que la información que registra sea correcta y pertinente, y atender las solicitudes ARCO de su comunidad con el apoyo de ACACIA.',
        'Dar a ACACIA instrucciones lícitas sobre el tratamiento de los datos.',
      ],
    },
    {
      id: 'encargo',
      heading: '9. Tratamiento de datos por cuenta de la escuela (encargo)',
      paragraphs: ['Respecto de los datos de su comunidad escolar, la escuela es responsable y ACACIA encargado. ACACIA se obliga a:'],
      items: [
        'Tratar los datos sólo para prestar LIUMA y conforme a las instrucciones de la escuela.',
        'No usarlos para fines propios, no venderlos y no transferirlos, salvo a los proveedores listados en el Aviso de Privacidad (que actúan como subencargados) o por mandato de autoridad.',
        'Mantener medidas de seguridad administrativas, técnicas y físicas, guardar confidencialidad y exigir lo mismo a sus proveedores.',
        'Avisar a la escuela de cualquier vulneración de seguridad que afecte sus datos sin demora y a más tardar dentro de las 72 horas siguientes a que ACACIA la confirme, con lo que se sepa de su alcance y las medidas tomadas.',
        'Apoyar a la escuela para atender las solicitudes ARCO dentro de los plazos de la ley.',
        'Informar en el Aviso de Privacidad cualquier cambio de proveedores antes de que aplique.',
        'Al terminar el servicio, entregar los datos a la escuela y después suprimirlos, salvo lo que la ley obligue a conservar.',
      ],
    },
    {
      id: 'ia',
      heading: '10. Inteligencia artificial',
      paragraphs: [
        'Lumi y la redacción asistida usan modelos de inteligencia artificial de terceros a través de Base44, como describe el Aviso de Privacidad. Sus respuestas pueden contener errores: son de apoyo y la decisión siempre es de la persona. LIUMA no sustituye los protocolos de emergencia ni la atención médica de la escuela.',
      ],
    },
    {
      id: 'disponibilidad',
      heading: '11. Disponibilidad',
      paragraphs: [
        'ACACIA procura que LIUMA esté disponible y funcione correctamente, y avisa con anticipación los mantenimientos programados cuando puede. No garantiza un servicio ininterrumpido, porque depende de proveedores de nube, correo y pagos.',
      ],
    },
    {
      id: 'responsabilidad',
      heading: '12. Responsabilidad',
      items: [
        'ACACIA responde ante la escuela de los daños y perjuicios que sean consecuencia inmediata y directa de su incumplimiento (Código Civil Federal, art. 2110).',
        'Fuera de los casos del punto siguiente, la responsabilidad total de ACACIA frente a la escuela por todas las reclamaciones derivadas del servicio se limita al monto que la escuela haya pagado efectivamente por LIUMA en los doce meses anteriores al hecho que las origine (Código Civil Federal, art. 2117).',
        'Ese límite no aplica, y nada en estos términos excluye o reduce: (a) la responsabilidad por dolo o culpa grave de ACACIA (Código Civil Federal, art. 2106); (b) la responsabilidad por incumplir las obligaciones de protección de datos personales, confidencialidad y seguridad, ni las sanciones, indemnizaciones y responsabilidades que establece la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (arts. 53, 59 y 61), que no son renunciables; (c) la reparación del daño moral causado a alumnos, familias o personal (Código Civil Federal, art. 1916); ni (d) los derechos que la Ley Federal de Protección al Consumidor otorga a la escuela cuando tenga el carácter de consumidor (art. 90).',
        'ACACIA no responde por caso fortuito o fuerza mayor salvo que haya dado causa o contribuido a él (Código Civil Federal, art. 2111), por información capturada incorrectamente por la escuela o las personas usuarias, ni por decisiones tomadas con base en una respuesta de Lumi sin verificarla.',
        'Estos límites rigen sólo entre ACACIA y la escuela: no limitan los derechos que alumnos, familias y personal tienen como titulares de sus datos.',
      ],
    },
    {
      id: 'propiedad',
      heading: '13. Propiedad intelectual',
      paragraphs: [
        'LIUMA, su código y su marca son de ACACIA; la licencia da derecho a usarlos mientras esté vigente. Los datos y contenidos que captura la escuela son de la escuela y de sus titulares.',
      ],
    },
    {
      id: 'cambios',
      heading: '14. Cambios a estos términos',
      paragraphs: [
        'ACACIA puede actualizar estos términos para reflejar cambios en el servicio o en la ley; se publican en esta página con una nueva versión y fecha, y se avisa por correo a la dirección de la escuela con al menos 15 días naturales de anticipación. Un cambio de precio no aplica al periodo ya pagado. Si la escuela no está de acuerdo, puede cancelar antes de que el cambio entre en vigor.',
      ],
    },
    {
      id: 'jurisdiccion',
      heading: '15. Ley aplicable y jurisdicción',
      paragraphs: [
        'Estos términos se rigen por las leyes de los Estados Unidos Mexicanos. Para su interpretación y cumplimiento, ACACIA y la escuela se someten expresamente a los tribunales competentes de la ciudad de Aguascalientes, Aguascalientes, y renuncian a cualquier otro fuero que pudiera corresponderles por razón de su domicilio presente o futuro (Código de Comercio, art. 1093).',
        'Lo anterior no impide que la escuela acuda a la Procuraduría Federal del Consumidor cuando tenga el carácter de consumidor, ni que cualquier titular acuda a la Secretaría Anticorrupción y Buen Gobierno en materia de datos personales.',
        'Dudas: ' + ID.email + ' · Soporte: ' + ACACIA_SUPPORT_EMAIL + ' · ' + ID.website + '. Vigentes desde el ' + LEGAL_EFFECTIVE_DATE + '. Versión ' + SERVICE_TERMS_VERSION + '.',
      ],
    },
  ],
};

export const LEGAL_DOCUMENTS = [PRIVACY_NOTICE, SERVICE_TERMS];

/** All the reader-visible text of a document, in reading order. */
export function legalDocumentText(doc) {
  return [
    doc.title,
    ...doc.summary,
    ...doc.sections.flatMap((s) => [
      s.heading,
      ...(s.paragraphs || []),
      ...(s.processors ? DATA_PROCESSORS.flatMap((p) => [p.name, p.role, p.location]) : []),
      ...(s.table ? s.table.rows.flat() : []),
      ...(s.items || []),
      s.closing || '',
    ]),
  ].join('\n');
}
