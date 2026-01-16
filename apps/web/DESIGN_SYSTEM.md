# DealDecision AI Web – Design System

This doc defines the minimal UI styling standards for the web app.

## Goals

- Keep UI consistent across the app (light/dark, portal overlays, buttons, surfaces).
- Prefer design tokens and shared utilities over ad-hoc colors and repeated “glass” strings.
- Make it easy to review PRs: diffs should read like intent, not hand-tuned styling.

## Theming + Tokens

### Source of truth

- Token variables live in `apps/web/src/styles/globals.css`.
- Theme utility classes and button system live in `apps/web/src/styles/theme-overrides.css`.

### Dark mode rule

Portal-rendered UI (dropdowns/popovers/modals) must inherit the theme.

- Apply `.dark` on `document.documentElement` (not a nested div), so Radix portals inherit correctly.

## What to use (preferred)

### Colors / text

Use token-backed utility classes wherever possible:

- `bg-background`, `text-foreground`
- `bg-card`, `text-card-foreground`
- `bg-popover`, `text-popover-foreground`
- `bg-muted`, `text-muted-foreground`
- `border-border`

If you need a one-off, prefer adding a small token-backed utility class to `theme-overrides.css` rather than using hardcoded Tailwind grays or hex colors.

### Buttons

Use the `dd-btn-*` system:

- `dd-btn-base dd-btn-primary dd-btn-md`
- `dd-btn-base dd-btn-secondary dd-btn-sm`
- `dd-btn-base dd-btn-ghost dd-btn-icon-only`

### Surfaces

Use shared surface utilities (defined in `theme-overrides.css`):

- `dd-surface` (default card-like surface)
- `dd-surface-muted` (subtle secondary surface)
- `dd-surface-glass` (blurred glass surface; use sparingly)
- `dd-surface-popover` (popover/menu surface)
- `dd-divider` (standard divider line)

## What to avoid

These patterns are allowed only with an explicit justification (and should generally be replaced with tokens/utilities):

- Hardcoded grays like `text-gray-500`, `bg-slate-900`, etc.
- Hex colors like `#64748b` in `className`/inline styles.
- Inline `rgba(...)`/`rgb(...)` color values.

## Guardrail (style drift)

The repo includes a lightweight style drift checker intended to prevent reintroducing hardcoded grays/colors.

- `pnpm style:drift` fails only on *new* violations vs the checked-in baseline.
- `pnpm style:drift:update` regenerates the baseline when a change is intentional.

Baseline file is tracked at `scripts/style_drift_baseline.json`.

## Updating the system

When adding a new component pattern:

1. Prefer composing existing token utilities + `dd-btn-*` + `dd-surface-*`.
2. If needed, add a small, token-backed utility in `theme-overrides.css`.
3. If you intentionally add a new exception, update the drift baseline and note the rationale in the PR.
