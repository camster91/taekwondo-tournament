# Custom Domains for Bowin Tournament OS

This document describes how to configure custom domains for organizer-branded public portals on the Ashbi VPS (PWA SaaS, VPS-first stack).

## Overview

Custom domains allow organizations to serve their public-facing event registration and scoreboard pages on their own domain (e.g., `register.myclub.com`) instead of shared Bowin URLs.

**Key features:**
- DNS-based domain verification (TXT or CNAME)
- Fail-closed security: unverified, disabled, or revoked domains return 404
- Cross-org isolation: domains are org-scoped and cannot be squatted
- Traefik edge proxy with Let's Encrypt automatic SSL
- Audit logging for all domain lifecycle events

---

## User Workflow (Organization Admin)

### 1. Attach a Custom Domain

In the Bowin app, navigate to **Organization Settings → Custom Domains** and add your domain:

```
Hostname: register.myclub.com
Verification Method: TXT (or CNAME)
```

The app will generate DNS verification instructions.

### 2. Add DNS Records

Add one of the following records to your DNS provider (e.g., Cloudflare, Route53, Namecheap):

**Option A: TXT Record** (recommended)
```
Name: _bowin-verify.register.myclub.com
Type: TXT
Value: bowin-domain-verification=<token>
TTL: 300 (or default)
```

**Option B: CNAME Record**
```
Name: register.myclub.com
Type: CNAME
Value: verify-<token>.bowin.app
TTL: 300 (or default)
```

### 3. Verify Ownership

Click **Verify** in the Bowin app. The system will check for the DNS record and mark the domain as **verified**.

### 4. Activate the Domain

Once verified, click **Activate** to start serving traffic on your custom domain.

### 5. Configure DNS for Production

After activation, update your DNS records to point to the Ashbi VPS:

**Replace the verification record with a CNAME:**
```
Name: register.myclub.com
Type: CNAME
Value: tkd.ashbi.ca
TTL: 300 (or default)
```

**Or use an A record:**
```
Name: register.myclub.com
Type: A
Value: <Ashbi VPS IP>
TTL: 300 (or default)
```

---

## VPS Operator Setup (Infra / Cameron)

### Prerequisites

- SSH access to Ashbi VPS
- DNS control for the custom domain
- Traefik edge proxy with Let's Encrypt cert resolver (already configured on VPS)

### Step 1: Verify Domain in Database

After the organization admin attaches and activates a domain, verify it in the database:

```bash
ssh user@ashbi-vps
docker exec -it markup-postgres psql -U taekwondo -d taekwondo_tournament
SELECT hostname, status, "organizationId" FROM "CustomDomain" WHERE hostname = 'register.myclub.com';
```

Expected: `status = 'active'`

### Step 2: Add Traefik Dynamic Config

Create a new dynamic config file in `/opt/traefik/dynamic/`:

```bash
sudo nano /opt/traefik/dynamic/custom-domain-register-myclub-com.yml
```

Add the following Traefik router + service configuration:

```yaml
http:
  routers:
    bowin-custom-register-myclub:
      rule: "Host(`register.myclub.com`)"
      entryPoints:
        - websecure
      service: bowin-backend
      tls:
        certResolver: letsencrypt
      middlewares:
        - compress

  services:
    bowin-backend:
      loadBalancer:
        servers:
          - url: "http://localhost:18301"

  middlewares:
    compress:
      compress: {}
```

**Important:** 
- Each custom domain must have its own router with an explicit `Host()` rule
- Use the `letsencrypt` cert resolver (pre-configured on VPS)
- Service `bowin-backend` points to the Bowin app on port 18301

### Step 3: Reload Traefik

Traefik watches the `/opt/traefik/dynamic/` directory and auto-reloads configs:

```bash
# Verify config is valid (optional)
docker exec traefik-proxy traefik healthcheck

# Traefik auto-reloads within 5-10 seconds
# Check logs if needed:
docker logs traefik-proxy --tail 50
```

Traefik will automatically request an SSL certificate from Let's Encrypt via HTTP-01 challenge.

### Step 4: Test Custom Domain

Local test (before DNS propagates):

```bash
curl -H "Host: register.myclub.com" http://localhost:18301/api/health/ready
```

Expected: `{"status":"ok","db":"ok"}`

Public test (after DNS propagates):

```bash
curl https://register.myclub.com/api/sports
```

Expected: JSON response with sport profiles.

---

## TLS/SSL Certificate Management

Traefik automatically handles SSL/TLS certificates via Let's Encrypt ACME HTTP-01 challenge.

**Requirements:**
- Domain must resolve to Ashbi VPS IP (A or CNAME record)
- Ports 80 and 443 must be open
- Traefik `letsencrypt` cert resolver configured (already set on VPS)

**Certificate storage:**
Certificates are stored in `/opt/traefik/acme.json` (persists across Traefik restarts).

**Certificate renewal:**
Traefik automatically renews certificates 30 days before expiration.

**Manual troubleshooting:**
```bash
# Check Traefik logs for ACME challenge errors
docker logs traefik-proxy | grep -i acme

# Verify cert resolver is working
docker exec traefik-proxy cat /etc/traefik/acme.json | jq '.letsencrypt.Certificates'
```

---

## Troubleshooting

### Domain verification fails

**Symptom:** "DNS record not found" error when clicking Verify.

**Fix:**
1. Check DNS propagation: `dig TXT _bowin-verify.register.myclub.com` or `dig CNAME register.myclub.com`
2. Wait 5-10 minutes for DNS propagation
3. Ensure the verification token matches exactly (case-sensitive)

### Custom domain returns 404

**Symptom:** `https://register.myclub.com` returns 404 "Domain not available".

**Fix:**
1. Verify domain status in database: `SELECT status FROM "CustomDomain" WHERE hostname = 'register.myclub.com';`
2. Expected: `status = 'active'`. If not, activate in app.
3. Check Traefik dynamic config exists: `ls -la /opt/traefik/dynamic/ | grep register.myclub.com`
4. Verify Traefik logs: `docker logs traefik-proxy --tail 50 | grep register.myclub.com`

### SSL certificate not issued

**Symptom:** `https://register.myclub.com` shows certificate error or "502 Bad Gateway".

**Fix:**
1. Check DNS A/CNAME record points to Ashbi VPS IP: `dig register.myclub.com`
2. Check Traefik logs for ACME errors: `docker logs traefik-proxy | grep -i "register.myclub.com\|acme"`
3. Verify ports 80/443 are open: `sudo netstat -tulpn | grep -E ':(80|443)'`
4. Wait 1-2 minutes for Let's Encrypt HTTP-01 challenge to complete
5. Check acme.json for cert: `docker exec traefik-proxy cat /etc/traefik/acme.json | jq '.letsencrypt.Certificates[] | select(.domain.main=="register.myclub.com")'`

---

## Security Notes

### Abuse Prevention

- **Bowin-owned domains** (bowin.app, bowin.io, ashbi.ca, localhost) are rejected
- **Cross-org squatting** is prevented: a domain can only be attached to one organization
- **Revoked domains** cannot be reactivated

### Audit Logging

All domain lifecycle events are logged to `UserAuditLog`:
- `custom_domain_attached`
- `custom_domain_verified`
- `custom_domain_activated`
- `custom_domain_disabled`
- `custom_domain_revoked`
- `custom_domain_deleted`

Query audit logs:
```sql
SELECT * FROM "UserAuditLog" WHERE action LIKE 'custom_domain_%' ORDER BY "createdAt" DESC LIMIT 50;
```

---

## Database Schema

```sql
CREATE TABLE "CustomDomain" (
    "id" TEXT PRIMARY KEY,
    "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
    "hostname" TEXT UNIQUE NOT NULL,
    "verificationMethod" TEXT NOT NULL DEFAULT 'txt',
    "verificationToken" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'pending', -- pending, verified, active, disabled, revoked
    "activatedAt" TIMESTAMP,
    "disabledAt" TIMESTAMP,
    "revokedAt" TIMESTAMP,
    "revokedReason" TEXT,
    "createdBy" TEXT,
    "verifiedBy" TEXT,
    "activatedBy" TEXT,
    "revokedBy" TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL
);

CREATE INDEX "CustomDomain_organizationId_idx" ON "CustomDomain"("organizationId");
CREATE INDEX "CustomDomain_status_idx" ON "CustomDomain"("status");
CREATE INDEX "CustomDomain_hostname_idx" ON "CustomDomain"("hostname");
```

---

## API Endpoints

### Attach Domain
```
POST /api/custom-domains/organization/:orgId/attach
Body: { hostname: string, verificationMethod?: 'txt' | 'cname' }
Auth: admin or director + org membership
```

### List Domains
```
GET /api/custom-domains/organization/:orgId
Auth: admin or director + org membership
```

### Verify Domain
```
POST /api/custom-domains/:domainId/verify
Auth: admin or director + org membership
```

### Activate Domain
```
POST /api/custom-domains/:domainId/activate
Auth: admin or director + org membership
```

### Disable Domain
```
POST /api/custom-domains/:domainId/disable
Auth: admin or director + org membership
```

### Revoke Domain
```
POST /api/custom-domains/:domainId/revoke
Body: { reason: string }
Auth: admin or director + org membership
```

### Delete Domain
```
DELETE /api/custom-domains/:domainId
Auth: admin only (pending/disabled domains only)
```

---

## Migration Notes

**Migration file:** `prisma/migrations/20260910_add_custom_domains/migration.sql`

**Deployment:**
```bash
# On VPS
docker exec -it taekwondo-tournament npx prisma migrate deploy
```

**Rollback:**
```sql
DROP TABLE "CustomDomain";
```

---

## Stack Notes (Ashbi VPS)

**Architecture:**
- **Edge proxy:** Traefik (NOT Caddy, NOT Coolify)
- **App server:** Bowin Node.js on port 18301
- **TLS:** Let's Encrypt via Traefik ACME HTTP-01
- **Dynamic config:** `/opt/traefik/dynamic/*.yml` (file provider)
- **Product stack:** PWA SaaS, VPS-first

**DO NOT document Coolify** — it is disabled on this VPS.

---

## Future Enhancements

1. **Automatic CNAME setup** via DNS provider APIs (Cloudflare, Route53)
2. **Multi-domain support** per organization (primary + aliases)
3. **Custom domain analytics** (traffic by domain)
4. **Subdomain wildcards** (e.g., `*.events.myclub.com`)
5. **Traefik dynamic config automation** (app writes YAML on domain activation)

---

## Support

For issues or questions, contact Cameron or file a support ticket in the Bowin app.
