# KinetiLearn design system — how to build with it

21 React components from the KinetiLearn corporate-training platform (admin and
learner portals). Styling is **Tailwind v4 utility classes** driven by CSS
custom properties. Light and dark are both shipped.

## Wrapping and setup

Two components read React context and **throw** without a provider:
`ThemeToggle` and `Toaster` both call `useTheme()`. `ThemeProvider` is exported
from the bundle — wrap anything that uses them:

```jsx
import { ThemeProvider, PageHeader, Button, Toaster } from '<bundle global>'

<ThemeProvider>
  <PageHeader eyebrow="People" title="Classes" actions={<Button>New class</Button>} />
  <Toaster position="top-center" />
</ThemeProvider>
```

- `RowActions` renders `<Link>` for actions that carry a `to` prop, so it needs
  a react-router context in the tree. Actions with only `onSelect` do not.
- Dark mode is a **class**, not a media query: `ThemeProvider` toggles `.dark`
  on `<html>`. Every colour token has a dark value already.
- `Toaster` renders nothing until a toast is raised — render it once near the
  root, then call `toast(...)`.

## The styling idiom: Tailwind v4 utilities over semantic tokens

Never hardcode a colour. Every colour, radius and elevation is a token, and the
utilities below are the vocabulary:

| Family | Use these |
|---|---|
| Text colour | `text-foreground` `text-muted-foreground` `text-primary` `text-destructive` `text-success` `text-info` |
| Surfaces | `bg-background` `bg-card` `bg-muted` `bg-popover` `bg-primary` `bg-secondary` |
| Border | `border-border` (`border-input` on form controls) |
| Radius | `rounded-md` `rounded-lg` `rounded-xl` `rounded-full` |
| Elevation | `shadow-raised` `shadow-overlay` `shadow-floating` |
| Spacing | `gap-1…gap-6` `gap-8`, `p-1…p-6` `p-8` (the even scale — see the caveat below) |
| Type scale | `text-xs` `text-sm` `text-base` `text-lg` `text-2xl` |

Three project-specific component classes carry the house style — prefer them
over rebuilding the same treatment:

- **`.surface`** — the one card treatment: `rounded-xl border border-border
  bg-card` plus the raised elevation. Use it for any panel that is not a `Card`.
- **`.label-micro`** — the third type role: uppercase mono micro-caps for column
  headers and field captions. This is what makes structural text read as
  structure. `PageHeader` uses it for its eyebrow.
- **`.numeric`** — `font-mono tabular-nums` for measured values (scores, counts,
  thresholds) so figures line up column-to-column.

Geist carries prose and headings; **Geist Mono is the utility face for measured
values** — ranks, thresholds, counts read as instrument readouts, not sentences.

### One important caveat about the stylesheet

`styles.css` is a **compiled Tailwind v4 subset** — it contains only the
utilities the KinetiLearn app itself uses. The components are unaffected (every
class they need ships), but a utility the app never used is **not in the
stylesheet and will silently do nothing**. Verified absent, for example:
`gap-7`, `font-mono`, `tabular-nums`, `mt-0`, `text-3xl`.

So for your own layout glue, stay inside the families tabled above, or reach for
the tokens directly: `style={{ gap: 'var(--spacing)' }}`,
`color: 'var(--muted-foreground)'`, `boxShadow: 'var(--elevation-raised)'`.
Tokens are defined on `:root` and `.dark` — read `styles.css` and its imports
before inventing a class.

## Where the truth lives

- `styles.css` and its `@import` closure — all tokens, `.dark` overrides, and
  every utility that actually ships.
- `components/<group>/<Name>/<Name>.d.ts` — the real prop contract.
- `components/<group>/<Name>/<Name>.prompt.md` — per-component usage.

## An idiomatic build

Library components for the controls; the utility vocabulary above for your own
layout:

```jsx
<div className="flex flex-col gap-6">
  <PageHeader
    eyebrow="Assessment"
    title="Exam generator"
    description="Generate a draft exam from any processed document."
    actions={<Button>New exam</Button>}
  />

  <div className="surface p-6 flex flex-col gap-4">
    <span className="label-micro">Published</span>
    <Table>
      <TableHeader>
        <TableRow><TableHead>Class</TableHead><TableHead>Status</TableHead></TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="font-medium">Security awareness 2026</TableCell>
          <TableCell><StatusBadge active /></TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
</div>
```

Compose empty and error states rather than inventing them: `EmptyState`
(icon + title + body) and `QueryErrorState` (title + retry) already exist, as do
`StatusBadge` / `ResultBadge` for state, which always pair colour with a word —
never let colour carry meaning alone.
