# Manual QA Script - UX Consistency

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
