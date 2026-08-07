# Bowin pilot support and incident plan

**Status:** template; contacts and response commitments must be accepted before a customer pilot.

## Ownership

| Role | Named owner | Verified contact | Backup |
|---|---|---|---|
| Customer tournament director | [NAME] | [PHONE/EMAIL] | [NAME] |
| Bowin on-call operator | [NAME] | [PHONE/EMAIL] | [NAME] |
| Infrastructure/database | [NAME] | [PHONE/EMAIL] | [NAME] |
| Privacy/security incident | [NAME] | [PHONE/EMAIL] | [NAME] |
| Venue network/hardware | [NAME] | [PHONE/EMAIL] | [NAME] |

## Proposed pilot severity model

| Severity | Examples | Target acknowledgement | Action |
|---|---|---|---|
| SEV-1 | Cross-tenant exposure, suspected breach, scoring/bracket corruption, database unavailable, multiple rings unable to operate | 15 minutes during staffed pilot | Stop affected operation, preserve evidence, invoke fallback/rollback, notify decision-makers |
| SEV-2 | One critical workflow or ring blocked without safe workaround, email authentication broadly failing | 30 minutes during staffed pilot | Contain, provide workaround, decide rollback within 30 minutes |
| SEV-3 | Degraded non-critical feature, isolated recoverable error | 4 staffed hours | Record, workaround, schedule fix |
| SEV-4 | Cosmetic issue or feature request | 2 business days | Triage into backlog |

These are proposed pilot targets, not an SLA, until included in a signed order.

## Event controls

- Freeze application changes 72 hours before the event except an approved emergency fix.
- Capture an encrypted database backup before import, categorization, bracket generation, and event start; verify readability and keep the previous application image.
- Print/export brackets, registration/check-in lists, ring assignments and emergency contacts.
- Maintain charged devices, power, a cellular hotspot and the venue network owner contact.
- Use one incident channel and timestamp every report, decision, correction, deployment and recovery step.
- Never send tokens, secrets, full DOBs, weights, accommodation notes or incident narratives through an unsecured support channel.

## Immediate response

1. Assign incident commander and severity; start the log.
2. Protect participant safety and switch to the approved manual fallback when operational uncertainty could affect matches.
3. Preserve current database/application state and relevant minimized logs.
4. Contain access or traffic; revoke public links/accounts/tokens if relevant.
5. Choose continue, workaround, application rollback, or database restoration using the runbook.
6. Validate tenant counts, representative brackets, latest accepted results and public visibility before resuming.
7. Notify affected parties under the approved legal/contract process.
8. Complete a retrospective with cause, impact, timeline, corrective actions and owners.
