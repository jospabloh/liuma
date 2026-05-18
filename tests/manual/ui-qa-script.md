# Manual QA Script - UX Consistency

## Shared scoring model (apply to every screen)

Pass threshold per screen: **>= 85/100**.

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

### Auto-fail blockers
- Confusing critical flows.
- Inaccessible primary actions.
- Policy-denied flows with unclear messaging.

## Devices
- Phone viewport: 360x800
- Laptop viewport: 1366x768

## Flows
1. Home by role (admin/teacher/parent): no overlap, readable cards, no horizontal scroll.
2. Permisos y Roles: table readability, long value truncation, keyboard navigation.
3. Lumi bubble/chat:
   - Floating button does not overlap sticky actions.
   - Open/close animation is smooth.
   - Clicking overlay closes chat.
   - Denied policy message is explicit.
4. Asistencia/Tarea/Bitácora: loading/empty/error visuals are consistent.
5. Pagos/Avisos: toast messages are clear and not duplicated.

## Accessibility checks
- Tab order reaches primary actions in visual order.
- Focus ring visible on buttons, dialogs, close actions.
- ESC closes dialogs.
- Dialog close controls are keyboard reachable.
