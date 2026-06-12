# Deploy guide

Two deploy targets coexist in this repo. Pick the one that matches your environment.

## Option A: Vercel (web client only)

**What ships:** the Vite SPA in `dist/`. The Express API server is NOT deployed via Vercel in this configuration.

**Why this exists:** Cam ran the client on Vercel for fast iteration during the front-end refactor. The server stayed on a separate host (now Option B).

**Sequence (git push → live URL):**

1. `git push origin main` from your local clone.
2. GitHub Actions runs `.github/workflows/ci.yml` (build-only, no deploy).
3. Vercel detects the push via its GitHub integration and runs `npm run build:client` (per `vercel.json`).
4. Vercel serves the static `dist/` at the project domain.

**Env vars (Vercel project settings):**

- `DATABASE_URL` — required for any Vercel-served route that calls the API. Note: the API itself is NOT served by Vercel in this config, so client-side fetches go cross-origin to the Coolify host.
- `ALLOWED_ORIGINS` — comma-separated list including the Vercel domain (e.g. `https://splash.ashbi.ca`).

**Limitations:**

- API requests from the Vercel-hosted client cross to the Coolify host. CORS is required and `ALLOWED_ORIGINS` must include the Vercel domain.
- The dev proxy `/api → localhost:3001` does not work in production. Client code must use absolute URLs or rely on the same-origin gateway.
- No server-side rendering.

## Option B: Coolify + self-hosted Caddy (full stack)

**What ships:** the Express API (port 3001) + Vite client built to `dist/`, served by the same Node process. Postgres linked from Coolify.

**Sequence (git push → live URL):**

1. `git push origin main`.
2. CI verifies the build (no deploy, see `ci.yml`).
3. Cam or a designated operator runs the deploy from the Coolify UI (or the project-specific deploy hook — see `/opt/projects/splashtown-app/deploy.sh` on the VPS).
4. Coolify pulls the new image, recreates the container with env vars from its linked Postgres service + custom env, and Traefik/Caddy routes `splash.ashbi.ca → container:3001`.

**Env vars (Coolify container env):**

- `DATABASE_URL` — auto-injected from the linked Postgres service.
- `JWT_SECRET` — required. Generate with `openssl rand -base64 48`. Set in Coolify's env block.
- `STAFF_SECRET`, `OWNER_PASSWORD`, `MANAGER_PASSWORD`, `GATE_PASSWORD` — staff auth secrets.
- `FROM_EMAIL`, `MAILGUN_API_KEY`, `MAILGUN_DOMAIN` — outbound email (currently mailgun, see `src/server/services/email.ts`).
- `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` — payments.
- `NODE_ENV=production`, `PORT=3001` (or whatever Coolify expects).

**Persistent data:**

- `/app/data/` inside the container is mounted as the `splashtown-data` Docker volume. All SQLite-backed state (users, registrations, divisions, etc.) lives here.
- The volume is `splashtown-app_splashtown-data` (Coolify prefixes the project slug).

**Port + reverse proxy:**

- Container listens on 3001 (per `src/server/index.ts` `PORT || 3001`).
- Traefik (in Coolify's default network) or the host Caddy routes `splash.ashbi.ca → container:3001`.
- Dev proxy: `vite.config.ts` maps `/api → localhost:3001`.

## GitHub Secrets (CI workflow + future Coolify hook)

- `COOLIFY_HOST` — the VPS IP/hostname for the deploy SSH target.
- `COOLIFY_SSH_KEY` — private key for SSH deploys.
- `STRIPE_*`, `MAILGUN_*`, `JWT_SECRET` — also needed by Coolify; CI doesn't deploy so these are not strictly required in GitHub Secrets, but if you wire `ci.yml` to deploy later they'll need to be set there too.

## Local dev

`npm run dev` boots concurrently: Vite (5173, IPv6-only — use `http://localhost:5173`) + Express (3001). The Vite proxy at `vite.config.ts` maps `/api → localhost:3001` so the client can call the API via the same origin in dev. For dev you need:

- `DATABASE_URL` pointing to a Postgres (any local Docker container works — see `docker-compose.yml` if/when added).
- `JWT_SECRET` exported in the shell (or in a `.env` at project root with a dotenv loader).

## CI status (as of 2026-06-11)

- `.github/workflows/ci.yml` is **build-only** (lint + build). No secrets required.
- A future deploy workflow would need: `COOLIFY_HOST`, `COOLIFY_SSH_KEY`, plus a deploy script. See `/opt/projects/splashtown-app/deploy.sh` for the canonical sequence.

## Decision log

- 2026-06-07: Vercel was used for client-only deploy during the front-end refactor.
- 2026-06-08 onwards: Moved to Coolify self-hosted for full-stack single-origin. The Vercel project is still configured but not currently the production path.
- 2026-06-11: This doc written to clarify the current state after a year of mixed signals in `CLAUDE.md` and `WORKFLOWS.md`.
