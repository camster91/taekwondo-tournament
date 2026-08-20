# Contributing

This is the delivery guide for the Martial Arts Tournament Manager.
It is the source of truth for how work moves from an open issue to
a merged, deployed, accepted change. Code without a passing
acceptance-criteria check is not "done"; a closed issue without a
target-environment check is not "shipped".

> **Looking for the codebase tour, route map, or auth model?**
> See [CLAUDE.md](./CLAUDE.md) — the AI-agent codebase guide.
> This file is the human + AI contributor delivery guide.

## Table of contents

- [Repository layout](#repository-layout)
- [Issue lifecycle](#issue-lifecycle)
- [Branching](#branching)
- [Commits](#commits)
- [Pull requests](#pull-requests)
- [Local environment](#local-environment)
- [CI gates](#ci-gates)
- [Required PR sections](#required-pr-sections)
- [Review checklist](#review-checklist)
- [Merging](#merging)
- [Closing the issue](#closing-the-issue)
- [Emergency break-glass](#emergency-break-glass)

## Repository layout

```
/
├── src/                  the actual app — no `app/` directory
│   ├── client/           React 19 SPA
│   ├── server/           Express + Prisma
│   └── shared/           cross-cut constants
├── prisma/               schema.prisma is the source of truth
├── tests/e2e/            Playwright
├── .github/workflows/    CI + build + deploy
├── docs/                 audits, deployment notes
├── scripts/              ops scripts
├── CLAUDE.md             codebase guide (read this first)
├── AGENTS.md             operational / env notes
├── CONTRIBUTING.md       this file
├── CHANGELOG.md          per-release notes
├── README.md             public-facing product intro
└── package.json          scripts: dev, test, build, db:push, lint, typecheck
```

## Issue lifecycle

1. **Open.** Anyone with read access can open an issue. The
   `audit`, `bug`, `enhancement`, `documentation`, `deployment`
   labels are the canonical taxonomy. The priority prefix in the
   title (`[P0]` / `[P1]` / `[P2]` / `[Decision]`) is the
   release-pressure signal.
2. **Triaged.** The first reviewer adds the missing
   acceptance-criteria checklist if the issue is missing one,
   links any related issues, and assigns a wave per the [UX
   roadmap issue #151](https://github.com/camster91/taekwondo-tournament/issues/151).
3. **Claimed.** A contributor replies on the issue with "I'll
   take this" and references the branch they will open.
4. **PR open.** The contributor opens a **draft** PR
   referencing the issue (`Closes #N` or `Refs #N`).
5. **Acceptance.** A maintainer reviews, requests changes,
   approves, and the contributor marks the PR ready for review.
6. **Merged.** Squash-merged to `main`. The merge commit's
   `gh pr merge` body captures the linked issue.
7. **Closed.** After target-environment acceptance, the issue
   is closed. **The issue stays open until the change is live
   in the target environment** — merging is not acceptance.

## Branching

```
agent/<issue-number>-<short-kebab-description>
```

Examples:

- `agent/118-replace-guessable-registration-creds`
- `agent/19-ci-gates-and-coverage`
- `agent/15-release-records-and-delivery-workflow`

Rules:

- **One independently reviewable slice per branch.** Don't lump
  "fix the bracket editor and add Stripe" into one branch. If a
  PR is hard to review, split it.
- **No direct pushes to `main`.** `main` is protected; only
  squash-merge from a reviewed PR is allowed.
- **Rebase before review.** Pull the latest `main` into your
  branch and rebase. The diff in the PR should be the diff
  reviewed, not 3 weeks of stale history.
- **Branch names are immutable** once a PR is open. If you
  need to rewrite history (e.g., to remove a leaked secret or
  a noise commit), force-push with `--force-with-lease` and
  leave a comment on the PR explaining the reason.

## Commits

- Use [Conventional Commits](https://www.conventionalcommits.org/):
  `type(scope): subject` where `type` is one of
  `feat` / `fix` / `refactor` / `test` / `docs` / `chore` /
  `ci` / `perf` / `revert`.
- Subject line ≤ 72 characters, present tense, no trailing
  period.
- Body explains **why**, not what (the diff shows what).
- Reference the issue number in the footer: `Closes #118.` or
  `Refs #118.`
- One logical change per commit. If two ideas are tangled,
  split into two commits.

## Pull requests

Draft PRs are the default. A PR is "ready for review" only
when:

1. The PR template is fully filled in.
2. All required CI checks are green.
3. The acceptance criteria on the linked issue are addressed.
4. The diff has been self-reviewed by the author (run
   `git diff main...HEAD` and read it end-to-end).

### PR title

`type(scope): subject (#issue)` — e.g.
`fix(auth): add expiry + revocation to management tokens (#118)`.

### Required PR sections

The PR template at `.github/PULL_REQUEST_TEMPLATE.md` enforces
these. Filling each in is mandatory.

- **Linked issue.** `Closes #N` or `Refs #N`.
- **Summary.** What changed and why, in 1-3 sentences.
- **Acceptance criteria mapping.** For each acceptance criterion
  on the linked issue, the line(s) of code or commit that
  satisfies it. This is the single most important section —
  if a reviewer can't trace criterion → change in 30 seconds,
  the PR is too vague.
- **Tests.** New tests added, existing tests updated, manual
  verification performed.
- **Security / privacy / accessibility / performance /
  compatibility review.** One or more lines, even if
  "no impact." If a criterion is genuinely N/A, say so
  explicitly.
- **Migration / rollback notes.** For schema or infra
  changes: how to apply, how to roll back, and any data-
  integrity implications.
- **Out of scope.** What you considered and chose not to do,
  including any follow-up issues filed.

## Local environment

See [AGENTS.md](./AGENTS.md) for the exact commands. The
short version:

```bash
npm install            # postinstall runs prisma generate
npm run db:push        # idempotent schema sync
npm run dev            # Vite :5173 + Express :3001
```

Quick verification before opening a PR:

```bash
npm run typecheck      # both server and client tsc, must be clean
npm test               # vitest unit suite
npm run lint           # eslint src
npm run build          # vite build + tsc -p tsconfig.server.json
```

Database-touching work additionally requires:

```bash
npm run db:push        # schema sync on a fresh DB
npx prisma db push --skip-generate  # in CI / smoke tests
```

E2E work:

```bash
npm run test:e2e:install   # one-time, ~150MB browser download
npm run test:e2e           # boots its own dev server, needs Postgres
```

## CI gates

The CI workflow lives at `.github/workflows/ci.yml`. Each PR
runs the following checks (in order):

| Check | What it does |
| --- | --- |
| Type check | `tsc` for server and client, blocking |
| Unit tests | `vitest` (no DB needed) |
| Lint | `eslint src` |
| Dependency audit | `npm audit --audit-level=high` |
| Build | `vite build` + server `tsc` |
| Migration smoke | `prisma db push --skip-generate` against a fresh Postgres |
| E2E (chromium / firefox / webkit) | full Playwright suite |
| Container smoke | builds the Dockerfile, starts it, hits `/api/health/ready` |
| Ashbi Local CI | local-CI mirror run on a self-hosted runner |
| GitGuardian | secret scan (with `.gitguardian.yaml` ignore list) |
| Build and Push Image | publishes the image to `ghcr.io` on `main` |

Branch protection on `main` requires all the above checks to
be green before merge. The exact list of required checks is
configured in Settings → Branches (a repo-admin action — see
[the PR for #19](https://github.com/camster91/taekwondo-tournament/pull/177)
for the recommended configuration).

## Review checklist

A reviewer is responsible for verifying each of these in the
diff:

- [ ] Linked issue is referenced and the PR's stated
  acceptance-criteria mapping is accurate.
- [ ] Diff is the minimum necessary change. No drive-by
  reformatting, no unrelated dependency bumps, no
  "while-I-was-here" tweaks.
- [ ] Tests cover the new behavior. Negative cases too
  (expired, malformed, revoked, replay, cross-registration,
  generic error, etc., where applicable).
- [ ] No new dependency without a justification in the PR
  body.
- [ ] No `console.log`, no `TODO` without a linked issue, no
  commented-out code.
- [ ] No raw secrets, no real tokens, no production URLs.
- [ ] Migration path is documented and reversible.
- [ ] Breaking changes are called out in the PR title
  (`feat!:` / `fix!:`) and the issue.

## Merging

- **Squash merge** to `main`. The PR title becomes the merge
  commit subject.
- The merge body is auto-populated with the linked issue
  references; keep them.
- Delete the source branch after merge.

## Closing the issue

An issue is closed when:

1. The PR is merged to `main`.
2. The change is **live in the target environment** (staging
   for pre-1.0, production for post-1.0).
3. The acceptance criteria have been re-verified against the
   live environment.
4. The CHANGELOG has been updated for the release that
   contains the change.

If the change is **not** in the target environment, the issue
stays open with a comment linking to the merged PR and a
note that target-environment acceptance is pending.

## Emergency break-glass

For a confirmed production incident requiring a same-day fix
when a full PR cycle is impractical:

1. Open a `hotfix/<short-description>` branch from `main`.
2. The PR must include a `## Hotfix` section in the body
   describing the incident, the rollback plan, and the
   post-incident review date.
3. The PR must have at least one approval from a maintainer
   (no solo merge).
4. The fix must be followed by a same-PR test that proves
   the regression doesn't reoccur.
5. The post-incident review is filed as a follow-up issue
   within 48 hours.

Hotfixes are auditable. The "I forgot to open a PR" path is
not a hotfix — it is a bypass and must be reconciled in the
post-incident review.

## Questions?

- Codebase tour, route map, DB schema: [CLAUDE.md](./CLAUDE.md)
- Local environment, runner quirks: [AGENTS.md](./AGENTS.md)
- Release roadmap and wave order: [issue #151](https://github.com/camster91/taekwondo-tournament/issues/151)
- Open issues: [issue list](https://github.com/camster91/taekwondo-tournament/issues)
