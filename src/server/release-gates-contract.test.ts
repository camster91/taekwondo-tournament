import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), 'utf8');

// Pins the fail-closed release gates from #119 and the schema drift gate
// from #292 so they cannot be quietly weakened.
describe('release gates contract', () => {
  it('publishes images only after CI passes on main, with immutable tags', () => {
    const workflow = read('.github/workflows/build-and-push.yml');
    expect(workflow).toMatch(/workflow_run:\s*\n\s*workflows: \['CI Build'\]/);
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(workflow).toContain("github.event.workflow_run.event == 'push'");
    expect(workflow).toContain('ref: ${{ env.SOURCE_SHA }}');
    expect(workflow).not.toMatch(/branches: \[main, master\]/);
    expect(workflow).not.toMatch(/:latest\s*$/m);
    expect(workflow).not.toMatch(/^\s*pull_request/m);
    // One publish per commit: a newer main run must not cancel an older
    // commit's publish (workflow_run always reports github.ref = main).
    expect(workflow).toContain('group: build-${{ github.ref }}-${{ github.event.workflow_run.head_sha || github.sha }}');
    expect(workflow).not.toContain('/tmp/.buildx-cache-new');
  });

  it('refuses production deploys of commits that are not on main or lack a green Build', () => {
    const deploy = read('scripts', 'deploy-production.sh');
    const preflight = deploy.indexOf('git merge-base --is-ancestor "$RELEASE_SHA" origin/main');
    const upload = deploy.indexOf('Uploading immutable source archive');
    expect(preflight).toBeGreaterThan(-1);
    expect(preflight).toBeLessThan(upload);
    expect(deploy).toContain('check_name=Build');
    expect(deploy).toContain('Refusing to deploy ${RELEASE_SHA}: CI Build check is');
    expect(deploy).toContain('"ci_verification": "${CI_VERIFICATION}"');
    expect(deploy).toContain('"previous_revision"');
  });

  it('fails the fresh-migration test on schema drift instead of warning', () => {
    const script = read('scripts', 'test-fresh-migration.sh');
    expect(script).toContain('prisma migrate diff');
    expect(script).toContain('--exit-code');
    expect(script).not.toContain('Possible schema drift detected');
    expect(script).toMatch(/DRIFT_STATUS} -eq 2[\s\S]*exit 3/);
  });

  it('boots the production image in CI before anything can deploy it', () => {
    const ci = read('.github/workflows', 'ci.yml');
    expect(ci).toContain('run: ./scripts/container-smoke.sh');
    const smoke = read('scripts', 'container-smoke.sh');
    expect(smoke).toContain("docker inspect -f '{{.State.Health.Status}}'");
    expect(smoke).toContain('/api/health/ready');
    expect(smoke).toContain('fail "/api/health revision');
  });

  // Each VPS deploy script rebuilds the container env from an allowlist of
  // the previous container's variables; a runtime var missing from it is
  // silently dropped on the next deploy.
  it('forwards every runtime variable from .env.example through each deploy allowlist', () => {
    const example = read('.env.example');
    const documented = new Set([...example.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
    // Not forwarded on purpose: build-time client vars, image-fixed values,
    // dev/test-only switches, the one-shot reset attestation, and keys the
    // scripts inject themselves.
    const notForwarded = new Set([
      'NODE_ENV', 'PORT', 'DEMO_RESET_CONFIRM', 'ENABLE_DEV_AUTH', 'ENABLE_E2E_AUTH_BYPASS',
      'RATE_LIMIT_DISABLED', 'STRIPE_WEBHOOK_TRUST_EVENT_PAYLOAD', 'OFFLINE_CAPABILITY_PRIVATE_KEY_BASE64',
    ]);
    const runtime = [...documented].filter((name) => !name.startsWith('VITE_') && !notForwarded.has(name));
    expect(runtime).toEqual(expect.arrayContaining([
      'RETENTION_PURGE_DRY_RUN', 'SOFT_DELETE_RETENTION_DAYS', 'SENTRY_DSN', 'SENTRY_ENVIRONMENT',
      'STRIPE_PER_EVENT_SMALL_PRICE_ID', 'STRIPE_PER_EVENT_MEDIUM_PRICE_ID', 'STRIPE_PER_EVENT_LARGE_PRICE_ID',
      'LOGO_STORAGE_PATH',
    ]));
    // Staging pins its own origin/demo settings after filtering.
    const pinnedByStaging = new Set(['PUBLIC_APP_URL', 'ALLOWED_ORIGINS', 'ENABLE_DEMO_LOGIN', 'DEMO_ISOLATED_DATA', 'DEMO_RATE_LIMIT_MAX']);
    for (const script of ['deploy-production.sh', 'deploy-staging.sh', 'deploy-demo.sh']) {
      const source = read('scripts', script);
      const match = source.match(/ALLOWED_ENV='\^\(([^)]*)\)='/);
      expect(match, script).not.toBeNull();
      const allowed = new Set(match![1].split('|'));
      const missing = runtime.filter((name) => !allowed.has(name)
        && !(script === 'deploy-staging.sh' && pinnedByStaging.has(name)));
      expect(missing, `${script} drops runtime vars`).toEqual([]);
    }
  });

  it('builds every client VITE_* variable into the image', () => {
    const dockerfile = read('Dockerfile');
    const builder = dockerfile.slice(0, dockerfile.indexOf('RUN ./node_modules/.bin/prisma generate'));
    const example = read('.env.example');
    const viteVars = [...new Set([...example.matchAll(/^(VITE_[A-Z0-9_]+)=/gm)].map((m) => m[1]))];
    expect(viteVars.length).toBeGreaterThan(5);
    for (const name of viteVars) {
      expect(builder, name).toContain(`ARG ${name}`);
      expect(builder, name).toContain(`${name}=\${${name}}`);
    }
  });

  it('keeps uploaded logos on persistent, node-writable storage', () => {
    const dockerfile = read('Dockerfile');
    expect(dockerfile).toContain('chown -R node:node /app/data');
    expect(dockerfile).toContain('VOLUME ["/app/data"]');
    expect(dockerfile.indexOf('VOLUME ["/app/data"]')).toBeLessThan(dockerfile.indexOf('USER node'));
    expect(read('docker-compose.yml')).toContain('app_data:/app/data');
    for (const script of ['deploy-production.sh', 'deploy-staging.sh', 'deploy-demo.sh']) {
      const source = read('scripts', script);
      const runs = source.match(/docker run -d(?:[^\n]*\\\n)*[^\n]*/g) ?? [];
      expect(runs.length, script).toBeGreaterThanOrEqual(2);
      for (const run of runs) expect(run, script).toMatch(/-v "?\$\{DATA_VOLUME\}:\/app\/data"?|-v bowin-staging-data:\/app\/data/);
    }
  });
});
