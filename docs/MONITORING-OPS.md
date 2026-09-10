# Monitoring & Operations Guide

This document describes the monitoring and observability setup for Bowin Tournament OS.

**VPS-First Philosophy:** Cameron prefers self-hosted, VPS-capable solutions over third-party SaaS. Use **Uptime Kuma** (monitoring) and **GlitchTip** (error tracking) on the Ashbi VPS instead of UptimeRobot or Sentry SaaS. Both are optional — the app works without them, but they improve production visibility.

## Health Check Endpoints

### `/api/health/ready` — Readiness Probe

**Purpose:** Verify the application is ready to serve traffic (database connected, critical services available).

**Returns:**
```json
{
  "status": "ok",
  "db": "ok"
}
```

**Status codes:**
- `200 OK` — Application is ready
- `503 Service Unavailable` — Database connection failed or other critical service is unavailable

**Usage with Uptime Kuma (recommended, self-hosted):**
1. Install Uptime Kuma on the Ashbi VPS: `docker run -d -p 3001:3001 -v uptime-kuma:/app/data --name uptime-kuma louislam/uptime-kuma:1`
2. Create a new HTTP(s) monitor in the Uptime Kuma dashboard
3. Set the URL to: `https://your-domain.com/api/health/ready`
4. Set the monitoring interval (recommended: 5 minutes)
5. Configure alert contacts (email, Slack, Discord, Telegram, etc.)
6. Set keyword monitoring (optional): Look for `"status":"ok"` in response body
7. Set expected status code: `200`

**Alternative (third-party SaaS):** If you prefer not to self-host, UptimeRobot works the same way

**Example curl:**
```bash
curl -f https://tkd.ashbi.ca/api/health/ready
# Returns 200 with {"status":"ok","db":"ok"} when healthy
# Returns 503 when database is unavailable
```

---

## Monitoring Recommendations (VPS-First)

Use **Uptime Kuma** (self-hosted uptime monitoring) and **GlitchTip** (self-hosted Sentry-compatible error tracking) on the Ashbi VPS. Both are optional but recommended for production visibility.

### Critical Alerts (immediate attention required)

1. **Readiness Failures**
   - Alert: `/api/health/ready` returns non-200 status
   - Action: Check database connectivity, review server logs
   - Frequency: Check every 5 minutes
   - Tool: Uptime Kuma (self-hosted) or UptimeRobot (SaaS)

2. **5xx Error Rate**
   - Alert: More than 5% of requests return 5xx status codes
   - Action: Review application logs, check GlitchTip for error details
   - Metric source: GlitchTip (self-hosted), Sentry (SaaS), application logs, or reverse proxy metrics

3. **Database Connection Pool Exhaustion**
   - Alert: Prisma connection pool is exhausted
   - Action: Check for slow queries, increase pool size, or scale horizontally
   - Metric source: Application logs (Prisma warnings)

4. **Magic Link Delivery Failures**
   - Alert: Mailgun webhooks report bounces or delivery failures
   - Action: Check Mailgun logs, verify DNS records (SPF, DKIM)
   - Metric source: Mailgun dashboard

### Warning Alerts (investigate within 1 hour)

1. **Slow Response Times**
   - Alert: P95 response time > 2 seconds
   - Action: Review slow query logs, check database indexes
   - Metric source: Application metrics (`/api/internal/metrics`)

2. **High Memory Usage**
   - Alert: Server memory usage > 85%
   - Action: Check for memory leaks, review connection pool settings
   - Metric source: Server metrics (Docker stats, htop)

3. **Abnormal Traffic Patterns**
   - Alert: Unusual spike in registration attempts or auth failures
   - Action: Check for bot attacks, review rate limiter logs
   - Metric source: Application logs, rate limiter events

---

## Uptime Kuma Configuration Examples (Recommended, Self-Hosted)

### Installation on Ashbi VPS
```bash
# Run Uptime Kuma as a Docker container
docker run -d \
  --name uptime-kuma \
  -p 3001:3001 \
  -v uptime-kuma:/app/data \
  --restart unless-stopped \
  louislam/uptime-kuma:1

# Access at http://your-vps-ip:3001 and configure reverse proxy (Caddy) if needed
```

### Basic Readiness Monitor
```
Monitor Type: HTTP(s)
URL: https://tkd.ashbi.ca/api/health/ready
Heartbeat Interval: 300 seconds (5 minutes)
Monitor Timeout: 30 seconds
Notification: Email, Slack, Discord, Telegram, etc.
Keyword: "status":"ok" (optional)
Expected Status Code: 200
```

### Public Registration Page Monitor
```
Monitor Type: HTTP(s)
URL: https://tkd.ashbi.ca/register/[tournament-id]
Heartbeat Interval: 600 seconds (10 minutes)
Monitor Timeout: 30 seconds
Notification: Email, Slack
Expected Status Code: 200
```

### Public Scoreboard Monitor
```
Monitor Type: HTTP(s)
URL: https://tkd.ashbi.ca/display/[tournament-id]
Heartbeat Interval: 600 seconds (10 minutes)
Monitor Timeout: 30 seconds
Notification: Email, Slack
Expected Status Code: 200
```

**Alternative (third-party SaaS):** If you prefer not to self-host, UptimeRobot configuration is identical (just different UI)

---

## Error Tracking with GlitchTip (Recommended, Self-Hosted)

**GlitchTip** is a self-hosted, Sentry-compatible error tracking platform. It uses the same SDK (`@sentry/node` and `@sentry/react`) and environment variables as Sentry SaaS, so switching is zero-code-change. The VPS deployment uses a self-hosted GlitchTip instance (real DSN is VPS-env-only, never committed to git).

### Installation on Ashbi VPS
```bash
# GlitchTip Docker Compose setup (simplified)
# Full setup: https://glitchtip.com/documentation/install

docker run -d \
  --name glitchtip \
  -e DATABASE_URL=postgresql://user:pass@db:5432/glitchtip \
  -e SECRET_KEY=$(openssl rand -hex 32) \
  -e PORT=8000 \
  -e EMAIL_URL=smtp://mailgun:key@smtp.mailgun.org:587 \
  -p 8000:8000 \
  --restart unless-stopped \
  glitchtip/glitchtip:latest

# Access at http://your-vps-ip:8000 and configure reverse proxy (Caddy) if needed
# Create a project and copy the DSN
```

### Server Setup
Set these environment variables (same format as Sentry):
```bash
# For GlitchTip (self-hosted):
SENTRY_DSN=https://00000000-0000-0000-0000-000000000002@glitchtip.example.test/2
SENTRY_ENVIRONMENT=production

# For Sentry.io (SaaS alternative):
SENTRY_DSN=https://<key>@o0.ingest.sentry.io/<project-id>
SENTRY_ENVIRONMENT=production
```

### Client Setup
Set these at build time (same format as Sentry):
```bash
# For GlitchTip (self-hosted):
VITE_SENTRY_DSN=https://00000000-0000-0000-0000-000000000002@glitchtip.example.test/2
VITE_SENTRY_ENVIRONMENT=production

# For Sentry.io (SaaS alternative):
VITE_SENTRY_DSN=https://<key>@o0.ingest.sentry.io/<project-id>
VITE_SENTRY_ENVIRONMENT=production
```

**NEVER commit the real DSN to git.** Set these only in the deployment environment (e.g., `.env` on the VPS, Coolify secrets, or environment variables).

**The existing Sentry SDK in the codebase is fully compatible with GlitchTip.** Just point the DSN at your GlitchTip instance instead of sentry.io.

### What Gets Captured
- Uncaught exceptions (server + client)
- Unhandled promise rejections
- React component errors (via ErrorBoundary)
- Express request context (user, route, HTTP details)
- Breadcrumbs (user actions, API calls, console logs)
- Performance monitoring (10% sample rate in production)

### Recommended Alerts
Configure these in your GlitchTip or Sentry dashboard:

1. **Critical:** New issue affecting > 10 users
2. **Critical:** Issue spike (> 2x baseline in 1 hour)
3. **Warning:** Issue regression (previously resolved issue returns)

### GlitchTip vs Sentry.io
Both use the same SDK (`@sentry/node` and `@sentry/react`), so switching between them only requires changing the DSN URL. GlitchTip is fully open-source and can be self-hosted for free, while Sentry.io is a paid SaaS service with more advanced features.

**Alternative (third-party SaaS):** If you prefer not to self-host, Sentry SaaS works the same way (just point the DSN at sentry.io)

---

## Application Metrics

The application exposes Prometheus-compatible metrics at `/api/internal/metrics` (requires `Authorization: Bearer <METRICS_TOKEN>`).

### Available Metrics
- HTTP request counts (by route, method, status code)
- HTTP request durations (P50, P95, P99)
- Database connection pool stats (via Prisma)
- Custom business metrics (registrations, brackets generated, matches scored)

### Grafana Dashboard (optional)
If using Prometheus + Grafana:
1. Configure Prometheus to scrape `/api/internal/metrics`
2. Import the Bowin dashboard template (if available)
3. Set up alerts for high error rates, slow queries, etc.

---

## Incident Response Checklist

### Database Connection Failures
1. Verify PostgreSQL is running: `sudo systemctl status postgresql` (or Docker container status)
2. Check database logs for errors
3. Test connection manually: `psql -U taekwondo -d taekwondo_tournament`
4. Restart application server if connection pool is exhausted
5. Review `DATABASE_URL` in `.env` for typos

### Email Delivery Issues
1. Check Mailgun dashboard for bounce/failure events
2. Verify DNS records (SPF, DKIM, MX) are correct
3. Test Mailgun connection: `curl -X POST https://api.mailgun.net/v3/your-domain/messages ...`
4. Review application logs for email service errors
5. Confirm `MAILGUN_API_KEY` and `MAILGUN_DOMAIN` are set correctly

### High Error Rates (5xx)
1. Check GlitchTip for recent errors
2. Review application logs: `docker logs taekwondo-tournament`
3. Check database connectivity
4. Verify disk space: `df -h`
5. Check memory usage: `free -h`
6. Restart application if necessary

### Slow Performance
1. Check database query performance in application logs
2. Review Prisma query logs (if enabled)
3. Check for missing indexes in slow query logs
4. Monitor server resources (CPU, memory, disk I/O)
5. Review recent code changes for performance regressions

---

## Log Aggregation (optional)

For centralized logging, consider:
- **Loki** (lightweight, Grafana-native)
- **ELK Stack** (Elasticsearch, Logstash, Kibana)
- **Papertrail** (SaaS)

Configure Docker to send logs:
```bash
docker run --log-driver=syslog --log-opt syslog-address=tcp://logs.example.com:514 ...
```

---

## Backup & Recovery Monitoring

See `docs/BACKUP-RECOVERY.md` for detailed backup procedures.

**Backup Monitoring Checklist:**
- [ ] Daily backups are created automatically
- [ ] Backups are stored off-host (S3, rsync to remote)
- [ ] Weekly backup restore drill is performed
- [ ] Backup alerts fire if backup job fails
- [ ] Backup retention policy is enforced (e.g., keep 30 days)

---

## Contact Information

**On-call Engineer:** [Name, email, phone]  
**Incident Channel:** [Slack channel or email list]  
**Escalation:** [Secondary contact for critical incidents]

---

## References

- [Uptime Kuma](https://github.com/louislam/uptime-kuma) — Self-hosted uptime monitoring (recommended)
- [GlitchTip Documentation](https://glitchtip.com/documentation) — Self-hosted Sentry-compatible error tracking (recommended)
- [Sentry Documentation](https://docs.sentry.io/) — Third-party SaaS alternative
- [Sentry SDK for Node.js](https://docs.sentry.io/platforms/node/)
- [Sentry SDK for React](https://docs.sentry.io/platforms/javascript/guides/react/)
- [UptimeRobot Documentation](https://uptimerobot.com/kb/) — Third-party SaaS alternative
- [Prometheus Metrics](https://prometheus.io/docs/concepts/metric_types/)
- [Mailgun Webhooks](https://documentation.mailgun.com/en/latest/api-webhooks.html)
