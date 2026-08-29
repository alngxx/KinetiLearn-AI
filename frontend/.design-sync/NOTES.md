# design-sync notes — kinetilearn-frontend

## Shape of this repo
- This is an **application**, not a design-system package: `private: true`, no
  `main`/`module`/`exports`, no library build, no Storybook. `shape: "package"`
  with no `buildCmd`; the component surface is bundled from source.
- `dist/` is a **Vite app build**, not a component library. Only its compiled
  stylesheet is used (see cssEntry below).

## Entry: why `.design-sync/ds-entry.tsx` (pinned as `cfg.entry`)
- The converter's synth entry does `export * from` **every** `.tsx` under
  `srcDir`, which would include `src/main.tsx` and run the app's bootstrap
  (`createRoot().render()`) inside every preview.
- `.design-sync/ds-entry.tsx` is a hand-written barrel listing exactly the
  21 in-scope component files, plus the preview provider. This is now pinned as
  `cfg.entry`, so a bare `resync.mjs`/`package-build.mjs` run picks it up — the
  `--entry` flag is no longer required (it still works and wins if passed).
- Adding a component to the sync means adding it to BOTH `ds-entry.tsx` and
  `componentSrcMap`.

## Real prop contracts (`.d.ts`) — needs a declaration emit

Without this, **all 21 components emitted `[key: string]: unknown`** — no prop
information at all for the design agent, in either the `.d.ts` or the generated
`.prompt.md`. The cause: `lib/dts.mjs` resolves props from a `.d.ts` tree, and a
Vite *app* build never emits declarations, so `findTypesRoot` fell through to the
package root and `propsBodyFor`'s call-signature fallback found no `entry`.

Fixed with `cfg.buildCmd`, which must be run before the converter:
1. `tsc --declaration --emitDeclarationOnly --outDir dist/types` — clean, exit 0.
   `dist/types` is one of the dirs `findTypesRoot` probes, and `dist/` is already
   gitignored.
2. `node .design-sync/gen-dts-barrel.mjs` — writes `frontend/index.d.ts`, the
   barrel `dts.mjs` uses as its `entry` (no `types` field in package.json, so it
   falls back to `<pkgDir>/index.d.ts`).

**The barrel is generated from `componentSrcMap`, deliberately.** An earlier
attempt used `export *`, which pulled in every subcomponent (CardHeader,
TableRow, DialogContent…) and took the card count from 21 to **59**. Named
exports keep the DTS set equal to the synced set. Subcomponents still ship in
the bundle and are importable — they just don't get their own cards.

Result: 20/21 components carry real props. `ThemeToggle` takes none, so its
empty signature is honest.

### `cfg.dtsPropsFor` overrides — why each exists
The emitted declarations reference types that don't travel into the single-file
contract, leaving dangling names the design agent can't resolve. Four overrides
inline the real shapes:
- `RowActions` — `actions: RowAction[]` (type lives in RowActions.tsx).
- `FieldRow` — `FormField` / `Option[]` (from `components/form/types.ts`).
- `EmptyState` — `LucideIcon` (from lucide-react).
- `Toaster` — `ToastOptions` / `ToastIcons` / bare `CSSProperties` (sonner).
  Kept sonner's real literal unions; only the three unresolvable names were
  replaced. **Write this body by hand** — deriving it by slicing the generated
  file dropped the interface's closing brace and produced `[DTS_PARSE]`.
`RegExp` in FieldRow is a global built-in — resolvable, not a dangling ref.

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
- **Run `cfg.buildCmd` before every sync.** It regenerates `dist/types` and
  `index.d.ts`. Skip it after editing a component's props and the `.d.ts` ships
  stale; skip it on a fresh clone (both paths are gitignored) and every
  component silently reverts to `[key: string]: unknown`.
- **`dtsPropsFor` drift**: the four overrides above are hand-written snapshots.
  If `FormField`, `RowAction`, or the sonner props change, they go stale
  silently — the build won't warn. Re-check them when those types change.
- **Provider chain**: if a newly synced component needs a context beyond
  router + theme, it will render as a floor card until `DesignPreviewProvider`
  is extended.
- **Anchor exists now** (first upload landed 2026-08-30). Fetch the project's
  `_ds_sync.json` to `.design-sync/.cache/remote-sync.json` and pass `--remote`,
  or the driver re-verifies all 21 components instead of just what changed.

## Sync status
- **First sync completed 2026-08-30.** Project `KinetiLearn`
  (`8178c566-d7f5-4ac9-92ae-88fcb1717e1c`, pinned as `cfg.projectId`); 125 files,
  21 components, render check clean (`bad: 0`), validate exit 0.
- The uploaded `_ds_sync.json` is now the anchor: the next sync fetches it to
  `.design-sync/.cache/remote-sync.json` and passes `--remote`, so unchanged
  components skip re-verification.
- `tokens/` and `guidelines/` are empty by design and don't upload — this DS
  keeps its 167 custom properties inside `_ds_bundle.css`, which `styles.css`
  `@import`s (that closure is what rendered designs receive).
