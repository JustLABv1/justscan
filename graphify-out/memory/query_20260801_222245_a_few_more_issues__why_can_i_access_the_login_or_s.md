---
type: "query"
date: "2026-08-01T22:22:45.936925+00:00"
question: "A few more issues: why can I access the login or signup page when I am already logged in, and why does the landing page top nav show the login button instead of the logged-in state?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["Header", "Auth()", "middlewares/auth.go", "User"]
---

# Q: A few more issues: why can I access the login or signup page when I am already logged in, and why does the landing page top nav show the login button instead of the logged-in state?

## Answer

Expanded from original query via graph vocabulary: [auth, login, register, header, identity, middleware, session, token, user, route, public, availability]. The login and register routes were allowlisted without an authenticated redirect in proxy.ts, while the landing header hard-coded the Sign in action. The fix adds an early valid-session redirect to /scans and passes the server session into the landing header, with client token synchronization.

## Outcome

- Signal: useful

## Source Nodes

- Header
- Auth()
- middlewares/auth.go
- User