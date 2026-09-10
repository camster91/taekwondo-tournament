#!/usr/bin/env node
/**
 * Bundle size analysis and budget verification
 * 
 * Usage:
 *   npm run bundle:analyze           # Build + generate reports
 *   npm run bundle:check             # Verify budgets (CI-friendly)
 *   npm run bundle:baseline          # Update baseline.json
 * 
 * This script is designed for LOCAL/VPS verification, not GitHub Actions.
 * CI failures on Actions are advisory-only due to billing/image constraints.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { gzipSync, brotliCompressSync } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
const BASELINE_FILE = resolve(ROOT, 'bundle-baseline.json');

// Budget thresholds (in KB, gzipped)
const BUDGETS = {
  // Initial entry point - must stay under 150KB gzip for mobile
  initialEntry: 150,
  
  // Critical public routes - must be fast on 3G
  publicRegistration: 60,
  publicScoreboard: 60,
  
  // Authenticated routes - more headroom
  scorekeeper: 70,
  divisions: 80,
  dashboard: 60,
  
  // Heavyweight report/admin features
  results: 40,
  competitors: 40,
  schedule: 50,
  
  // Vendor chunks
  vendorReact: 200,
  vendorCore: 150,
  vendorXLSX: 170, // XLSX is 163KB gzip in baseline
  vendorJsPDF: 130,
};

/**
 * Get file size in KB (raw, gzip, brotli)
 */
function getSizes(filePath) {
  const content = readFileSync(filePath);
  const raw = content.length / 1024;
  const gzip = gzipSync(content).length / 1024;
  const brotli = brotliCompressSync(content).length / 1024;
  return { raw, gzip, brotli };
}

/**
 * Parse Vite manifest to find chunk names
 */
function parseManifest() {
  const manifestPath = resolve(DIST, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error('manifest.json not found. Run `npm run build:client` first.');
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  return manifest;
}

/**
 * Analyze all chunks in dist/assets
 */
function analyzeChunks() {
  const manifest = parseManifest();
  const chunks = {};
  
  // Find the main entry point
  const indexEntry = manifest['src/client/main.tsx'];
  if (indexEntry?.file) {
    const filePath = resolve(DIST, indexEntry.file);
    chunks.initialEntry = {
      file: indexEntry.file,
      ...getSizes(filePath),
    };
  }
  
  // Also check for index-*.js files (the actual entry bundle)
  Object.entries(manifest).forEach(([key, value]) => {
    if (value.file && value.file.match(/assets\/index-[^\/]+\.js$/)) {
      const filePath = resolve(DIST, value.file);
      if (existsSync(filePath)) {
        chunks.initialEntry = {
          file: value.file,
          ...getSizes(filePath),
        };
      }
    }
  });
  
  // Find all page chunks
  Object.entries(manifest).forEach(([key, value]) => {
    const file = value.file;
    if (!file || !file.startsWith('assets/')) return;
    
    const filePath = resolve(DIST, file);
    if (!existsSync(filePath)) return;
    
    const sizes = getSizes(filePath);
    
    // Match page chunks
    if (file.includes('PublicRegister-')) {
      chunks.publicRegistration = { file, ...sizes };
    } else if (file.includes('PublicScoreboard-') && !file.includes('BySlug')) {
      chunks.publicScoreboard = { file, ...sizes };
    } else if (file.includes('Scorekeeper-')) {
      chunks.scorekeeper = { file, ...sizes };
    } else if (file.includes('Divisions-')) {
      chunks.divisions = { file, ...sizes };
    } else if (file.includes('Dashboard-') && !file.includes('Director')) {
      chunks.dashboard = { file, ...sizes };
    } else if (file.includes('Results-')) {
      chunks.results = { file, ...sizes };
    } else if (file.includes('Competitors-')) {
      chunks.competitors = { file, ...sizes };
    } else if (file.includes('Schedule-')) {
      chunks.schedule = { file, ...sizes };
    }
    
    // Match vendor chunks
    if (file.includes('vendor-xlsx') || file.includes('xlsx-')) {
      chunks.vendorXLSX = { file, ...sizes };
    } else if (file.includes('vendor-jspdf') || file.includes('jspdf')) {
      chunks.vendorJsPDF = { file, ...sizes };
    } else if (file.includes('vendor-react')) {
      chunks.vendorReact = { file, ...sizes };
    } else if (file.includes('vendor-core')) {
      chunks.vendorCore = { file, ...sizes };
    }
  });
  
  return chunks;
}

/**
 * Check if chunks are within budget
 */
function checkBudgets(chunks) {
  const violations = [];
  const warnings = [];
  
  Object.entries(BUDGETS).forEach(([key, limit]) => {
    const chunk = chunks[key];
    if (!chunk) {
      warnings.push(`⚠️  Missing chunk: ${key}`);
      return;
    }
    
    const gzipSize = chunk.gzip;
    const overBudget = gzipSize - limit;
    
    if (overBudget > 0) {
      violations.push({
        key,
        file: chunk.file,
        gzipSize: gzipSize.toFixed(2),
        limit,
        overBudget: overBudget.toFixed(2),
      });
    }
  });
  
  return { violations, warnings };
}

/**
 * Print analysis report
 */
function printReport(chunks, budgetCheck) {
  console.log('\n📦 Bundle Size Analysis\n');
  console.log('=' .repeat(80));
  
  // Print all chunks with sizes
  Object.entries(chunks).forEach(([key, data]) => {
    const budget = BUDGETS[key];
    const status = budget && data.gzip > budget ? '❌' : '✅';
    const budgetText = budget ? ` (budget: ${budget}KB)` : '';
    
    console.log(`${status} ${key}${budgetText}`);
    console.log(`   File: ${data.file}`);
    console.log(`   Raw:     ${data.raw.toFixed(2)} KB`);
    console.log(`   Gzip:    ${data.gzip.toFixed(2)} KB`);
    console.log(`   Brotli:  ${data.brotli.toFixed(2)} KB`);
    console.log();
  });
  
  // Print violations
  if (budgetCheck.violations.length > 0) {
    console.log('🚨 Budget Violations:\n');
    budgetCheck.violations.forEach(v => {
      console.log(`   ${v.key}: ${v.gzipSize}KB (over by ${v.overBudget}KB)`);
      console.log(`   Budget: ${v.limit}KB | File: ${v.file}`);
      console.log();
    });
  }
  
  // Print warnings
  if (budgetCheck.warnings.length > 0) {
    console.log('⚠️  Warnings:\n');
    budgetCheck.warnings.forEach(w => console.log(`   ${w}`));
    console.log();
  }
  
  if (budgetCheck.violations.length === 0 && budgetCheck.warnings.length === 0) {
    console.log('✅ All chunks within budget!\n');
  }
  
  console.log('=' .repeat(80));
  console.log('\n📊 Visual analysis: open dist/stats.html in your browser\n');
}

/**
 * Save baseline for future comparisons
 */
function saveBaseline(chunks) {
  const baseline = {
    timestamp: new Date().toISOString(),
    chunks,
    budgets: BUDGETS,
  };
  
  writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2));
  console.log(`\n💾 Baseline saved to ${BASELINE_FILE}\n`);
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'analyze';
  
  try {
    // Build with analysis enabled
    if (command === 'analyze' || command === 'baseline') {
      console.log('🔨 Building production bundle with analysis...\n');
      execSync('NODE_ENV=production MODE=analyze npm run build:client', {
        stdio: 'inherit',
        cwd: ROOT,
      });
    }
    
    // Analyze chunks
    const chunks = analyzeChunks();
    const budgetCheck = checkBudgets(chunks);
    
    // Print report
    printReport(chunks, budgetCheck);
    
    // Save baseline if requested
    if (command === 'baseline') {
      saveBaseline(chunks);
    }
    
    // Exit with error if budgets violated (for CI)
    if (command === 'check' && budgetCheck.violations.length > 0) {
      console.error('\n❌ Bundle budgets exceeded. Run `npm run bundle:analyze` to see details.\n');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Analysis failed:', error.message);
    process.exit(1);
  }
}

main();
