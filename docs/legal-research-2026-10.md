# Investigación legal — Aviso de Privacidad y Términos de LIUMA (2026-10-02)

Base de la versión `2026-10-02` de `src/lib/legal/legalDocs.js`, que pasa los
textos de LIUMA de borrador a **vigentes** por decisión del dueño, quien asume
el riesgo de publicarlos sin la revisión de un abogado externo. Este documento
dice de dónde sale cada cláusula, qué se leyó directamente de la fuente y qué
**no** se pudo verificar. No es una opinión legal.

Las leyes se leyeron en su texto vigente publicado por la Cámara de Diputados
(PDF descargado y extraído el 2026-10-02); lo de Base44, en sus páginas
públicas en la misma fecha.

## Identidad usada

Persona moral, según su Constancia de Situación Fiscal emitida por el SAT el
2026-10-01: **ACACIA CONSULTORIA EN INFORMATICA Y COMPUTO, S.A. de C.V.**
(nombre comercial ACACIA), RFC `ACI1902061S9`, domicilio Calle Arroyo El Molino
1001, Int. 102, Col. San Telmo, C.P. 20115, Aguascalientes, Aguascalientes.
Contacto `contacto@acaciaco.com.mx`, sitio `https://acaciaco.com.mx`.

El dueño entregó también la constancia de una persona física. **No se usó**: un
aviso de privacidad identifica al responsable o encargado, que aquí es la
sociedad; publicar el RFC, la CURP o el domicilio de una persona física sería
exponer datos personales sin necesidad. `tests/unit/legal-final.test.js` falla
si un patrón de RFC de persona física o de CURP aparece en los textos legales,
en este documento o en `docs/aviso-de-privacidad.md`.

## 1. La ley vigente: LFPDPPP de 2025

Fuente: [LFPDPPP, texto vigente, Cámara de Diputados](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf)
(«Nueva Ley publicada en el Diario Oficial de la Federación el 20 de marzo de
2025 — Última reforma publicada DOF 14-11-2025»). Ficha:
[diputados.gob.mx/LeyesBiblio/ref/lfpdppp.htm](https://www.diputados.gob.mx/LeyesBiblio/ref/lfpdppp.htm).

- **Abroga la ley de 2010**: transitorio Segundo, fracción I («se abrogan […] La
  Ley Federal de Protección de Datos Personales en Posesión de los Particulares,
  publicada en el Diario Oficial de la Federación el 5 de julio de 2010»).
  Entró en vigor al día siguiente de su publicación (transitorio Primero), o
  sea el 21 de marzo de 2025.
- **Autoridad**: art. 2 fr. XV («Secretaría: Secretaría Anticorrupción y Buen
  Gobierno»), arts. 38–39 (atribuciones) y transitorio Cuarto (lo que otras
  normas atribuían al INAI se entiende conferido a quien adquiere la función).
  Resumen independiente: [Garrigues](https://www.garrigues.com/es_ES/noticia/mexico-nueva-ley-federal-proteccion-datos-personales-posesion-particulares-introduce).
- **Contenido del aviso**, art. 15: I identidad y domicilio del responsable;
  II datos tratados, identificando los sensibles; III finalidades, distinguiendo
  las que requieren consentimiento; IV opciones y medios para limitar uso o
  divulgación; V mecanismos para los derechos ARCO; VI cómo se comunican los
  cambios. Cada fracción tiene su sección en el aviso (1, 2, 3, 7, 9, 13).
- **Aviso simplificado**, art. 16 fr. II: cuando los datos se obtienen por
  medios electrónicos se da la modalidad simplificada (fracciones I–IV) y se
  señala dónde está el integral. El bloque «En resumen» de la página es esa
  modalidad, y la misma página es el integral.
- **Datos sensibles**, art. 2 fr. VI (incluye «estado de salud presente o
  futuro») y **art. 8**: «el responsable deberá obtener el consentimiento
  **expreso y por escrito** de la persona titular para su tratamiento, a través
  de su firma autógrafa, firma electrónica, o **cualquier mecanismo de
  autenticación** que al efecto se establezca». Es más exigente que la ley de
  2010 (que pedía expreso y por escrito sin nombrar el mecanismo). LIUMA lo
  recaba con la cuenta autenticada + casilla + `ConsentRecord` (cuenta, fecha,
  versión, navegador). Que eso sea un «mecanismo de autenticación» suficiente
  es la lectura que adopta el texto; **no está confirmada** por criterio de la
  Secretaría ni por un Reglamento nuevo (ver «No verificado»).
- **Menores**: la ley no tiene un artículo propio para menores. El titular
  actúa «o, en su caso, su representante legal» (arts. 21, 27). La
  representación del menor la tienen quienes ejercen la patria potestad
  ([Código Civil Federal](https://www.diputados.gob.mx/LeyesBiblio/pdf/CCF.pdf),
  art. 425: «Los que ejercen la patria potestad son legítimos representantes de
  los que están bajo de ella»), o la tutela (art. 449). Mayoría de edad a los
  18 (art. 646).
- **Consentimiento y revocación**, art. 7: expreso o tácito; «podrá ser revocado
  en cualquier momento sin que se le atribuyan efectos retroactivos», y el
  aviso debe establecer el mecanismo. Art. 11: una finalidad nueva exige un
  nuevo consentimiento.
- **Encargado**, art. 2 fr. XII: «Persona física o jurídica que sola o
  conjuntamente con otras trate datos personales por cuenta del responsable».
  **Transferencia**, art. 2 fr. XX: comunicación a persona «distinta de la
  titular, del responsable o de la persona encargada» — por eso la comunicación
  a un encargado (remisión) no es transferencia. Art. 35: quien recibe una
  transferencia asume las obligaciones del responsable; art. 36: casos en que
  no se requiere consentimiento (ley o tratado, atención médica, interés
  público, procesos judiciales, relación jurídica con el titular, etc.).
  Art. 53: el titular puede reclamar indemnización por incumplimiento «del
  responsable o la persona encargada».
- **ARCO**: arts. 21–26 (derechos), 28 (contenido de la solicitud), 29
  (persona o departamento que tramita), **31 (respuesta en máximo 20 días; se
  hace efectiva en 15; cada plazo ampliable una vez)**, 34 (gratuito, salvo
  costos de reproducción o envío). Art. 2 fr. VIII: «Días: Días hábiles».
- **Seguridad**: art. 18 (medidas administrativas, técnicas y físicas),
  art. 19 (vulneraciones que afecten significativamente los derechos se
  informan «de forma inmediata»), art. 20 (confidencialidad, aun después de
  terminar la relación).
- **Decisiones automatizadas**, art. 26 fr. II: oposición a tratamientos sin
  intervención humana que produzcan efectos jurídicos. Lumi no toma decisiones;
  el aviso lo dice.
- **Protección de derechos**: art. 40 — la solicitud se presenta ante la
  Secretaría dentro de los 15 días siguientes a la respuesta, o desde que venza
  el plazo si no la hubo.
- **Sanciones**: art. 58 (infracciones, entre ellas omitir elementos del art. 15
  y recabar sin consentimiento expreso cuando es exigible), art. 59 (multas de
  100 a 320,000 UMA; **hasta el doble tratándose de datos sensibles**), art. 61
  (sin perjuicio de responsabilidad civil o penal), arts. 62–64 (delitos;
  penas duplicadas con datos sensibles).

## 2. Conservación

- **LFPDPPP art. 2 fr. III (bloqueo)**: conservación tras cumplir la finalidad,
  «con el único propósito de determinar posibles responsabilidades […] hasta el
  plazo de prescripción legal o contractual»; durante el bloqueo no hay
  tratamiento. **Art. 10**: suprimir previo bloqueo cuando dejen de ser
  necesarios; datos de incumplimiento contractual se eliminan a los **72
  meses**. **Art. 12**: con datos sensibles, limitar el periodo «al mínimo
  indispensable». **Art. 24**: el bloqueo equivale al plazo de prescripción de
  las acciones de la relación jurídica.
- **Fiscal**: [Código Fiscal de la Federación](https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf),
  **art. 30**: contabilidad y documentación «deberán conservarse durante un
  plazo de cinco años, contado a partir de la fecha en la que se presentaron o
  debieron haberse presentado las declaraciones con ellas relacionadas». Aplica
  a la facturación de la licencia (ACACIA responsable), no a los cargos que la
  escuela registra a sus familias en LIUMA, que son registros de la escuela.
- **Prescripciones usadas como bloqueo**: Código Civil Federal art. 1159 (diez
  años, regla general), art. 1934 (dos años para la acción de daños
  extracontractuales); [Código de Comercio](https://www.diputados.gob.mx/LeyesBiblio/pdf/CCom.pdf)
  art. 1047 (prescripción ordinaria mercantil de diez años).
- **SEP / control escolar**: las normas de control escolar de educación básica
  regulan el expediente oficial que lleva el plantel (inscripción, boletas,
  certificados) y sus plazos (p. ej., certificados no recogidos se conservan
  tres meses en el plantel), p. ej.
  [Normas específicas de control escolar](https://rinconderomos.gob.mx/assets/normas_especificas_basica.pdf).
  LIUMA **no** es ese expediente; el aviso lo aclara y deja esos plazos a la
  escuela. No se encontró una norma SEP que fije un plazo para la comunicación
  escuela-familia, la bitácora o la asistencia diaria que guarda LIUMA.

**Tabla adoptada** (`RETENTION_TABLE`, días naturales):

| Datos | Plazo | Días | Fundamento |
|---|---|---|---|
| Comunidad escolar (alumnos, salud, bitácora, asistencia, avisos, cargos, uniformes, documentos, tickets) | contrato + 45 días para descargar + 30 para suprimir | 75 | LFPDPPP 10 y 12; ciclo de Mission Control (`toDeletionEligible` = 45) |
| Cuenta de usuario y conversaciones con Lumi | mientras exista; supresión en 30 días tras «Eliminar mi cuenta y mis datos» | 30 | LFPDPPP 10 y 24 |
| Auditoría y sesiones | 2 años desde el evento | 730 | CCF 1934 |
| Constancia de consentimiento | cuenta + bloqueo 10 años | 3,650 | LFPDPPP 2 III y 24; CCF 1159 |
| Facturación de la licencia | 5 años desde la declaración | 1,825 | CFF 30 |
| Contacto y contrato del contratante | contrato + bloqueo 10 años | 3,650 | CCom 1047; LFPDPPP 24 |
| Adeudos de familias | tope de 72 meses | 2,190 | LFPDPPP 10 |
| Respaldos | ciclo de Base44 (no publicado) | — | DPA de Base44 |

## 3. Limitación de responsabilidad

Lo que se puede y no se puede limitar, leído en las fuentes:

- **Se puede regular por convenio**: Código Civil Federal art. 2117 («La
  responsabilidad civil puede ser regulada por convenio de las partes, salvo
  aquellos casos en que la ley disponga expresamente otra cosa»). Art. 2110:
  sólo daños y perjuicios «consecuencia inmediata y directa». Art. 2111: nadie
  responde del caso fortuito salvo que lo haya causado o aceptado.
- **No se puede por dolo**: art. 2106 («La responsabilidad procedente de dolo es
  exigible en todas las obligaciones. La renuncia de hacerla efectiva es
  nula»). La **culpa grave** se excluye también en la cláusula por prudencia:
  la doctrina y criterios judiciales suelen asimilarla al dolo, pero **no se
  verificó una tesis concreta** que lo afirme.
- **Daño moral**: art. 1916 (vida privada, configuración física, etc.): el daño
  a un menor por una fuga de datos de salud entra aquí; no se limita.
- **Consumidor**: [Ley Federal de Protección al Consumidor](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPC.pdf),
  art. 90: en contratos de adhesión son nulas y «se tendrán por no puestas»
  las cláusulas que «II. Liberen al proveedor de su responsabilidad civil»,
  «IV. Prevengan términos de prescripción inferiores a los legales» o «VI. […]
  lo sometan a la competencia de tribunales extranjeros». Art. 2 fr. I: una
  persona moral que integra el servicio a su prestación a terceros (una escuela)
  sólo es consumidor para los arts. 99 y 117, y sólo si está acreditada como
  microempresa. Por eso la cláusula conserva expresamente los derechos de la
  LFPC «cuando tenga el carácter de consumidor» en vez de suponer que nunca lo
  tiene. Art. 76 Bis: confidencialidad y seguridad en transacciones por medios
  electrónicos.
- **Datos personales**: las multas y responsabilidades de la LFPDPPP (arts. 53,
  59, 61) son de orden público (art. 1: «La presente Ley es de orden público»);
  un contrato entre ACACIA y la escuela no puede renunciarlas, y menos frente a
  terceros (los titulares) que no son parte.

Cláusula adoptada (Términos, sección 12): tope igual a lo pagado en los 12
meses previos, con exclusiones expresas para dolo o culpa grave, protección de
datos/confidencialidad/seguridad, daño moral y derechos LFPC; caso fortuito
excluido salvo culpa; y una aclaración de que el tope no limita los derechos
de los titulares.

## 4. Jurisdicción

Código de Comercio art. 1092 (es competente el juez al que las partes se
sometieron) y **art. 1093** (sumisión expresa al renunciar «clara y
terminantemente al fuero que la ley les concede» y señalar los tribunales del
domicilio de cualquiera de las partes). El contrato ACACIA–escuela es
mercantil del lado de ACACIA; se eligieron los tribunales competentes de
Aguascalientes, Aguascalientes (domicilio de ACACIA), con ley mexicana. Quedan
a salvo PROFECO (LFPC arts. 90 fr. VI y 99) y la Secretaría Anticorrupción y
Buen Gobierno.

## 5. Base44

| Tema | Lo que publica Base44 | Fuente |
|---|---|---|
| Entidad | Wix.com Ltd. y filiales operan Base44; términos bajo ley de Nueva York | [Términos](https://base44.com/terms-of-service), [DPA](https://base44.com/dpa) |
| Rol | «Company shall be considered your processor, and in no event shall be considered as the controller of the data.» | [DPA](https://base44.com/dpa) |
| Subencargados | MongoDB (US, almacenamiento), SendGrid (US, correo), Render (US, servidores), Google Cloud (US, analítica), OpenAI (US, LLM), Anthropic (US, LLM), Wix.com Ltd. (Israel), Supabase (US, archivos), Datadog (US, registros) | [DPA Exhibit C](https://base44.com/dpa/exhibitc) |
| Más subencargados | Langfuse (Alemania, «LLM logging») | [Seguridad](https://base44.com/security) |
| Modelos de IA para agentes | «Automatic» (por defecto), Google Gemini, OpenAI GPT, Anthropic Claude, GLM | [Agentes de IA](https://docs.base44.com/Building-your-app/AI-agents-for-apps) |
| Región | «Base44 stores your app data in the US by default»; servidores en EE. UU. | [Seguridad](https://base44.com/security), [Privacidad y seguridad](https://docs.base44.com/Community-and-support/Privacy-and-security) |
| Certificaciones | SOC 2 Type II e ISO 27001 | [Seguridad](https://base44.com/security); también lo dice el sitio de ACACIA |
| Cifrado | TLS 1.2+ en tránsito, AES-256 en reposo, incluidos respaldos | [Seguridad](https://base44.com/security) |
| Correo | SendGrid es el subencargado de «Email transmission» | [DPA Exhibit C](https://base44.com/dpa/exhibitc) |
| Respaldos | «keeps each backup for a set period» (el periodo no se publica) | [Privacidad y seguridad](https://docs.base44.com/Community-and-support/Privacy-and-security) |
| Entrenamiento de IA | «**Enterprise:** your data is not used to train AI models. […] **All other plans:** your data can be used to train AI models. The Enterprise exclusion covers your whole workspace, including personal information that people submit through your app's forms.» Los términos generales también incluyen el permiso de usar «Customer Data» para «train Company software tools (e.g. artificial intelligence and machine learning models)». | [Privacidad y seguridad](https://docs.base44.com/Community-and-support/Privacy-and-security), [Términos](https://base44.com/terms-of-service) |
| Política de privacidad | No nombra proveedores de IA ni región; menciona transferencias a otros países | [Privacy policy](https://www.base44.com/privacy-policy) |

Comprobado además por la API de plataforma (sólo lectura, 2026-10-02): la
grabación de sesiones de la app LIUMA (`696e967c430ceb6a2232ffd8`) está
**apagada** (`enabled: false`). El aviso dice que LIUMA no graba sesiones. En
el repo, Lumi corre con `"model": "automatic"` (`base44/agents/lumi.jsonc`), así
que Base44 elige el proveedor en cada mensaje: el aviso nombra a los tres que
Base44 publica para agentes (Anthropic, Google, OpenAI). El kit de Base44
(`@base44/sdk`, módulo `analytics`) envía métricas de sesión y guarda
`base44_analytics_session_id` en el navegador; el aviso lo declara.

**Consecuencia para el texto.** El borrador prometía que el proveedor no
entrenaría modelos con los datos. Con lo que Base44 publica, eso sólo es cierto
en su plan Enterprise, y nada en el repo ni en la API muestra que el espacio de
trabajo de LIUMA lo tenga. Un aviso vigente no puede prometerlo. El texto
**lo informa** (sección 5 del aviso) y queda gobernado por
`BASE44_AI_TRAINING_EXCLUDED = false`; cambiarlo a `true` cambia el texto y una
prueba lo fija, pero sólo debe hacerse con evidencia (factura Enterprise o
exclusión por escrito de Base44).

## 6. Roles adoptados

- **Escuela = responsable** de los datos de su comunidad (alumnos, familias,
  personal): decide finalidades y quién entra.
- **ACACIA = encargado** respecto de esos datos (art. 2 fr. XII); **Base44 y sus
  subencargados = subencargados** de ACACIA (remisiones, no transferencias,
  art. 2 fr. XX).
- **ACACIA = responsable** de los datos de contacto, contrato y facturación de
  quien contrata por la escuela.

## No verificado / riesgos que el dueño asume

1. **Entrenamiento de IA por Base44** (arriba). Si Base44 usa datos de salud de
   menores para entrenar modelos para sí misma, deja de actuar sólo «por cuenta
   del responsable» y eso se parece más a una transferencia que exigiría
   consentimiento expreso (arts. 8, 35, 36). El aviso lo informa, pero informar
   no lo convierte en lícito. La salida limpia es el plan Enterprise o una
   exclusión por escrito.
2. **Reglamento**: la Ley remite a un Reglamento (art. 2 fr. XIII y otros) y el
   transitorio Décimo Segundo daba 90 días para armonizarlo. No se encontró
   publicado un Reglamento nuevo; el de 2011 (que regula remisiones y
   encargados con detalle) es de la ley abrogada y su vigencia parcial no se
   confirmó.
3. **«Mecanismo de autenticación» del art. 8**: que una casilla marcada con una
   cuenta autenticada y registrada sea consentimiento «por escrito» suficiente
   para datos sensibles no tiene criterio publicado de la Secretaría.
4. **Plazos de respaldo de Base44**: no se publican; el texto no da días para
   respaldos.
5. **Supresión automática**: nada en LIUMA borra hoy, por sí solo, auditoría a
   los 730 días ni datos de una escuela a los 75: lo ejecuta ACACIA (Mission
   Control marca la elegibilidad). Es un compromiso operativo nuevo.
6. **«Eliminar mi cuenta y mis datos»**: el aviso describe la opción que
   construye el paquete de consentimiento de v1.9.0. Si ese paquete no sale en
   el mismo despliegue, el aviso describiría una opción inexistente.
7. **Culpa grave = dolo**: incluida por prudencia, sin tesis citada.
8. **Identidad de la escuela**: el art. 15 I pide identidad y domicilio del
   responsable. La página pública no puede mostrar los de cada escuela (no hay
   sesión); los Términos obligan a la escuela a poner el aviso a disposición con
   su nombre y domicilio.
