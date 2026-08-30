// src/utils/csvWriter.ts
// RFC 4180 CSV serialization for statement rows + a reconciliation check report.
// Reuses csvEscape from statementParser.ts (the one true escaping implementation).

import { csvEscape } from './statementParser.ts';
import type { StatementRow, ExtractionResult } from './iciciStatementExtractor.ts';

const BOM = '\uFEFF'; // UTF-8 BOM for Excel/Office compatibility
const CRLF = '\r\n';

const HEADER = ['DATE', 'MODE', 'PARTICULARS', 'DEPOSITS', 'WITHDRAWALS', 'BALANCE'];

// ---------------------------------------------------------------------------
// Serialize transaction rows to CSV.
// ---------------------------------------------------------------------------
export function rowsToCsv(rows: StatementRow[]): string {
  const lines: string[] = [HEADER.map(csvEscape).join(',')];
  for (const r of rows) {
    const cells = [
      r.date,
      r.mode,
      r.particulars,
      r.deposits !== null ? r.deposits.toFixed(2) : '',
      r.withdrawals !== null ? r.withdrawals.toFixed(2) : '',
      r.balance.toFixed(2),
    ];
    lines.push(cells.map(csvEscape).join(','));
  }
  return BOM + lines.join(CRLF);
}

// ---------------------------------------------------------------------------
// Reconciliation check: verifies the statement balances.
//   - running balance: bal[i-1] + dep[i] - wd[i] == bal[i]  (per row)
//   - per-page oracle:  sum of rows on page == printed "Total:" footer
//   - month-end:         closing == opening + Σdep - Σwd
// ---------------------------------------------------------------------------
export interface CheckReport {
  runningBalanceOk: boolean;
  runningMismatches: { row: number; expected: number; actual: number; date: string }[];
  perPageOracleOk: boolean;
  perPageMismatches: { page: number; field: string; expected: number; actual: number }[];
  monthEndOk: boolean;
  openingBalance: number;
  closingBalance: number;
  totalDeposits: number;
  totalWithdrawals: number;
  expectedClosing: number;
  difference: number;
  isValid: boolean;
}

export function checkBalances(result: ExtractionResult): CheckReport {
  const { rows, pageTotals, openingBalance, closingBalance } = result;

  // Running-balance chain check.
  const runningMismatches: CheckReport['runningMismatches'] = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    const expected = prev.balance + (cur.deposits || 0) - (cur.withdrawals || 0);
    if (Math.abs(expected - cur.balance) > 0.01) {
      runningMismatches.push({ row: i, expected, actual: cur.balance, date: cur.date });
    }
  }

  // Per-page oracle check.
  const perPageMismatches: CheckReport['perPageMismatches'] = [];
  for (const pt of pageTotals) {
    const pageRows = rows.filter(r => r.page === pt.page);
    const sumDep = pageRows.reduce((s, r) => s + (r.deposits || 0), 0);
    const sumWd = pageRows.reduce((s, r) => s + (r.withdrawals || 0), 0);
    if (Math.abs(sumDep - pt.deposits) > 0.01) {
      perPageMismatches.push({ page: pt.page, field: 'deposits', expected: pt.deposits, actual: sumDep });
    }
    if (Math.abs(sumWd - pt.withdrawals) > 0.01) {
      perPageMismatches.push({ page: pt.page, field: 'withdrawals', expected: pt.withdrawals, actual: sumWd });
    }
  }

  // Month-end check.
  const totalDeposits = rows.reduce((s, r) => s + (r.deposits || 0), 0);
  const totalWithdrawals = rows.reduce((s, r) => s + (r.withdrawals || 0), 0);
  const expectedClosing = openingBalance + totalDeposits - totalWithdrawals;
  const difference = Math.abs(closingBalance - expectedClosing);

  const runningBalanceOk = runningMismatches.length === 0;
  const perPageOracleOk = perPageMismatches.length === 0;
  const monthEndOk = difference <= 0.01;

  return {
    runningBalanceOk,
    runningMismatches,
    perPageOracleOk,
    perPageMismatches,
    monthEndOk,
    openingBalance,
    closingBalance,
    totalDeposits,
    totalWithdrawals,
    expectedClosing,
    difference,
    isValid: runningBalanceOk && perPageOracleOk && monthEndOk,
  };
}

// ---------------------------------------------------------------------------
// Serialize the check report to a key/value CSV.
// ---------------------------------------------------------------------------
export function checkReportToCsv(report: CheckReport): string {
  const lines: string[] = ['check_item,value'];
  const row = (k: string, v: string) => `${csvEscape(k)},${csvEscape(v)}`;
  lines.push(row('openingBalance', report.openingBalance.toFixed(2)));
  lines.push(row('closingBalance', report.closingBalance.toFixed(2)));
  lines.push(row('totalDeposits', report.totalDeposits.toFixed(2)));
  lines.push(row('totalWithdrawals', report.totalWithdrawals.toFixed(2)));
  lines.push(row('expectedClosing', report.expectedClosing.toFixed(2)));
  lines.push(row('difference', report.difference.toFixed(2)));
  lines.push(row('runningBalanceOk', String(report.runningBalanceOk)));
  lines.push(row('runningMismatches', String(report.runningMismatches.length)));
  lines.push(row('perPageOracleOk', String(report.perPageOracleOk)));
  lines.push(row('perPageMismatches', String(report.perPageMismatches.length)));
  lines.push(row('monthEndOk', String(report.monthEndOk)));
  lines.push(row('isValid', String(report.isValid)));
  return BOM + lines.join(CRLF);
}
