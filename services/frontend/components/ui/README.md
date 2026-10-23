# Frontend components

The frontend owns its component source. `components.json` configures shadcn/ui
with the `radix-nova` style and the public `@reui` registry. HeroUI is no longer a
dependency.

- `button.tsx` and `dialog.tsx` provide shadcn-style Radix primitives. Prefer
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
