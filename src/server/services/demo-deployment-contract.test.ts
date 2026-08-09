import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

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
