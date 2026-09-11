# Decision 0148: Notifications, help, support, and user-facing service status

> GitHub: camster91/taekwondo-tournament#148
> Status: Accepted (with v1 scoped as below).
> Date: 2026-09-10

## Context

Pilot users need a way to get help. They need to know the system status. The product cannot be a black box.

## Decision (v1)

| Channel | Provider | SLA |
|---|---|---|
| In-app help | `docs/help/` articles | Always available |
| Email support | support@bowin.app (Google Workspace) | First response 1 business day |
| Status page | status.bowin.app (GitHub Pages, public) | Always available |
| In-app status indicator | Tied to the status page | Real-time |
| In-product feedback | `?` button → feedback form → Bowin inbox | Acknowledged within 1 week |
| Notifications | Email only (in v1) | Configurable per event type |
| SMS / push | Out of scope for v1 | n/a |
| Phone support | Out of scope for v1 | n/a |

## Trade-offs

- Multiple channels; operational overhead.
- Email support is fine for v1 but does not scale beyond ~50 concurrent tenants.
- v2 may need an in-app chat (Intercom or similar) and a ticketing system.

## Rationale

Standard for SaaS at the pilot stage. Email support is the lowest-friction option that gives users a real response. The status page (GitHub Pages) is free and reliable. The in-app help articles reduce support load.

## Implications

- The `support@` and `status@` need to be set up (Cameron, #165).
- The in-app help articles need to be written.
- The status page is a simple GitHub Pages site with a YAML file as the source of truth.
- The in-product `?` button needs to be added (a new feature; tracked in v2 backlog).
- Notification preferences per user are a v2 feature (tracked in backlog).

## Action items

- [ ] Set up `support@` and `status@` (Cameron, #165).
- [ ] Write the v1 help articles (10–20 articles covering the main user journeys).
- [ ] Build the status page (GitHub Pages).
- [ ] Add the `?` button in v2.
- [ ] Add notification preferences in v2.

## Related

- #165 (production monitoring and on-call, Cameron-gated)
