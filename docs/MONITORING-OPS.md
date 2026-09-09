# Monitoring & Operations Guide

This document describes the monitoring and observability setup for Bowin Tournament OS.

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

**Usage with UptimeRobot:**
1. Create a new HTTP(s) monitor in UptimeRobot
2. Set the URL to: `https://your-domain.com/api/health/ready`
3. Set the monitoring interval (recommended: 5 minutes)
4. Configure alert contacts (email, Slack, etc.)
5. Set keyword monitoring (optional): Look for `"status":"ok"` in response body
6. Set expected status code: `200`

**Example curl:**
```bash
curl -f https://tkd.ashbi.ca/api/health/ready
# Returns 200 with {"status":"ok","db":"ok"} when healthy
# Returns 503 when database is unavailable
```

---

## Monitoring Recommendations

### Critical Alerts (immediate attention required)

1. **Readiness Failures**
   - Alert: `/api/health/ready` returns non-200 status
   - Action: Check database connectivity, review server logs
   - Frequency: Check every 5 minutes

2. **5xx Error Rate**
   - Alert: More than 5% of requests return 5xx status codes
   - Action: Review application logs, check Sentry for error details
   - Metric source: Sentry, application logs, or reverse proxy metrics

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

## UptimeRobot Configuration Examples

### Basic Readiness Monitor
```
Monitor Type: HTTP(s)
URL: https://tkd.ashbi.ca/api/health/ready
Monitoring Interval: 5 minutes
Monitor Timeout: 30 seconds
Alert Contacts: [Your email/Slack]
Keyword: "status":"ok" (optional)
Status Code: 200
```

### Public Registration Page Monitor
```
Monitor Type: HTTP(s)
URL: https://tkd.ashbi.ca/register/[tournament-id]
Monitoring Interval: 10 minutes
Monitor Timeout: 30 seconds
Alert Contacts: [Your email/Slack]
Status Code: 200
```

### Public Scoreboard Monitor
```
Monitor Type: HTTP(s)
URL: https://tkd.ashbi.ca/display/[tournament-id]
Monitoring Interval: 10 minutes
Monitor Timeout: 30 seconds
Alert Contacts: [Your email/Slack]
Status Code: 200
```

---

## Error Tracking with Sentry

Sentry is integrated for server-side and client-side error tracking. Configuration:

### Server Setup
Set these environment variables:
```bash
SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id
SENTRY_ENVIRONMENT=production
```

### Client Setup
Set these at build time:
```bash
VITE_SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id
VITE_SENTRY_ENVIRONMENT=production
```

### What Sentry Captures
- Uncaught exceptions (server + client)
- Unhandled promise rejections
- React component errors (via ErrorBoundary)
- Express request context (user, route, HTTP details)
- Breadcrumbs (user actions, API calls, console logs)
- Performance monitoring (10% sample rate in production)

### Sentry Alerts (recommended)
1. **Critical:** New issue affecting > 10 users
2. **Critical:** Issue spike (> 2x baseline in 1 hour)
3. **Warning:** Issue regression (previously resolved issue returns)

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
1. Check Sentry for recent errors
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

- [Sentry Documentation](https://docs.sentry.io/)
- [UptimeRobot Documentation](https://uptimerobot.com/kb/)
- [Prometheus Metrics](https://prometheus.io/docs/concepts/metric_types/)
- [Mailgun Webhooks](https://documentation.mailgun.com/en/latest/api-webhooks.html)
