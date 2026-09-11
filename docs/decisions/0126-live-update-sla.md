# Decision 0126: Live-update freshness SLA and delivery architecture

> GitHub: camster91/taekwondo-tournament#126
> Status: Accepted (with SH-6 in production).
> Date: 2026-09-10

## Context

Live bracket updates are a headline feature. The user expectation (per the pilot design and venue rehearsal) is that when a judge taps "submit score", the bracket on a different device updates "immediately" — sub-second end-to-end.

## Decision

**SLA: <500ms p95 end-to-end (judge submit → bracket update visible on a different device in the same venue). Delivery via WebSocket with cross-instance fan-out via Postgres `LISTEN`/`NOTIFY` (per SH-6 commit `7469358`).**

The 500ms budget decomposes as:
- Server-side write + commit: ~50ms (Postgres + audit log)
- Cross-instance `NOTIFY`: ~5-20ms (Postgres network within a region)
- Client-side render: ~50-200ms (React re-render of the bracket panel)

## Trade-offs

- WebSocket adds infrastructure complexity (a dedicated long-lived Postgres client per server instance for `LISTEN`). This is acceptable because Postgres is already in the stack.
- Global sub-second (across continents) would require edge compute or a CDN-orchestrated WebSocket. Out of scope for v1.
- The 500ms SLA is a per-venue p95. Under load (e.g. multiple divisions ending simultaneously), the tail can grow. We do not promise a sub-second SLA in those conditions.

## Rationale

WebSocket is the right abstraction for live updates. SH-6 made it work across instances with no new infra. Sub-second is sufficient for the use case (judge → display in the same venue). Global sub-second is a v2 problem.

## Implications

- The SLO dashboard tracks `ws_publish_to_subscribe_p95_ms`.
- An alert fires if p95 exceeds 1000ms over 5 minutes.
- The Sentry tag `live_update_latency_ms` is on every bracket update event.
- The public landing page advertises the SLA.

## Action items

- [ ] Add the SLO metric and dashboard panel.
- [ ] Add the Sentry tag.
- [ ] Document the SLA on the landing page.
- [ ] Quarterly review: if the p95 drifts above 500ms, investigate the decomposition (server / network / client).

## Related

- #128 (a11y, including live region announcements for live updates)
- SH-6 (committed in `7469358`)
