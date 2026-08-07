# Bowin third-party license inventory

**Source:** committed `package-lock.json`, inspected 2026-08-07

This is an engineering inventory for legal review, not a legal opinion. Counts include platform-specific and development packages recorded in the lockfile.

| SPDX/license value | Locked packages |
|---|---:|
| MIT | 509 |
| Apache-2.0 | 45 |
| ISC | 44 |
| MPL-2.0 | 12 |
| BSD-3-Clause | 10 |
| BSD-2-Clause | 10 |
| BlueOak-1.0.0 | 4 |
| MIT-0 | 2 |
| 0BSD | 2 |
| Unlicense | 2 |
| Other compound/single values | 7 |
| Missing package metadata | 1 |

The one missing `package.json` license field is `seq-queue@0.0.5`, brought in through `mysql2`/Prisma. Its installed `LICENSE` file contains the MIT License and a 2012 Netease/pomelo copyright notice. Preserve that notice in any generated attribution bundle.

Items requiring explicit legal/attribution review include:

- `elkjs@0.11.1` — EPL-2.0
- `lightningcss` and locked platform builds — MPL-2.0
- `caniuse-lite` — CC-BY-4.0
- packages using compound license expressions or separate license files

Before distribution, generate a production-image bill of materials and attribution file from the exact immutable image digest, then have the legal operator confirm that the chosen Bowin license and delivery model satisfy all notice/source obligations.
