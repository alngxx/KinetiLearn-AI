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
- `cssEntry` points at `dist/assets/index-<hash>.css`. **The hash changes
  whenever the CSS content changes** — re-point `cssEntry` after rebuilding the
  app, or the build fails on a missing file.
- **This actually bit the 2026-09-02 sync**: config still said
  `index-X6N_XN_D.css` while `dist/` had `index-COA_yiTx.css` (the token commit
  dff94b3 changed the CSS). Now pinned at `index-COA_yiTx.css`. The hash is
  content-derived, so a rebuild with no CSS change reproduces it — check it
  first anyway, exactly as the risk list says.

## Fonts
- The compiled Vite CSS references fonts as root-absolute `url(/assets/*.woff2)`.
  `extractFonts` resolves urls relative to the CSS file, so those never resolve.
  **Correction (2026-09-02):** an earlier note here said those faces were
  "dropped → `[FONT_DANGLING]`". They were not — stock `extractFonts` emitted
  them anyway with the dead url intact, and `[FONT_DANGLING]` never fired. That
  is what the `css.mjs` fork below now actually fixes.
- Fixed by pointing `extraFonts` at the **upstream @fontsource packages**
  (`node_modules/@fontsource-variable/geist{,-mono}/index.css`), which ship
  relative `./files/*.woff2` urls and stable filenames. 11 woff2 files ship.

## `.design-sync/overrides/css.mjs` — dangling @font-face drop (cfg.libOverrides)

`extractFonts` in the bundled `lib/css.mjs` pushes every `@font-face` rule it
parses, even when a `url()` failed to resolve — it `continue`s past the bad url
but still emits the rule. The Vite `cssEntry` ships **root-absolute**
`url(/assets/geist-*.woff2)`, which `resolve(srcDir, '/assets/...')` sends to the
filesystem root, so it can never resolve. Result: `fonts/fonts.css` shipped 22
blocks — 11 dead `/assets/` ones plus the 11 real `./geist-*.woff2` ones from
`extraFonts`. Same family+weight+style+unicode-range, so the later (working)
copy won the cascade and fonts rendered fine — the dead half was silent, and
`[FONT_DANGLING]` never fired because the check only looks at relative urls.

The fork drops a face only when it has local urls and **none** resolved (a face
with one good url still ships), and logs each drop. `lib/css.mjs`'s own
`rewriteBundleFontFaces` documents exactly this hazard — the fork just applies
the same rule one function earlier.

- Repointed import: `'../../.ds-sync/lib/common.mjs'` (siblings don't exist under
  `overrides/`). No bare deps, so **no `node_modules` symlink needed**.
- Declared in `cfg.libOverrides` — an undeclared fork fires `[OVERRIDE_UNDECLARED]`.
- **Adding or deleting a lib fork moves the grade contract for every component.**
  This run went from "21 carried forward" to "21 pendingGrade" the moment the
  fork landed, and all 21 had to be re-graded from fresh sheets. Expect the same
  one-time cost if this fork is ever removed. Re-copying the staged scripts alone
  (a `scriptsSha` change) did **not** clear grades — only the fork did.
- On re-sync, diff this fork against the bundled `lib/css.mjs` and merge upstream
  changes. If upstream ever fixes the dangling-face bug, delete the fork **and**
  its `libOverrides` entry (and budget the one-time re-grade).

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
  utilities the app actually used. Components are unaffected (their classes are
  all used), but this is documented in `conventions.md` for the design agent —
  **and its example list goes stale as the app grows.** At the 2026-09-02 sync
  every one of the previously "verified absent" examples (`gap-7`, `font-mono`,
  `tabular-nums`, `mt-0`, `text-3xl`) had become present. Re-verified absent
  now: `gap-10`, `p-12`, `text-4xl`, `rounded-none`, `tracking-widest`.
  **Re-run the conventions validation pass every sync** — a stale "don't use
  this" list is worse than none, because the agent believes it. It went stale
  again on 2026-09-03: all five of the 2026-09-02 examples (`gap-10`, `p-12`,
  `text-4xl`, `rounded-none`, `tracking-widest`) had become present. Now:
  `gap-16`, `p-14`, `text-5xl`, `tracking-tighter`, `rounded-3xl`,
  `leading-loose`. **Two syncs, two full turnovers — assume it is stale.**
- **Band-token utilities: the table is a moving target, re-derive it.**
  **Correction (2026-09-03):** the 2026-09-02 note claiming "no utility ships
  for advanced" is now **wrong** — `bg-band-advanced`, `text-band-advanced` and
  `border-band-advanced` all compile today. Genuinely absent now: `border-info`,
  `text-band-intermediate`, `border-band-intermediate`.
  That earlier claim was also partly a **measurement bug**: matching
  `\.bg-band-advanced(?![\w-])` also matches `.bg-band-advanced\/30`, because
  the escaped slash is neither `\w` nor `-`. Opacity modifiers compile per
  literal value, so bare and `/30` are separate selectors and have to be probed
  separately. Derive the set from the full selector list, not per-name regexes:
      sel = set(re.findall(r'\.((?:[\w-]|\\.)+)', css))   # bare: `u in sel`
  Half-step spacing is the other reliable gap: `gap-3.5`, `pt-4.5`, `size-1.5`
  are all absent while their whole-step neighbours ship.
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
- **First sync 2026-08-30.** Project `KinetiLearn`
  (`8178c566-d7f5-4ac9-92ae-88fcb1717e1c`, pinned as `cfg.projectId`); 125 files,
  21 components, render check clean, validate exit 0.
- **Re-sync 2026-09-02** (atomic path, pinned project). Purpose: land the three
  skill-band tokens (`--info`, `--band-intermediate`, `--band-advanced`) added in
  dff94b3 — the previous bundle predated `--band-advanced` and shipped without it.
  - Fixed the stale `cssEntry` hash; added the `css.mjs` fork; corrected two
    stale claims in `conventions.md`.
  - 21/21 render clean, all 37 cells re-graded `good` (forced by the fork), final
    driver run showed **zero grades cleared** — next sync carries forward.
  - Uploaded 125 files, **zero deletes** (`upload.deletePaths` empty).
- **The project holds more than this build**: `templates/learner-portal/`,
  `templates/learner-home-horizon/`, `templates/login-landing/`,
  `design_handoff_login_landing/` and `uploads/*.png` are design work, NOT
  converter output. **Never let a plan's `deletes` glob reach them.** The
  standard `deletes` list in the base skill (`components/**`, `tokens/**`,
  `fonts/**`, `_vendor/**`, `_preview/**`, `guidelines/**`) does not — but a
  broader glob would destroy them.
- `tokens/` and `guidelines/` are empty by design and don't upload — this DS
  keeps its custom properties inside `_ds_bundle.css`, which `styles.css`
  `@import`s (that closure is what rendered designs receive).

- **Re-sync 2026-09-03** (atomic path, pinned project). Purpose: land the
  Horizon atmosphere tokens added while porting `LearnerPortal.dc.html`
  (screen=home) and `LearnerSkillsHorizon.dc.html` into the app.
  - `--sky`, `--glow`, `--star`, `--star-2`, `--bloom` (themed) and `--band-h`
    (light-scope layout constant, now **292px** — the mock's own number, adopted
    together with the mock's taller hero lead rather than shrinking the band)
    all ship in `_ds_bundle.css`. The design agent no longer needs to hard-code
    them into a new artboard.
  - `cssEntry` had drifted a **third** time (`index-COA_yiTx` → `index-Cbpf3UJ0`).
    This is now the single most reliable breakage in this repo; fix it first,
    every time.
  - Fetched the remote `_ds_sync.json` into `.design-sync/.cache/remote-sync.json`
    and passed `--remote`: **21/21 unchanged, zero pendingGrade, zero re-grading.**
    Without it the driver re-verifies everything and all 37 cells need grading
    by hand — always fetch the anchor first.
  - Rewrote two stale `conventions.md` claims (above), rebuilt so `README.md`
    picked up the stitched header, re-uploaded it.
  - Uploaded 126 files, **zero deletes**; `list_files` afterwards confirmed all
    four `templates/` dirs, `design_handoff_login_landing/` and all 34
    `uploads/*.png` intact.
  - Note: 16 of 21 components re-uploaded even though all 21 verified unchanged
    — emitted artifacts move with the stylesheet; the *grades* are what the
    anchor protects.
  - **Second styling push the same day**, after re-diffing against a fresh
    self-contained snapshot of `LearnerPortal.dc.html`: light `--star`/`--star-2`/
    `--bloom` moved, the starfield went from 4 animated tiles to **3 static**
    ones, the mask fade moved 38%→72%, and `--header-h` dropped 4.75rem→3.75rem.
    `cssEntry` drifted twice within the one session — it changes on **every**
    CSS edit, so re-point it immediately before each build, not once per sync.
  - **A bundled `.html` snapshot is not the whole screen.** The shell
    (`LearnerPortal`) `dc-import`s `PortalHome`/`PortalSkills`/`PortalExam`, and
    those are *not* inlined into the snapshot. Fetch them from the project
    separately or half the page is invisible.

## Outstanding after the 2026-09-02 sync
- `templates/learner-portal/LearnerPortal.dc.html` still carries the stopgap that
  hard-codes the three band tokens into its `:root:root:root` and
  `html.dark.dark.dark` blocks. It is now **redundant** — `ds-base.js` loads
  `../../styles.css` + `_ds_bundle.css`, and the shipped values are identical.
  Safe to delete both runs of:
  `--info:...;--band-intermediate:...;--band-advanced:...`
  Not removed automatically: `DesignSync.get_file` can't write to disk, so
  rewriting a 20KB hand-authored artboard means reproducing it verbatim from
  context — too much risk of a silent corruption for a cosmetic cleanup. Do it
  in the Claude Design app, or have an agent do it with the file open.
- Sibling artboards (`PortalSkills`/`PortalHome`/`PortalExam`,
  `learner-home-horizon`) were **not** audited for the same patch.
