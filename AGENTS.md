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
- `services/frontend/app/`: Next.js routes, layouts, and page-level screens
- `services/frontend/components/`: reusable UI and app shell components
- `services/frontend/components/ui/`: shared frontend primitives and wrappers
- `docs/superpowers/specs/`: product and implementation design documents

## Working Style

- Start from the smallest relevant surface: the route, handler, component, test, or migration that directly controls the requested behavior.
- Follow existing naming, folder, and data-flow conventions before introducing new abstractions.
- Fix root causes when the local code path is clear, but avoid unrelated refactors.
- Preserve user changes already present in the worktree unless explicitly asked to modify them.
- Prefer focused validation after each substantive change: a narrow test, lint run, typecheck, or behavior-specific check.

## Frontend Rules

- Use HeroUI components from `@heroui/react` wherever possible.
- Prefer existing shared wrappers in `services/frontend/components/ui/` before creating new primitives.
- Do not introduce raw custom replacements for common UI controls such as buttons, inputs, modals, selects, alerts, tabs, cards, drawers, or dropdowns when a HeroUI component already fits.
- Keep new UI consistent with the existing App Router structure and shared shell components in `services/frontend/components/`.
- When a page already uses HeroUI, extend that approach instead of mixing in a competing component library.
- For controlled HeroUI single-selects in this repo, use `value` and `onChange` rather than `selectedKey` and `onSelectionChange`.
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

- Update README or nearby docs when behavior, setup, configuration, or operator-facing flows change.
- Put substantial feature or redesign specs in `docs/superpowers/specs/`.
- Keep AGENT-facing guidance concrete and repo-specific; avoid generic advice that does not help with JustScan.