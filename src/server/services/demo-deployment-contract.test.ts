import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildShowcaseFixture } from '../../../prisma/demo-seed.js';

const root = resolve(import.meta.dirname, '../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('demo showcase deployment contract', () => {
  it('builds and ships a production reset command without development dependencies', () => {
    const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const dockerfile = read('Dockerfile');

    expect(packageJson.scripts['demo:reset:production']).toBe('node dist-demo/prisma/demo-seed.js');
    expect(dockerfile).toContain('npx tsc -p tsconfig.demo.json');
    expect(dockerfile).toContain('/app/dist-demo ./dist-demo');
  });

  it('provides an isolated staging release with backup and rollback gates', () => {
    const staging = read('scripts/deploy-staging.sh');

    expect(staging).toContain('git status --porcelain');
    expect(staging).toContain('git archive HEAD');
    expect(staging).toContain('docker save');
    expect(staging).toContain('ARCHIVE_SHA256');
    expect(staging).toContain('org.opencontainers.image.revision');
    expect(staging).toContain('pg_dump');
    expect(staging).toContain('pg_restore --list');
    expect(staging).toContain('restore_database');
    expect(staging).toContain('bowin-staging-pgdata');
    expect(staging).toContain('bowin-staging-db:5432/bowin_staging\\?*');
    expect(staging).toContain('PREVIOUS_IMAGE_ID');
    expect(staging).toContain('--name bowin-staging-candidate');
    expect(staging).toContain('DEMO_ISOLATED_DATA=1');
    expect(staging).toContain('npm run demo:reset:production');
    expect(staging.indexOf('npm run demo:reset:production')).toBeLessThan(
      staging.indexOf('-p 127.0.0.1:18302:3001'),
    );
    expect(staging).toContain('bowin-staging-rollback');
    expect(staging).toContain('restore_previous_release');
    expect(staging).toContain('STAGING_URL=https://staging-tkd.ashbi.ca');
    expect(staging).toContain('$STAGING_URL/api/health/ready');
    expect(staging).toContain('http://127.0.0.1:18302/api/health/ready');
    const openTournament = buildShowcaseFixture().tournaments.find((tournament) => tournament.status === 'registration')!;
    expect(staging).toContain(openTournament.publicSlug!);
    expect(staging).toContain(openTournament.name);
  });

  it('documents and forwards both production demo safety gates', () => {
    const example = read('.env.example');
    const compose = read('docker-compose.yml');
    const deploy = read('scripts/deploy-to-vps.sh');

    expect(example).toContain('DEMO_ISOLATED_DATA=');
    expect(example).toContain('DEMO_RATE_LIMIT_MAX=');
    expect(compose).toContain('DEMO_ISOLATED_DATA=${DEMO_ISOLATED_DATA:-}');
    expect(compose).toContain('DEMO_RATE_LIMIT_MAX=${DEMO_RATE_LIMIT_MAX:-30}');
    expect(deploy).toContain('DEMO_ISOLATED_DATA=1');
    expect(deploy).toContain('DEMO_RATE_LIMIT_MAX=30');
    expect(deploy).toContain('npm run demo:reset:production');
    expect(deploy).toMatch(/dist dist-server dist-demo prisma/);
    expect(deploy).toContain('COPY --chown=node:node dist-demo ./dist-demo');
    expect(deploy).not.toContain('COPY --chown=node:node .env ./.env');
    expect(deploy).toContain('--name taekwondo-tournament-candidate');
    expect(deploy).toContain('taekwondo-tournament-rollback');
    expect(deploy.indexOf('npm run demo:reset:production')).toBeLessThan(
      deploy.indexOf('-p 127.0.0.1:18301:3001'),
    );
    expect(deploy).toContain('restore_previous_release');
    expect(deploy).toContain('CUTOVER_STARTED=1');
    expect(deploy).toContain('trap cleanup_on_exit EXIT');
    expect(deploy).toMatch(/release-.*openssl rand -hex 4/);
  });
});
