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
});
