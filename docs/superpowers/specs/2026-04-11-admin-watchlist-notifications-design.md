# Admin UX, Watchlist Scheduling, and Notifications Design

## Goal

Modernize the admin experience, fix watchlist scheduling so it executes at the intended local time, and expand notifications so administrators can route more specific events to more destinations.

This design covers three related areas that already converge in the existing admin surface:

- Admin information architecture and interaction density
- Watchlist scheduling correctness and time presentation
- Notification routing, filtering, and channel support

The design is intentionally additive. It preserves the current route layout, API structure, and database model style where possible, and focuses on changes that can be shipped incrementally without destabilizing unrelated product areas.

## Current State

### Admin

The admin experience is concentrated in [services/frontend/app/(app)/admin/page.tsx](/Volumes/Storage/projects/justlab/justscan/services/frontend/app/(app)/admin/page.tsx). It is functional, but the overview uses oversized summary cards and the table actions rely on multiple inline buttons that create visual noise. The current code also centralizes all tabs in one client file, which makes redesign work harder to isolate.

### Watchlist

The watchlist feature spans [services/frontend/app/(app)/watchlist/page.tsx](/Volumes/Storage/projects/justlab/justscan/services/frontend/app/(app)/watchlist/page.tsx), [services/backend/handlers/watchlist/watchlist.go](/Volumes/Storage/projects/justlab/justscan/services/backend/handlers/watchlist/watchlist.go), and [services/backend/scheduler/scheduler.go](/Volumes/Storage/projects/justlab/justscan/services/backend/scheduler/scheduler.go). Watchlist items currently store only a raw cron expression. The scheduler registers that cron string directly, so execution happens in server time rather than the user’s intended local time. Invalid cron expressions are also accepted on write and can fail silently later.

### Notifications

Notifications are implemented through channel records in [services/backend/pkg/models/notifications.go](/Volumes/Storage/projects/justlab/justscan/services/backend/pkg/models/notifications.go), admin CRUD in [services/backend/handlers/admins/notifications.go](/Volumes/Storage/projects/justlab/justscan/services/backend/handlers/admins/notifications.go), and dispatch in [services/backend/notifications/notify.go](/Volumes/Storage/projects/justlab/justscan/services/backend/notifications/notify.go). Channels can subscribe to a small event set, but all routing is global. There is no organization filter, image filter, or severity threshold, and the supported contact points are limited to Discord, Email, and generic Webhook.

## Scope

### In Scope

- Full admin refresh across the existing admin tabs
- Denser overview presentation and improved table actions
- Dropdown-based row actions and better select affordances with icons
- Per-watchlist-item timezone storage and scheduling
- Watchlist cron and timezone validation on create and update
- Watchlist schedule display with explicit timezone context
- 12-hour and 24-hour display support in the frontend
- Notification filters for event, organization, image pattern, and minimum severity
- Additional contact point types: Slack, Microsoft Teams, Telegram
- Retention of the existing Email channel type
- Delivery logging behavior preserved for new notification flows

### Out of Scope

- A user-level notification preferences center
- A new expression language for notification rules
- A general user profile preferences system for timezone or hour-cycle
- A complete replacement of the current admin route structure
- A new frontend table framework

## Requirements

### Admin UX Requirements

1. The overview should stop relying on large single-purpose cards as the main layout primitive.
2. Table row actions should move to compact dropdown menus instead of multiple always-visible icon buttons.
3. Select inputs used in admin filters and forms should feel more intentional and should include icons where that improves scanning.
4. The redesign should preserve current admin workflows and API behavior.
5. The visual changes should reuse the project’s existing HeroUI and Tailwind-based patterns instead of introducing a parallel admin-only design system.

### Watchlist Requirements

1. Each watchlist item must store the timezone used to interpret its cron schedule.
2. Existing watchlist items must remain valid after migration.
3. Create and update operations must reject invalid cron expressions and invalid timezone identifiers.
4. Scheduled execution must happen according to the configured timezone for that item.
5. The UI must make the schedule’s timezone visible.
6. The UI must support both 12-hour and 24-hour time presentation.

### Notification Requirements

1. Channels must be able to subscribe to more than the current global event set.
2. Channels must be able to filter by organization, image pattern, and minimum severity.
3. The system must continue to support manual test sends.
4. Slack, Microsoft Teams, and Telegram must be first-class channel types.
5. Existing Discord, Webhook, and Email channels must continue to work.
6. Delivery logs must remain consistent across all channel types.

## Design Options Considered

### Option A: Additive Extension of Existing Models

This approach extends the current admin page, watchlist model, and notification channel model in place. It keeps the current routes and adds new fields to the existing persistence structures.

Pros:

- Lowest migration cost
- Preserves current frontend and backend boundaries
- Minimizes API churn
- Fastest path to shipping

Cons:

- Requires discipline to keep [services/frontend/app/(app)/admin/page.tsx](/Volumes/Storage/projects/justlab/justscan/services/frontend/app/(app)/admin/page.tsx) from getting harder to maintain
- Notification filters remain channel-centric rather than becoming a generalized rule engine

### Option B: New Notification Subscription Subsystem and Admin Rewrite

This approach introduces dedicated notification subscription records and performs a larger admin refactor at the same time.

Pros:

- Cleaner long-term model for notification ownership and subscriptions
- Better separation of admin view concerns

Cons:

- Much larger schema and API change
- Higher regression risk
- Slower delivery

### Recommendation

Choose Option A. The requested functionality fits cleanly into the current architecture, and there is no evidence that a larger rewrite is necessary to solve the actual problems. Where files are already too large, refactor locally while implementing the change rather than introducing a broader system redesign.

## Proposed Design

### 1. Admin UX

The admin route structure remains unchanged. [services/frontend/app/(app)/admin/layout.tsx](/Volumes/Storage/projects/justlab/justscan/services/frontend/app/(app)/admin/layout.tsx) continues to guard access, and [services/frontend/app/(app)/admin/page.tsx](/Volumes/Storage/projects/justlab/justscan/services/frontend/app/(app)/admin/page.tsx) remains the entry point.

The redesign changes the presentation and internal composition:

- Replace the large overview card grid with a denser summary layout built from compact metric blocks, grouped operational snapshots, and concise action panels.
- Standardize admin tables on a shared compact row treatment with consistent padding, status chips, and an action dropdown per row.
- Reuse the project’s existing HeroUI dropdown pattern already visible in [services/frontend/app/(app)/scans/[id]/page.tsx](/Volumes/Storage/projects/justlab/justscan/services/frontend/app/(app)/scans/[id]/page.tsx) and [services/frontend/app/(app)/registries/page.tsx](/Volumes/Storage/projects/justlab/justscan/services/frontend/app/(app)/registries/page.tsx).
- Improve admin selects by pairing the trigger with context icons and clearer affordances while keeping the current HeroUI Select implementation.

To make this practical, the monolithic admin page should be split into tab-focused components or local modules during implementation. Data loading can stay page-owned initially, but presentation logic should move out of the central file as each tab is touched.

### 2. Watchlist Scheduling

The watchlist data model in [services/backend/pkg/models/watchlist.go](/Volumes/Storage/projects/justlab/justscan/services/backend/pkg/models/watchlist.go) gains a `timezone` field containing an IANA zone identifier such as `Europe/Berlin` or `America/New_York`.

Create and update handlers in [services/backend/handlers/watchlist/watchlist.go](/Volumes/Storage/projects/justlab/justscan/services/backend/handlers/watchlist/watchlist.go) validate:

- Cron expression syntax
- Timezone validity via Go time location loading

If validation fails, the request returns a 400-level error with a clear message. This removes the current silent failure path.

The scheduler in [services/backend/scheduler/scheduler.go](/Volumes/Storage/projects/justlab/justscan/services/backend/scheduler/scheduler.go) continues using `robfig/cron`, but each scheduled item is registered with a timezone-aware spec by prefixing the stored cron expression with `CRON_TZ=<zone>`. This preserves a human-editable cron string while fixing execution semantics.

The implementation should also address the current operational gap where schedules are loaded only at startup. Create, update, delete, and enable-state changes should trigger rescheduling so users do not need a backend restart for changes to take effect.

On the frontend, [services/frontend/app/(app)/watchlist/page.tsx](/Volumes/Storage/projects/justlab/justscan/services/frontend/app/(app)/watchlist/page.tsx) gains timezone selection and better schedule help text. [services/frontend/lib/cron.ts](/Volumes/Storage/projects/justlab/justscan/services/frontend/lib/cron.ts) should render a schedule preview that includes the chosen timezone, and [services/frontend/lib/time.ts](/Volumes/Storage/projects/justlab/justscan/services/frontend/lib/time.ts) should expose formatting helpers that can present timestamps in either 12-hour or 24-hour style.

The hour-cycle decision stays frontend-only in this pass. The UI should derive a sensible default from browser locale and optionally allow a page-local override where useful.

### 3. Notification Filters and Contact Points

The current `NotificationChannel` model in [services/backend/pkg/models/notifications.go](/Volumes/Storage/projects/justlab/justscan/services/backend/pkg/models/notifications.go) is extended instead of replaced.

The model gains additive filter fields:

- Selected organization IDs
- Image patterns
- Minimum severity threshold
- Expanded event subscriptions

These can be stored using the existing Bun and JSONB patterns already used elsewhere in the codebase. This preserves the simple channel-centric CRUD flow already exposed through [services/backend/router/admin.go](/Volumes/Storage/projects/justlab/justscan/services/backend/router/admin.go) and [services/backend/handlers/admins/notifications.go](/Volumes/Storage/projects/justlab/justscan/services/backend/handlers/admins/notifications.go).

Dispatch in [services/backend/notifications/notify.go](/Volumes/Storage/projects/justlab/justscan/services/backend/notifications/notify.go) is enriched so filtering can happen before sending. The payload needs enough scan context to determine:

- Which organization or organizations are associated with the scan
- Which image name and tag were scanned
- The severity profile of the result

The already-defined `compliance_failed` event should also be emitted from the relevant compliance flow so it becomes usable in practice.

New channel types are introduced as follows:

- Slack: webhook-backed message sender with Slack-specific payload format
- Microsoft Teams: webhook-backed card-style payload format
- Telegram: bot token plus chat ID configuration

Email remains the existing mail-based channel. A separate “Mail” type is not introduced because it would duplicate current behavior.

The admin notifications UI should expose these filters and channel-specific config fields without changing the current CRUD shape. Existing channels continue to load and save successfully with default-empty filters.

## Data Model Changes

### Watchlist

Add `timezone TEXT NOT NULL DEFAULT 'UTC'` to `watchlist_items`.

This preserves existing rows and keeps legacy behavior explicit after migration.

### Notifications

Extend `notification_channels` with additional filter columns or JSONB-backed fields consistent with the current model style. The preferred shape is:

- `events` remains the list of subscribed event names
- `org_ids` as a JSONB string list of UUIDs
- `image_patterns` as a JSONB string list
- `min_severity` as nullable text

This keeps filtering explicit and queryable without inventing a new rules DSL.

## API Changes

### Watchlist API

The watchlist request and response payloads gain a `timezone` field.

Create and update operations return validation errors when:

- The cron expression is malformed
- The timezone is invalid

### Notification API

Notification channel request and response payloads gain the new filter fields and new `type` values for Slack, Teams, and Telegram.

No route shape changes are required in this pass.

## Error Handling

### Watchlist

- Invalid cron or timezone returns a 400 response with a clear validation message.
- Scheduling failures should be logged and should not prevent unrelated jobs from running.
- Rescheduling logic should fail safely if one item is invalid, and the invalid item should surface an actionable error where possible.

### Notifications

- Unsupported channel types return validation errors on write.
- Missing channel-specific configuration returns a bad request before persistence when possible, and a delivery failure when runtime delivery still encounters a remote issue.
- Delivery logs continue to record success and failure regardless of channel type.

## Testing Strategy

### Frontend

- Lint and build the frontend.
- Manually verify the admin redesign across tabs and viewport sizes.
- Manually verify watchlist schedule preview, timezone selection, and 12-hour versus 24-hour display behavior.

### Backend

- Run the backend test suite.
- Add focused tests for watchlist validation and timezone-aware scheduling utilities.
- Add focused tests for notification filter evaluation and channel-specific payload generation where existing test patterns allow it.

### Manual QA

- Create watchlist items in at least two distinct timezones and confirm execution aligns with the intended local time.
- Update and delete watchlist items and verify changes apply without restart.
- Create notification channels for each supported type and verify event, org, image-pattern, and severity filtering.

## Rollout Strategy

1. Land watchlist schema and API changes first, because they fix a correctness bug.
2. Land the frontend watchlist updates and confirm scheduling behavior end to end.
3. Extend notification backend and UI with additive fields and new channel types.
4. Refresh the admin UI on top of the stabilized contracts, extracting shared presentation pieces where needed.

This order fixes the broken behavior first and then builds the larger UX improvements on top of stable backend contracts.

## Open Decisions Resolved

- The admin work covers the full admin area rather than only the overview.
- Watchlist timezones are stored per watchlist item.
- 12-hour and 24-hour handling is a frontend display concern in this pass.
- Notification filtering includes event, organization, image pattern, and minimum severity.
- New contact point scope includes Slack, Microsoft Teams, and Telegram, while Email remains the existing mail channel.

## Spec Self-Review

This spec avoids placeholders, keeps the scope limited to the requested product areas, and uses additive schema and API changes instead of a broader platform redesign. The largest implementation risk is scheduler resynchronization for watchlist changes; that is intentionally called out as part of the design rather than left implicit.