#!/usr/bin/env node
/**
 * Seed script: creates a demo tournament with admin, then bulk-imports
 * the 1,248-competitor Newton's 2025 dataset.
 *
 * Usage: node scripts/seed-newton-2025.mjs [baseUrl]
 *   Default baseUrl: http://localhost:3001
 */

import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:3001';

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok && !opts.expectError) {
    throw new Error(`API ${res.status} ${path}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return { status: res.status, data };
}

async function setupAdmin() {
  console.log('=== 1. Setup admin ===');
  const status = await api('/api/auth/setup-status');
  console.log('  setup-status:', status.data);

  if (status.data.setupComplete) {
    console.log('  Admin already exists. Skipping setup.');
    return null;
  }

  const res = await api('/api/auth/setup', {
    method: 'POST',
    body: JSON.stringify({
      email: 'admin@newton2025.demo',
      password: 'Demo-Admin-2025!',
      firstName: 'Newton',
      lastName: 'Admin',
    }),
  });
  console.log('  Admin created:', res.data.email);
  return res.data;
}

async function loginAsAdmin() {
  const res = await api('/api/auth/request-magic-link', {
    method: 'POST',
    body: JSON.stringify({ email: 'admin@newton2025.demo' }),
    expectError: true,
  });
  console.log('  Magic link requested (offline mode: will need password login)');

  // Try password login via /api/auth/setup-admin (no — that's only first time)
  // Use a workaround: get the JWT from setup if this is first login
  // Better path: use direct prisma via docker exec
  return null;
}

async function getAdminToken() {
  // The setup endpoint returns a token on first-time setup
  const status = await api('/api/auth/setup-status');
  if (!status.data.setupComplete) {
    // Run setup first
    const res = await api('/api/auth/setup', {
      method: 'POST',
      body: JSON.stringify({
        email: 'admin@newton2025.demo',
        password: 'Demo-Admin-2025!',
        firstName: 'Newton',
        lastName: 'Admin',
      }),
    });
    return res.data.token;
  }
  // Already set up — we'd need a password login route
  console.log('  (admin already exists; use a previously-issued token)');
  return process.env.ADMIN_TOKEN || null;
}

async function createTournament(token) {
  console.log('\n=== 2. Create demo tournament ===');
  const date = '2025-09-15T09:00:00Z';
  const res = await api('/api/tournaments', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: "Newton's Championship 2025 (Demo)",
      date,
      location: 'Newton TKD Academy, Hamilton ON',
      sportProfileSlug: 'taekwondo',
    }),
  });
  console.log('  Tournament:', res.data.name, 'id=', res.data.id);
  return res.data;
}

async function bulkRegister(token, tournamentId, competitors) {
  console.log(`\n=== 3. Bulk-register ${competitors.length} competitors ===`);
  // POST in batches of 50
  const batchSize = 50;
  let ok = 0, err = 0;
  for (let i = 0; i < competitors.length; i += batchSize) {
    const batch = competitors.slice(i, i + batchSize);
    const res = await api(`/api/tournaments/${tournamentId}/registrations/bulk`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ registrations: batch }),
    });
    ok += res.data.created || 0;
    err += res.data.errors || 0;
    if (i % 200 === 0) {
      console.log(`  ...${i + batch.length}/${competitors.length} (created=${ok}, errors=${err})`);
    }
  }
  console.log(`  Done: created=${ok}, errors=${err}`);
}

async function generateDivisions(token, tournamentId) {
  console.log('\n=== 4. Auto-generate divisions ===');
  const res = await api(`/api/divisions/tournament/${tournamentId}/auto-generate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
  });
  console.log('  Divisions:', res.data.divisions, 'Assignments:', res.data.assignments);
  console.log('  Warnings:', (res.data.warnings || []).slice(0, 5).join(' | '));
}

async function main() {
  console.log(`Seeding ${BASE}`);
  const token = await getAdminToken();
  if (!token) {
    console.error('No admin token available. Either fresh-install (will create one) or set ADMIN_TOKEN env.');
    process.exit(1);
  }
  console.log('  token len:', token.length);

  const tournament = await createTournament(token);

  // Load competitors
  const competitors = JSON.parse(fs.readFileSync('/tmp/newton_2025_competitors.json', 'utf8'));
  await bulkRegister(token, tournament.id, competitors);
  await generateDivisions(token, tournament.id);

  console.log('\n=== Done ===');
  console.log(`Tournament ID: ${tournament.id}`);
  console.log(`View at: ${BASE}/tournaments/${tournament.id}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
