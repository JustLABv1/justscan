# Admin Auth Metadata, Legal Surface, and OIDC Password Restrictions

## Scope

- Add admin-visible auth provenance for users.
- Track the last successful sign-in timestamp and method.
- Prevent password changes for accounts currently authenticated with OIDC.
- Add admin-only system/legal metadata showing the running frontend version and copyright.

## Backend

- Extend the `users` table with `last_login_at` and `last_login_method`.
- Record login metadata on successful local and OIDC sign-in.
- Keep `auth_type` aligned with the most recent successful authentication method.
- Reject self-service password changes when `auth_type` is `oidc`.
- Reject admin password edits for users whose current `auth_type` is `oidc`.

## Frontend

- Extend `User` and `AdminUser` API models with auth metadata fields.
- In admin users, show auth method and last sign-in details in the table and modal.
- In account settings, replace the password form with an OIDC notice when the current user signed in through OIDC.
- Add an admin overview card for system/legal details using the frontend version from `package.json`.

## Validation

- Local login updates `auth_type=local` and login metadata.
- OIDC login updates `auth_type=oidc` and login metadata.
- OIDC users cannot change passwords through the user settings endpoint.
- Admins can see auth source and last sign-in state without using audit logs.