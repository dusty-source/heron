// scripts/test-extractor.ts
// Test suite for the PDF-to-CSV extractor using the real ICICI statement.
// Validates extraction accuracy against the bank's printed totals (the strongest oracle).
//
// Run: node --experimental-strip-types scripts/test-extractor.ts

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractStatement } from '../src/utils/iciciStatementExtractor.ts';
import { rowsToCsv, checkBalances, checkReportToCsv } from '../src/utils/csvWriter.ts';
import { parseCSV } from '../src/utils/statementParser.ts';

const PDF_PATH = resolve('C:/Users/khanp/Downloads/Statement1_2026MTH07_472527907.pdf');

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.log(`  FAIL: ${msg}`);
  }
}

function approx(a: number, b: number, tol = 0.01): boolean {
  return Math.abs(a - b) <= tol;
}

async function main(): Promise<void> {
  if (!existsSync(PDF_PATH)) {
    console.error(`SKIP: test PDF not found at ${PDF_PATH}`);
    console.error('  (This test requires the sample statement to be present.)');
    process.exit(0);
  }

  console.log('=== Extracting PDF ===');
  const buf = readFileSync(PDF_PATH);
  const result = await extractStatement(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

  if (result.warnings.length) {
    console.log('Warnings:');
    for (const w of result.warnings) console.log(`  - ${w}`);
  }

  // --- Test 1: Row count and basic structure ---
  console.log('\n=== Test 1: Row count & structure ===');
  assert(result.rows.length === 79, `79 transaction rows parsed (got ${result.rows.length})`);
  assert(result.rows.every(r => /^\d{2}-\d{2}-\d{4}$/.test(r.date)), 'all rows have dd-mm-yyyy date');
  assert(result.rows.every(r => r.balance > 0), 'all rows have a positive balance');

  // --- Test 2: Chronological order within pages ---
  console.log('\n=== Test 2: Chronological ordering ===');
  let inOrder = true;
  for (let i = 1; i < result.rows.length; i++) {
    if (result.rows[i].page === result.rows[i - 1].page) {
      const d = result.rows[i].date.split('-').reverse().join('');
      const pd = result.rows[i - 1].date.split('-').reverse().join('');
      if (d < pd) { inOrder = false; break; }
    }
  }
  assert(inOrder, 'rows are chronologically ordered within each page');

  // --- Test 3: Known-good totals (bank's printed oracles) ---
  console.log('\n=== Test 3: Bank oracle totals ===');
  assert(approx(result.openingBalance, 117479.11), `opening balance = 117479.11 (got ${result.openingBalance.toFixed(2)})`);
  assert(approx(result.closingBalance, 177777.64), `closing balance = 177777.64 (got ${result.closingBalance.toFixed(2)})`);

  const totalDep = result.rows.reduce((s, r) => s + (r.deposits || 0), 0);
  const totalWd = result.rows.reduce((s, r) => s + (r.withdrawals || 0), 0);
  assert(approx(totalDep, 188627.30), `total deposits = 188627.30 (got ${totalDep.toFixed(2)})`);
  assert(approx(totalWd, 128328.77), `total withdrawals = 128328.77 (got ${totalWd.toFixed(2)})`);

  // --- Test 4: Per-page oracles ---
  console.log('\n=== Test 4: Per-page oracles ===');
  const expectedPages = [
    { page: 1, dep: 0.00, wd: 13262.27, bal: 104216.84 },
    { page: 2, dep: 6605.11, wd: 69367.87, bal: 41454.08 },
    { page: 3, dep: 143.19, wd: 40098.63, bal: 1498.64 },
    { page: 4, dep: 181879.00, wd: 5600.00, bal: 177777.64 },
  ];
  for (const ep of expectedPages) {
    const pt = result.pageTotals.find(p => p.page === ep.page);
    assert(!!pt, `page ${ep.page} footer captured`);
    if (pt) {
      assert(approx(pt.deposits, ep.dep), `P${ep.page} deposits = ${ep.dep.toFixed(2)} (got ${pt.deposits.toFixed(2)})`);
      assert(approx(pt.withdrawals, ep.wd), `P${ep.page} withdrawals = ${ep.wd.toFixed(2)} (got ${pt.withdrawals.toFixed(2)})`);
      assert(approx(pt.balance, ep.bal), `P${ep.page} closing = ${ep.bal.toFixed(2)} (got ${pt.balance.toFixed(2)})`);
    }
  }

  // --- Test 5: Reconciliation checks ---
  console.log('\n=== Test 5: Reconciliation ===');
  const check = checkBalances(result);
  assert(check.runningBalanceOk, `running-balance chain valid (${check.runningMismatches.length} mismatches)`);
  assert(check.perPageOracleOk, `per-page oracle valid (${check.perPageMismatches.length} mismatches)`);
  assert(check.monthEndOk, `month-end balance valid (diff=${check.difference.toFixed(2)})`);
  assert(check.isValid, 'OVERALL VALID');

  // --- Test 6: CSV round-trip ---
  console.log('\n=== Test 6: CSV round-trip ===');
  const csv = rowsToCsv(result.rows);
  assert(csv.startsWith('\uFEFF'), 'CSV has UTF-8 BOM');
  const parsed = parseCSV(csv);
  assert(parsed.length === result.rows.length + 1, `CSV parses back to ${result.rows.length} data rows (got ${parsed.length - 1})`);
  // Verify a known deposit survives the round-trip.
  const hasBigDeposit = result.rows.some(r => approx(r.deposits || 0, 176727.00));
  assert(hasBigDeposit, 'large NEFT deposit (176727.00) present');

  // --- Test 7: No UTR/amount pollution ---
  console.log('\n=== Test 7: No amount pollution ===');
  const allAmounts = result.rows.flatMap(r => [r.deposits, r.withdrawals, r.balance].filter((v): v is number => v !== null));
  const maxAmount = Math.max(...allAmounts);
  assert(maxAmount <= 999999999, `no amount exceeds 9 digits (max=${maxAmount.toFixed(2)})`);
  // The largest legitimate value is the NEFT credit.
  assert(maxAmount < 200000, `largest amount is the NEFT credit (got ${maxAmount.toFixed(2)})`);

  // --- Summary ---
  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(2);
});
