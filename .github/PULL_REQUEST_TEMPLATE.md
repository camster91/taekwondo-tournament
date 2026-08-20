## Summary

<!-- One to three sentences. What changed and why. -->

## Linked issue

<!-- Use `Closes #N` to auto-close on merge, or `Refs #N` to link without closing. -->

Closes #

## Acceptance criteria mapping

<!-- For each acceptance criterion in the linked issue, list the line(s) of code
     or commit that satisfy it. This is the single most important section —
     if a reviewer can't trace criterion → change in 30 seconds, the PR is
     too vague. -->

- [ ] _acceptance criterion 1:_ `path/to/file.ts:LINE` / commit `abc1234`
- [ ] _acceptance criterion 2:_ `path/to/file.ts:LINE` / commit `abc1234`

## Tests

<!-- New tests added, existing tests updated, manual verification performed.
     Include the output of `npm test` and `npm run typecheck` for the diff. -->

- [ ] Unit tests added / updated
- [ ] E2E tests added / updated (if applicable)
- [ ] Manual verification: _describe what you ran_
- [ ] `npm run typecheck` clean
- [ ] `npm test` clean
- [ ] `npm run lint` clean

## Security / privacy / accessibility / performance / compatibility review

<!-- For each axis, one or more lines. If a criterion is genuinely N/A,
     say so explicitly. "no impact" with no reasoning is the same as
     not having reviewed. -->

- **Security:** _notes_
- **Privacy:** _notes_
- **Accessibility:** _notes_
- **Performance:** _notes_
- **Compatibility:** _notes_

## Migration / rollback notes

<!-- For schema or infra changes: how to apply, how to roll back, and
     any data-integrity implications. If N/A, say so. -->

## Out of scope

<!-- What you considered and chose not to do. Include any follow-up
     issues filed. If a reviewer is going to ask "why didn't you also
     do X?", answer it here. -->

- _X: not in scope, tracked in #N / rationale._

## Required checks

<!-- Confirm the CI gates in `.github/workflows/ci.yml` are green on
     this branch. The exact list of required checks is configured in
     Settings → Branches. -->

- [ ] Type check
- [ ] Unit tests
- [ ] Lint
- [ ] Dependency audit
- [ ] Build
- [ ] Migration smoke
- [ ] E2E
- [ ] Container smoke
- [ ] GitGuardian
- [ ] Ashbi Local CI

## Self-review

- [ ] `git diff main...HEAD` read end-to-end
- [ ] No drive-by reformatting
- [ ] No unrelated dependency bumps
- [ ] No `console.log` / `TODO` without linked issue
- [ ] No raw secrets / real tokens / production URLs
- [ ] Branch follows `agent/<issue>-<short-description>` convention
- [ ] PR title follows `type(scope): subject (#issue)`
