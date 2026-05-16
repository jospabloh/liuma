# Política de retención y privacidad de auditoría

## Alcance
Los eventos de auditoría cubren: asistencia, pagos, aprobaciones de usuarios, avisos, bitácoras y decisiones de autorización de IA.

## Esquema estándar
Cada evento debe registrar:
- `actor`
- `role`
- `entity`
- `entity_id`
- `action`
- `timestamp`
- `reason`
- `context`

## Renderizado seguro de PII
La UI de auditoría enmascara campos sensibles en `context` (`email`, `phone`, `reference`, `notes_text`, `teacher_message`) para evitar exposición accidental.

## Retención
- Retención operativa recomendada: **12 meses**.
- Exportaciones CSV: uso administrativo puntual; no reemplazan respaldo de base.
- Revisión trimestral recomendada para depuración/control de volumen.
