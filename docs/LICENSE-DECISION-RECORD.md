# Bowin software license decision record

**Status:** decision required before merge or commercial distribution

The repository currently conflicts: `LICENSE` is an unfinished MIT template and `package.json` declares ISC. Neither accurately records an intentional commercial licensing decision.

## Decision

- [ ] Proprietary commercial software (recommended for a closed-source managed SaaS)
- [ ] MIT open source
- [ ] Other license reviewed by counsel: ____________________

| Field | Approved value |
|---|---|
| Legal copyright owner | |
| Copyright year | |
| Public source distribution permitted | Yes / No |
| Customer right to copy, modify, or redistribute | |
| Third-party attribution owner | |
| Approved by | |
| Approval date | |

## Repository changes after approval

1. Replace the unfinished `LICENSE` file with the approved text.
2. Set `package.json` to the matching SPDX identifier or `UNLICENSED` for proprietary distribution.
3. Reconcile README, image/package publication, customer agreement, and source-distribution language.
4. Run the dependency-license inventory and retain the attribution report.
5. Have the legal operator approve the resulting commit before merge.

This record prepares the decision; it is not legal advice and does not select a license on the operator's behalf.
