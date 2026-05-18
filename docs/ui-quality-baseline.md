# UI Quality Baseline (Phone + Laptop)

## Scope
Critical flows: Home (all roles), Permisos y Roles, Lumi bubble/chat, Asistencia/Tarea/Bitácora, Pagos/Avisos.

## Baseline checks
- Readability: body text >= 14px on phone, >= 15px on laptop, contrast AA minimum.
- Spacing consistency: 8px spacing scale; card/action groups keep 12-16px internal padding.
- Touch targets (phone): primary controls are at least 44x44.
- Keyboard/mouse (laptop): all actionable elements reachable with tab, visible focus ring, ESC closes dialogs.
- Responsive safety: no horizontal overflow on 360px width; dialogs must stay inside viewport.
- Tables/matrix: minimum row height 44px, nowrap headers, long content truncates with tooltip/details.
- States: each module should expose consistent loading, empty, error patterns.
- Notifications: one toast per event, consistent severity style and placement.

## Validation protocol
1. Run app at 360x800 and 1366x768.
2. Execute critical flows and record defects by severity.
3. Validate toast copy, severity and deduplication.
4. Validate Lumi denied-policy response clarity.
5. Regression pass of all critical routes.
