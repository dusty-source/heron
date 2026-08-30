// scripts/pdf-to-csv.ts
// CLI: extract an ICICI-style bank statement PDF -> CSV + reconciliation report.
//
// Usage:
//   node --experimental-strip-types scripts/pdf-to-csv.ts <input.pdf> [output.csv] [--report report.csv] [--password PASSWORD]
//
// Exit codes: 0 = balances valid, 1 = balances invalid (check report.csv).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractStatement } from '../src/utils/iciciStatementExtractor.ts';
import { rowsToCsv, checkBalances, checkReportToCsv } from '../src/utils/csvWriter.ts';

function parseArgs(argv: string[]): { input: string; output: string; report: string; password: string } {
  let input = '';
  let output = '';
  let report = '';
  let password = process.env.PDF_PASSWORD || '';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--report' && argv[i + 1]) { report = argv[++i]; continue; }
    if (a === '--password' && argv[i + 1]) { password = argv[++i]; continue; }
    if (!a.startsWith('--')) {
      if (!input) input = a;
      else if (!output) output = a;
    }
  }
  if (!output && input) output = input.replace(/\.pdf$/i, '') + '.csv';
  if (!report && output) report = output.replace(/\.csv$/i, '') + '-report.csv';
  return { input, output, report, password };
}

async function main(): Promise<void> {
  const { input, output, report, password } = parseArgs(process.argv.slice(2));
  if (!input) {
    console.error('Usage: node --experimental-strip-types scripts/pdf-to-csv.ts <input.pdf> [output.csv] [--report report.csv] [--password PASSWORD]');
    process.exit(2);
  }
  const inputPath = resolve(input);
  if (!existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(2);
  }

  const buf = readFileSync(inputPath);
  console.log(`Extracting ${inputPath} (${buf.length} bytes)...`);

  const result = await extractStatement(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), password || undefined);

  if (result.warnings.length) {
    console.warn('Warnings:');
    for (const w of result.warnings) console.warn(`  - ${w}`);
  }

  const csv = rowsToCsv(result.rows);
  writeFileSync(resolve(output), csv, 'utf8');
  console.log(`Wrote ${result.rows.length} rows -> ${output}`);

  const check = checkBalances(result);
  const reportCsv = checkReportToCsv(check);
  writeFileSync(resolve(report), reportCsv, 'utf8');
  console.log(`Wrote reconciliation report -> ${report}`);

  // Summary.
  console.log('\n=== Reconciliation Summary ===');
  console.log(`Opening balance:    ${check.openingBalance.toFixed(2)}`);
  console.log(`Total deposits:     ${check.totalDeposits.toFixed(2)}`);
  console.log(`Total withdrawals:  ${check.totalWithdrawals.toFixed(2)}`);
  console.log(`Expected closing:   ${check.expectedClosing.toFixed(2)}`);
  console.log(`Actual closing:     ${check.closingBalance.toFixed(2)}`);
  console.log(`Difference:         ${check.difference.toFixed(2)}`);
  console.log(`Running-balance OK: ${check.runningBalanceOk} (${check.runningMismatches.length} mismatches)`);
  console.log(`Per-page oracle OK: ${check.perPageOracleOk} (${check.perPageMismatches.length} mismatches)`);
  console.log(`Month-end OK:       ${check.monthEndOk}`);
  console.log(`OVERALL VALID:      ${check.isValid}`);

  process.exit(check.isValid ? 0 : 1);
}

main().catch((err: unknown) => {
  const e = err as { name?: string; code?: number; message?: string };
  if (e?.name === 'PasswordException') {
    console.error(`This PDF is password-protected (${e.message}).`);
    console.error('Pass the password with:   --password <password>   (or set the PDF_PASSWORD env var).');
    process.exit(2);
  }
  console.error('Fatal error:', err);
  process.exit(2);
});
