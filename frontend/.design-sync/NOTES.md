# design-sync notes — kinetilearn-frontend

## Shape of this repo
- This is an **application**, not a design-system package: `private: true`, no
  `main`/`module`/`exports`, no library build, no Storybook. `shape: "package"`
  with no `buildCmd`; the component surface is bundled from source.
- `dist/` is a **Vite app build**, not a component library. Only its compiled
  stylesheet is used (see cssEntry below).

## Entry: why `--entry .design-sync/ds-entry.tsx`
- The converter's synth entry does `export * from` **every** `.tsx` under
  `srcDir`, which would include `src/main.tsx` and run the app's bootstrap
  (`createRoot().render()`) inside every preview.
- `.design-sync/ds-entry.tsx` is a hand-written barrel listing exactly the
  21 in-scope component files, plus the preview provider. **Always build with
  `--entry ./.design-sync/ds-entry.tsx`** — a bare build would re-synthesize.
- Adding a component to the sync means adding it to BOTH `ds-entry.tsx` and
  `componentSrcMap`.

## Layouts are deliberately out of scope
- `AdminLayout` / `LearnerLayout` were dropped (user decision, this sync).
- `LearnerLayout` imports `ChatPanel → useChat → chat/api → lib/apiClient`,
  which reads `import.meta.env.VITE_API_BASE_URL` at module top level and
  **throws**. The converter defines a fixed `import.meta.env` without that key,
  so the throw killed the whole IIFE and `window.KinetiLearn` was never
  assigned — every one of the 21 components failed with `[BUNDLE_EXPORT]`.
- Re-adding them needs: a stub for `@/lib/apiClient` (a sync-only tsconfig
  `paths` mapping works without touching app source), plus `AuthProvider` in
  the preview provider chain. It also drags the chat/SSE/API layer into the
  uploaded bundle, which is why it was declined.

## cssEntry is the compiled Vite output, and it is hash-named
- `src/index.css` is Tailwind v4 **source** (`@import "tailwindcss"`), not
  usable as `cssEntry`.
- `cssEntry` points at `dist/assets/index-<hash>.css`. **The hash changes on
  every `npm run build`** — re-point `cssEntry` after rebuilding the app, or
  the build fails on a missing file.

## Fonts
- The compiled Vite CSS references fonts as root-absolute `url(/assets/*.woff2)`.
  `extractFonts` resolves urls relative to the CSS file, so those never resolve
  and every `@font-face` was dropped → `[FONT_DANGLING]`.
- Fixed by pointing `extraFonts` at the **upstream @fontsource packages**
  (`node_modules/@fontsource-variable/geist{,-mono}/index.css`), which ship
  relative `./files/*.woff2` urls and stable filenames. 11 woff2 files ship.

## Preview provider
- `cfg.provider` is `DesignPreviewProvider`, defined in `ds-entry.tsx`:
  `MemoryRouter` (for components rendering `<Link>`, e.g. `RowActions`)
  wrapping `ThemeProvider` (required by `ThemeToggle` and `Toaster`, both of
  which call `useTheme()` and throw without it).

## Toaster needs the bundle's own sonner instance
- `sonner` renders nothing until a toast is raised. A preview importing
  `{ toast } from "sonner"` bundles a **second** sonner copy with its own toast
  store, so the toast never reaches the bundled `Toaster` — the card was blank.
- Fixed by re-exporting `toast` from `ds-entry.tsx`; the preview imports it
  from `kinetilearn-frontend`.

## Known render warns (triaged, expect these)
- `[RENDER_THIN] Toaster` — "rendered height is 0px". Benign: sonner portals to
  `document.body` with fixed positioning, so the mount root measures zero.
  Screenshot confirmed the toast renders correctly.

## Card presentation
- Multi-cell components use `cardMode: "column"`; without it their cells were
  clipped at the right edge of the card in the DS pane.
- Portal/fixed overlays cannot be laid out in a grid at all: `Dialog`,
  `AlertDialog`, `DropdownMenu`, `Toaster` and `ConfirmDialog` use
  `cardMode: "single"` (ConfirmDialog pins `primaryStory: "Destructive"`).

## Re-sync risks — what can go stale
- **`cssEntry` hash** (above) — the single most likely breakage. Check it first.
- **Compiled-CSS subset**: the shipped stylesheet contains only the Tailwind
  utilities the app actually used. Utilities absent from the app (`gap-7`,
  `font-mono`, `tabular-nums`, `mt-0`) do **not** ship. Components are
  unaffected (their classes are all used), but this is documented in
  `conventions.md` for the design agent — keep that list true if the app's
  usage changes.
- **`ds-entry.tsx` drift**: components added to `src/components/` are NOT
  picked up automatically; the barrel and `componentSrcMap` are both manual.
- **Provider chain**: if a newly synced component needs a context beyond
  router + theme, it will render as a floor card until `DesignPreviewProvider`
  is extended.
- **Upload never happened on the first run** (see below) — the project has no
  `_ds_sync.json` anchor until a real upload lands, so the next sync
  re-verifies everything.

## Sync status
- First sync (this run) built and verified 21 components locally but **could
  not upload**: `DesignSync` needs design-system authorization and
  `/design-login` cannot run in a non-interactive session. No project was
  created, so `config.json` has no `projectId` yet.
