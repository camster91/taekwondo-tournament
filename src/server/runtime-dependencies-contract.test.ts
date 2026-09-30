import { builtinModules } from 'module';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

// The production image installs `dependencies` only (npm ci --omit=dev).
// A server import that resolves locally through a devDependency's
// sub-dependency crashes the container at startup (this happened with `ws`,
// which only arrived via jsdom). Every runtime import of server/shared code
// must therefore be a declared production dependency.

const root = path.resolve(__dirname, '../..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
};
const productionDeps = new Set(Object.keys(pkg.dependencies ?? {}));
const builtins = new Set(builtinModules);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) ? [full] : [];
  });
}

function packageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** Bare specifiers that survive compilation (type-only imports are erased). */
export function runtimeImports(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const found: string[] = [];
  // The clause is only identifiers, braces, commas and `* as x`, so an
  // `export const` followed by a string containing "from" never matches.
  const staticImport = /^\s*(import|export)\s+(?!type\b)([\w$*{}\s,]+?)\s+from\s+['"]([^'"]+)['"]/gm;
  for (const match of code.matchAll(staticImport)) {
    // `import { type A, type B } from 'x'` is erased too.
    const clause = match[2].trim();
    const typeOnlyNamed = /^\{[^}]*\}$/.test(clause)
      && clause.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith('type '));
    if (!typeOnlyNamed) found.push(match[3]);
  }
  for (const match of code.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) found.push(match[1]);
  // Skip `import('x').Type` type queries; they are erased.
  for (const match of code.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)(?!\.[A-Z])/g)) found.push(match[1]);
  return found.filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('/'));
}

describe('runtime dependency contract', () => {
  it('parses runtime and type-only imports', () => {
    expect(runtimeImports(`import type { A } from 'types-only';
import { type B } from 'also-types';
import { C, type D } from 'runtime-a';
import E from 'runtime-b';
import 'side-effect';
const lazy = await import('runtime-c');
type Q = import('type-query').Request;
export const message = { text: \`from "\${x}"\` };
// import x from 'commented-out';
`)).toEqual(['runtime-a', 'runtime-b', 'side-effect', 'runtime-c']);
  });

  it('declares every server and shared runtime import as a production dependency', () => {
    const missing = new Map<string, string>();
    const files = [
      ...sourceFiles(path.join(root, 'src/server')),
      ...sourceFiles(path.join(root, 'src/shared')),
      // Built into dist-demo and run in production by `npm run demo:reset:production`.
      path.join(root, 'prisma/demo-seed.ts'),
    ];
    for (const file of files) {
      for (const specifier of runtimeImports(readFileSync(file, 'utf8'))) {
        if (specifier.startsWith('node:')) continue;
        const name = packageName(specifier);
        if (builtins.has(name) || productionDeps.has(name)) continue;
        missing.set(name, path.relative(root, file));
      }
    }
    expect(Object.fromEntries(missing)).toEqual({});
  });
});
