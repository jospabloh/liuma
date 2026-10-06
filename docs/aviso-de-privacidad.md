# Aviso de Privacidad — LIUMA

El texto vigente (versión `2026-10-02`, vigente desde el 2 de octubre de 2026)
**no vive aquí**. La única fuente es `src/lib/legal/legalDocs.js`, que la app
publica en `/aviso-de-privacidad` (y los Términos en `/terminos`) como rutas
públicas, sin sesión.

Este archivo contenía antes una plantilla con campos entre corchetes; se
sustituyó para que no exista una segunda copia que pueda contradecir a la
publicada. La investigación legal detrás de cada cláusula, con fuentes, está en
[`docs/legal-research-2026-10.md`](./legal-research-2026-10.md).

Para cambiar el texto: edita `src/lib/legal/legalDocs.js`, sube
`PRIVACY_NOTICE_VERSION` y `SERVICE_TERMS_VERSION` en
`src/lib/consent/privacyNotice.js` **y** en
`base44/functions/provisionOnboardingProfile/entry.ts` (las pruebas fallan si
difieren), y despliega funciones y sitio en la misma ventana.
