# JustScan Agent Guide

## Project Overview

JustScan is a self-hosted container image vulnerability scanner.

- Backend: Go with Gin-style HTTP handlers under `services/backend`
- Frontend: Next.js App Router with React 19 under `services/frontend`
- Primary scan engines: Trivy and Artifactory Xray
- Database: PostgreSQL

When working in this repository, prefer small, local changes that fit the existing backend and frontend patterns instead of broad rewrites.

## Repo Map

- `services/backend/main.go`: backend entrypoint
- `services/backend/handlers/`: HTTP handlers grouped by domain
- `services/backend/functions/`: business logic and service-layer helpers
- `services/backend/database/`: migrations and database bootstrap
- `services/backend/docs/openapi.go`: backend OpenAPI source; keep it separate from the user-facing docs site
- `services/frontend/app/`: Next.js routes, layouts, and page-level screens
- `services/frontend/components/`: reusable UI and app shell components
- `services/frontend/components/ui/`: shared frontend primitives and wrappers
- `services/docs/content/docs/`: user-facing MDX documentation and navigation metadata

## Working Style

- Start from the smallest relevant surface: the route, handler, component, test, or migration that directly controls the requested behavior.
- Follow existing naming, folder, and data-flow conventions before introducing new abstractions.
- Fix root causes when the local code path is clear, but avoid unrelated refactors.
- Preserve user changes already present in the worktree unless explicitly asked to modify them.
- Prefer focused validation after each substantive change: a narrow test, lint run, typecheck, or behavior-specific check.

## Frontend Rules

- Use the local shadcn/ui and ReUI components under `services/frontend/components/ui/`. Do not reintroduce HeroUI.
- Prefer existing shared wrappers in `services/frontend/components/ui/` before creating new primitives.
- Reuse local controls for buttons, inputs, modals, selects, alerts, tabs, cards, drawers, and dropdowns before adding another primitive.
- Keep new UI consistent with the existing App Router structure and shared shell components in `services/frontend/components/`.
- `button.tsx` and `dialog.tsx` use Radix primitives; `badge.tsx` is sourced from ReUI. React Aria supplies accessible collections, date/color controls, and form behavior through the local composition layer.
- For controlled local single-selects, use `value` and `onChange`. The ReUI registry is configured in `services/frontend/components.json`; check the existing file before installing registry components.
- Theme tokens live in `services/frontend/app/ui-theme.css`; maintain light and dark tokens together. Toasts use Sonner through `components/toast.tsx`.
- Prefer server-safe, typed data flow and minimal client boundaries; add `'use client'` only when React interactivity requires it.

## Backend Rules

- Keep HTTP concerns in handlers and push reusable logic into `functions/`, `auth/`, `authz/`, or other domain packages when appropriate.
- Keep database shape changes in ordered migrations under `services/backend/database/migrations/`.
- Match existing config patterns in `services/backend/config/` when adding new settings or environment-driven behavior.
- Avoid hidden coupling across org, auth, registry, scan, and admin flows; check authorization impact whenever modifying protected endpoints.

## Validation

Use the narrowest command that validates the slice you changed.

- Frontend dev: `cd services/frontend && pnpm dev`
- Frontend lint: `cd services/frontend && pnpm lint`
- Frontend build: `cd services/frontend && pnpm build`
- Backend dev: `cd services/backend && go run main.go`
- Backend tests: `cd services/backend && go test ./...`

If a change touches both frontend and backend contracts, validate both sides.

## Documentation

- User-facing documentation lives in `services/docs/content/docs/`; update the nearest guide and its `meta.json` navigation entry when adding a feature or changing an operator workflow.
- Update the relevant reference page when configuration, API behavior, data contracts, migration requirements, or other breaking behavior changes. Cross-link feature guides from scan, operations, and troubleshooting pages when users can encounter the feature from those paths.
- Validate documentation changes from `services/docs` with `pnpm lint`, `pnpm check:links`, `pnpm format:check`, and `pnpm build` as appropriate for the change.
- Do not create a new root `./docs` folder for user documentation. The backend `services/backend/docs` directory contains OpenAPI source and must be preserved.
- Keep AGENT-facing guidance concrete and repo-specific; avoid generic advice that does not help with JustScan.
