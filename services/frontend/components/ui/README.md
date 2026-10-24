# Frontend components

The frontend owns its component source. `components.json` configures shadcn/ui
with the `radix-nova` style and the public `@reui` registry. HeroUI is no longer a
dependency.

The visual baseline is ReUI’s default preview: **Inter, neutral colors, and Nova**.
Inter is self-hosted through `@fontsource-variable/inter`. `app/ui-theme.css` owns
the light/dark palette, sidebar tokens, chart tokens, and semantic status colors.
The base radius is 0.625rem; standard body copy is 14px. Inputs retain 16px text
on mobile to avoid browser input zoom.

`card.tsx` and the classes in `nova-styles.ts` come from the official
`https://ui.shadcn.com/r/styles/radix-nova/` registry; the button variants follow
the same source. State selectors are adapted for React Aria where necessary.
Compatibility aliases such as `Button`’s `primary`/`tertiary` and `md` map onto
Nova’s default/secondary variants and default size.

Use `muted` and `accent` for backgrounds and their `*-foreground` tokens for text.
Use `primary` for emphasis and primary actions. Avoid fixed neutral colors,
sub-12px UI copy, and page-level overrides of shared control sizes/radii. Domain
severity colors, user-defined tag colors, print-document layouts, and decorative
marketing artwork are content rather than additional component themes.
Compact stat cards retain their established 110px layout and use these tokens.

- `button.tsx`, `card.tsx`, and `dialog.tsx` provide Nova-styled primitives. Prefer
  `asChild` when a button renders a link, so the result has one interactive element.
- `badge.tsx` comes from ReUI's public Radix registry. `Chip` maps the app's status
  tones to its variants.
- `primitives.tsx`, `collections.tsx`, `overlays.tsx`, and `date-controls.tsx` expose
  the app's existing compound composition API through `index.ts`. They keep page
  changes small while centralizing styling. Collections, form fields, dates, and
  colors use React Aria for keyboard navigation, validation, and accessible state.
- `overlay-portal.tsx` keeps collection and date popovers inside the containing
  Radix dialog's focus scope. Use it for any additional portalled controls.
- `app/ui-theme.css` defines light/dark shadcn and ReUI tokens and the app's surface
  aliases. Keep these aliases when extending the theme; charts use them too.
- `components/toast.tsx` adapts the app's toast API to Sonner, including durations
  and actions.

Install additional components from `services/frontend` with the shadcn CLI, for
example `pnpm dlx shadcn@latest add @reui/badge`. Review overwrite prompts: installed
components are local source and may contain app-specific integration changes.
Do not overwrite an existing shared component without migrating its consumers.

Use `pnpm lint`, `pnpm exec tsc --noEmit`, and `pnpm build` after changing shared
controls. Also exercise selection, keyboard focus, and nested overlays in the
browser; a type check cannot verify these behaviors.

### Statistic cards

Use `StatCard` for page-level metrics across the dashboard, scans, repository pages, and admin views. It owns the single surface, padding, label/value typography, optional icon/hint, and semantic tone. Use `onPress` for navigation or filtering and `selected` for a toggled filter; do not restyle a `Button` or `Card` to create another metric design. Use `StatCardSkeleton` while loading. Legacy `variant` values remain source-compatible and share the same appearance. Metric grids use `gap-3`; only the column count changes with the page layout.
