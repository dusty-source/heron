// scripts/test-adapter.ts
// Validates the pdfStatementAdapter (App.tsx integration point) against the real ICICI PDF.
//
// Run: node --experimental-strip-types scripts/test-adapter.ts

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parsePdfStatementAccurate } from '../src/utils/pdfStatementAdapter.ts';

// Locate the sample ICICI statement across likely locations.
const CANDIDATE_PDFS = [
  'C:/Users/khanp/Downloads/Statement1_2026MTH07_472527907.pdf',
  'C:/Users/khanp/Downloads/Statement_2026MTH07_472527907.pdf',
  'C:/Users/khanp/OneDrive/Downloads/Statement1_2026MTH07_472527907.pdf',
  'C:/Users/khanp/OneDrive/Downloads/Statement_2026MTH07_472527907.pdf',
  'C:/Users/khanp/Desktop/Statement1_2026MTH07_472527907.pdf',
  'C:/Users/khanp/Desktop/Statement_2026MTH07_472527907.pdf',
];
const PDF_PATH = CANDIDATE_PDFS.find((p) => existsSync(resolve(p))) ?? CANDIDATE_PDFS[0];

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.log(`  FAIL: ${msg}`); }
}

function approx(a: number, b: number, tol = 0.01): boolean {
  return Math.abs(a - b) <= tol;
}

function getPassword(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--password' && argv[i + 1]) return argv[i + 1];
  }
  return process.env.PDF_PASSWORD || '';
}

async function main(): Promise<void> {
  if (!existsSync(PDF_PATH)) {
    console.error(`SKIP: test PDF not found at ${PDF_PATH}`);
    process.exit(0);
  }

  console.log('=== parsePdfStatementAccurate (App.tsx integration) ===');
  const buf = readFileSync(PDF_PATH);
  const password = getPassword(process.argv.slice(2));
  let result;
  try {
    result = await parsePdfStatementAccurate(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      password || undefined,
    );
  } catch (err: unknown) {
    if (err instanceof Error && (err.message === 'NEED_PASSWORD' || err.message === 'WRONG_PASSWORD')) {
      console.error('SKIP: PDF is password-protected — pass the password via `--password <pw>` or PDF_PASSWORD env.');
      process.exit(0);
    }
    throw err;
  }

  console.log('\n--- Contract shape ---');
  assert(Array.isArray(result.txns), 'txns is an array');
  assert(result.detection !== null, 'detection present');
  assert(result.balanceCheck !== null, 'balanceCheck present');
  assert(Array.isArray(result.rawTable), 'rawTable is an array');

  console.log('\n--- Detection profile ---');
  const p = result.detection!.profile;
  assert(p.dateIdx === 0, `dateIdx = 0 (got ${p.dateIdx})`);
  assert(p.creditIdx === 3, `creditIdx (deposits) = 3 (got ${p.creditIdx})`);
  assert(p.debitIdx === 4, `debitIdx (withdrawals) = 4 (got ${p.debitIdx})`);
  assert(p.balanceIdx === 5, `balanceIdx = 5 (got ${p.balanceIdx})`);
  assert(p.refIdx === -1, `refIdx = -1 (got ${p.refIdx})`);
  assert(result.detection!.usedHeaders === true, 'usedHeaders = true');
  assert(result.detection!.hasBalance === true, 'hasBalance = true');

  console.log('\n--- Transactions ---');
  assert(result.txns.length === 79, `79 txns (got ${result.txns.length})`);
  assert(result.txns.every(t => /^\d{4}-\d{2}-\d{2}$/.test(t.dateISO)), 'all dateISO yyyy-mm-dd');
  assert(result.txns.every(t => t.direction === 'credit' || t.direction === 'debit'), 'all have direction');
  assert(result.txns.every(t => t.amount > 0), 'all amounts positive');
  assert(result.txns.every(t => t.hash.length > 0), 'all have hash');
  assert(result.txns.every(t => t.source === 'statement'), 'all source=statement');

  console.log('\n--- Balance check (the key fix) ---');
  const bc = result.balanceCheck!;
  assert(approx(bc.openingBalance, 117479.11), `opening = 117479.11 (got ${bc.openingBalance.toFixed(2)})`);
  assert(approx(bc.closingBalance, 177777.64), `closing = 177777.64 (got ${bc.closingBalance.toFixed(2)})`);
  assert(approx(bc.totalDeposits, 188627.30), `totalDeposits = 188627.30 (got ${bc.totalDeposits.toFixed(2)})`);
  assert(approx(bc.totalWithdrawals, 128328.77), `totalWithdrawals = 128328.77 (got ${bc.totalWithdrawals.toFixed(2)})`);
  assert(approx(bc.difference, 0), `difference = 0.00 (got ${bc.difference.toFixed(2)})`);
  assert(bc.isValid === true, `isValid = true (got ${bc.isValid})`);

  console.log('\n--- rawTable (for Export button) ---');
  assert(result.rawTable.length === 80, `rawTable has 80 rows (1 header + 79) (got ${result.rawTable.length})`);
  assert(result.rawTable[0].length === 6, 'header has 6 columns');

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(2); });
