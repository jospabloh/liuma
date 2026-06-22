# Premium UI preview harness

A **dev-only** visual harness that renders the real premium UI components
(`SideNav`, `BigTile`, `Card`, `PageHeader`, `EmptyState`, `LoadingScreen`,
`Skeleton`, form fields, `Dialog`) against **mock data** — no base44 backend or
auth required — so they can be screenshotted for design review.

It is **not** part of the production app: `index.html` remains the only build
entry unless `PREVIEW=1` is set, so a normal `npm run build` is unchanged.

## View it live (interactive)

```bash
npm run preview:dev      # opens /preview.html on the Vite dev server
```

Top bar: switch the **tenant brand color** (watch everything re-skin — proves
there's no hardcoded hex) and toggle **dark mode**; "Abrir diálogo" opens the
real modal.

## Capture PNG screenshots

```bash
npx playwright install chromium   # one-time, downloads the browser
npm run preview:shots             # PREVIEW=1 vite build  +  Playwright capture
```

Output lands in `docs/screenshots/`:

| File | What |
|---|---|
| `gallery-light.png` | Full gallery, light theme, default brand |
| `gallery-dark.png` | Full gallery, dark theme |
| `gallery-brand-13_148_136.png` | Re-skinned to teal |
| `gallery-brand-234_88_12.png` | Re-skinned to orange |
| `dialog.png` | The real Dialog, opened |

> Note: in sandboxed CI/remote environments the Chromium **download** may be
> blocked by network policy — run the capture on a machine with normal network
> access. The build step (`PREVIEW=1 vite build`) works anywhere and validates
> that the harness compiles.

## How it works

- `preview.html` → `src/preview/main.jsx` → `src/preview/Gallery.jsx`.
- `Gallery` wraps everything in a `MemoryRouter`; `SideNav` is rendered inside a
  `transform`ed box (which becomes the containing block for its `position:fixed`
  root) and fed a mocked `NavContext` value, so it renders without base44.
- `vite.config.js` only adds `preview.html` as a second Rollup input when
  `PREVIEW=1`.
