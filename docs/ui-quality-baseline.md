# UI Quality Baseline (Phone + Laptop)

## Scope
Critical flows: Home (all roles), Permisos y Roles, Lumi bubble/chat, Asistencia/Tarea/Bitácora, Pagos/Avisos.

## Shared scoring model (all screens)
Use one rubric for every evaluated screen. Each screen is scored out of 100.

| Criterion | Weight |
|---|---:|
| Clarity/readability | 15 |
| Information hierarchy | 15 |
| Interaction friction | 15 |
| Mobile ergonomics | 10 |
| Laptop efficiency | 10 |
| Accessibility | 15 |
| Consistency | 10 |
| Trust/safety messaging | 10 |

### Pass threshold per screen
- PASS: score >= 85/100
- FAIL: score < 85/100

### Blocker criteria (auto-fail)
Any one blocker fails the screen regardless of weighted score:
- Confusing critical flows.
- Inaccessible primary actions.
- Policy-denied flows with unclear messaging.

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
2. Execute critical flows and score every screen with the shared rubric.
3. Validate toast copy, severity and deduplication.
4. Validate Lumi denied-policy response clarity.
5. Confirm blocker criteria are absent for each screen.
6. Regression pass of all critical routes.
