// Bundle manifest + budget gate for the production build.
//
// Run after `npm run build` to:
//   1. Walk dist/assets/*.js and capture raw / gzip / brotli sizes.
//   2. Write dist/bundle-manifest.json (machine-readable) and
//      docs/bundle-sizes.md (human-readable).
//   3. Enforce the per-chunk budget — exit non-zero if any chunk
//      exceeds its gzipped budget, or if the initial entry
//      (everything NOT a lazy export route) blows past its
//      initial-entry budget.
//
// "Lazy export route" chunks are tagged in vite.config.ts as
// their own files: xlsx, jspdf, html2canvas. Everything else is
// part of the initial paint of the SPA.
//
// This is a Node script (no TS) because it runs in CI before
// the dev toolchain finishes. It uses Node's built-in zlib
// (gzip + brotli) so there's nothing extra to install.

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { join, basename } from 'node:path';

const DIST_ASSETS = 'dist/assets';
const MANIFEST_OUT = 'dist/bundle-manifest.json';
const DOC_OUT = 'docs/bundle-sizes.md';

// "Initial entry" = the JS that the browser requests on the
// first paint of the SPA shell. In this repo that's exactly
// two chunks: the main entry `index-*.js` and Vite/Rollup's
// auto-generated vendor `index.es-*.js`. Every other chunk is
// either a per-route lazy load (loaded on navigation) or a
// per-feature lazy load (xlsx / jspdf / html2canvas / purify /
// useQuery / sport-profiles — loaded on first use). So the
// initial-entry budget is the SUM of those two chunks only.
const INITIAL_CHUNK_RE = /^index(\.|$)/;
const isInitial = (chunk) => INITIAL_CHUNK_RE.test(chunk);

// Per-chunk gzipped budgets. Numbers are slightly above the
// current baseline so the build is stable in CI; raise these
// as the actual sizes drop. Names match the chunk stem Vite
// emits (e.g. `index`, `xlsx`, `Divisions`).
const PER_CHUNK_BUDGETS_GZ = {
  // Initial entry
  index: 110_000, // main app — currently 97 kB gz
  'index.es': 65_000, // vendor — currently 53 kB gz
  // Per-route lazy chunks (each route page). Each loads only
  // when the user navigates there. 80 kB gz catches a chunk
  // that suddenly doubles.
  route: 80_000,
  // Per-feature lazy chunks (downloaded only on export / print).
  // Generous because they only load on explicit user action.
  xlsx: 200_000,
  'jspdf.es.min': 160_000,
  'html2canvas.esm': 60_000,
  'purify.es': 15_000,
  useQuery: 12_000,
  'sport-profiles': 5_000,
};

const INITIAL_ENTRY_BUDGET_RAW = 600_000; // 600 kB raw
const INITIAL_ENTRY_BUDGET_GZ = 180_000; // 180 kB gz

/**
 * @typedef {Object} ChunkInfo
 * @property {string} file
 * @property {string} chunk
 * @property {number} raw
 * @property {number} gzip
 * @property {number} brotli
 * @property {boolean} lazy
 * @property {boolean} initial
 */

async function readChunkSizes() {
  if (!existsSync(DIST_ASSETS)) {
    throw new Error(
      `dist/assets not found. Run \`npm run build\` first; this script reads the production build output.`,
    );
  }
  const files = await readdir(DIST_ASSETS);
  const js = files.filter((f) => f.endsWith('.js'));

  /** @type {ChunkInfo[]} */
  const out = [];
  for (const f of js) {
    const buf = await readFile(join(DIST_ASSETS, f));
    const raw = buf.length;
    const gzip = gzipSync(buf, { level: 9 }).length;
    const brotli = brotliCompressSync(buf).length;
    // Chunk name is the file name without the content hash.
    // Vite emits files as `<chunk>-<8char-hash>.js`. Strip the
    // hash so the manifest keys map to our manualChunks names.
    const stem = basename(f, '.js');
    // Vite/Rollup default content hash is a short alphanumeric
    // token (NOT strictly hex — can include [a-zA-Z0-9_-]). Strip
    // a single trailing `-<hash>` segment.
    const chunk = stem.replace(/-[\w-]{8}$/, '');
    const lazy = !isInitial(chunk);
    out.push({ file: f, chunk, raw, gzip, brotli, lazy, initial: !lazy });
  }
  // Sort: initial first, then by size desc.
  out.sort((a, b) => {
    if (a.lazy !== b.lazy) return a.lazy ? 1 : -1;
    return b.gzip - a.gzip;
  });
  return out;
}

function checkBudgets(chunks) {
  const failures = [];
  for (const c of chunks) {
    // Per-chunk budget: lookup by chunk name. Routes that don't
    // match a named budget fall back to the per-route ceiling.
    const budget = PER_CHUNK_BUDGETS_GZ[c.chunk] ?? PER_CHUNK_BUDGETS_GZ.route;
    if (budget && c.gzip > budget) {
      failures.push(
        `  ✗ ${c.file}: gzipped ${c.gzip.toLocaleString()}B exceeds ${c.chunk} budget ${budget.toLocaleString()}B`,
      );
    }
  }
  // Initial-entry total: ONLY the index + index.es chunks.
  const initial = chunks.filter((c) => c.initial);
  const initialRaw = initial.reduce((s, c) => s + c.raw, 0);
  const initialGz = initial.reduce((s, c) => s + c.gzip, 0);
  if (initialRaw > INITIAL_ENTRY_BUDGET_RAW) {
    failures.push(
      `  ✗ Initial entry total raw ${initialRaw.toLocaleString()}B exceeds budget ${INITIAL_ENTRY_BUDGET_RAW.toLocaleString()}B`,
    );
  }
  if (initialGz > INITIAL_ENTRY_BUDGET_GZ) {
    failures.push(
      `  ✗ Initial entry total gzipped ${initialGz.toLocaleString()}B exceeds budget ${INITIAL_ENTRY_BUDGET_GZ.toLocaleString()}B`,
    );
  }
  return { failures, initialRaw, initialGz, initial };
}

function formatMarkdown(chunks, initialRaw, initialGz) {
  const lines = [];
  lines.push('# Bundle sizes');
  lines.push('');
  lines.push(
    'Auto-generated by `scripts/bundle-manifest.mjs` after every `npm run build`. Do not edit by hand — re-run the script to refresh. The CI workflow `.github/workflows/ci.yml` runs the same script and fails the build if any chunk exceeds its budget or the initial-entry total is over the cap.',
  );
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Initial entry: **${(initialRaw / 1024).toFixed(1)} kB raw** / **${(initialGz / 1024).toFixed(1)} kB gzipped** across ${chunks.filter((c) => c.initial).length} chunks (budget: 600 kB raw / 180 kB gz)`);
  lines.push(`- Lazy chunks: ${chunks.filter((c) => !c.initial).length} (downloaded on navigation / first feature use)`);
  lines.push('');
  lines.push('## Per-chunk');
  lines.push('');
  lines.push('| File | Chunk | Raw (kB) | gzip (kB) | brotli (kB) | Initial? |');
  lines.push('|---|---|---:|---:|---:|:-:|');
  for (const c of chunks) {
    lines.push(
      `| \`${c.file}\` | \`${c.chunk}\` | ${(c.raw / 1024).toFixed(1)} | ${(c.gzip / 1024).toFixed(1)} | ${(c.brotli / 1024).toFixed(1)} | ${c.initial ? 'yes' : 'no'} |`,
    );
  }
  lines.push('');
  lines.push('## How to update');
  lines.push('');
  lines.push('1. Run `npm run build`.');
  lines.push('2. Run `node scripts/bundle-manifest.mjs`.');
  lines.push('3. Inspect `dist/stats.html` (after `ANALYZE=1 npm run build`) for the treemap.');
  lines.push('4. If a new chunk is intentionally larger, raise its budget in `scripts/bundle-manifest.mjs` *and* add a note in `CHANGELOG.md` so the next reviewer knows why.');
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const chunks = await readChunkSizes();
  const { failures, initialRaw, initialGz } = checkBudgets(chunks);
  const manifest = {
    generatedAt: new Date().toISOString(),
    initialEntry: {
      raw: initialRaw,
      gzip: initialGz,
      budget: { raw: INITIAL_ENTRY_BUDGET_RAW, gzip: INITIAL_ENTRY_BUDGET_GZ },
    },
    chunks: chunks.map((c) => ({
      file: c.file,
      chunk: c.chunk,
      raw: c.raw,
      gzip: c.gzip,
      brotli: c.brotli,
      initial: c.initial,
    })),
  };
  await writeFile(MANIFEST_OUT, JSON.stringify(manifest, null, 2));
  await writeFile(DOC_OUT, formatMarkdown(chunks, initialRaw, initialGz));

  // Console summary.
  console.log(`Bundle manifest: ${MANIFEST_OUT}`);
  console.log(`Bundle sizes doc: ${DOC_OUT}`);
  console.log(
    `Initial entry: ${(initialRaw / 1024).toFixed(1)} kB raw / ${(initialGz / 1024).toFixed(1)} kB gz across ${
      chunks.filter((c) => c.initial).length
    } chunks`,
  );
  console.log(
    `Lazy chunks: ${chunks.filter((c) => !c.initial).length} (loaded on navigation / feature use)`,
  );

  if (failures.length > 0) {
    console.error('Bundle budget violations:');
    for (const f of failures) console.error(f);
    process.exit(1);
  }
  console.log('All chunk budgets pass.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
