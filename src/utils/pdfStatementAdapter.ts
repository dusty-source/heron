// src/utils/pdfStatementAdapter.ts
// Bridges the accurate ICICI extractor (iciciStatementExtractor.ts + csvWriter.ts)
// to the app's existing ParseResult contract used by App.tsx's import flow.
//
// This lets the app's "Import bank statement (PDF)" button produce correct results
// — the old extractTextFromPdf path had reversed Y-sort, swapped credit/debit,
// and no amount gating, which produced the broken diagnostics seen in heron-diagnostic.csv.

import type { DateOrder, ParsedTxn, ParseResult, ColumnDetection, BalanceCheck } from './statementParser.ts';
import { txnHash } from './statementParser.ts';
import { extractStatement } from './iciciStatementExtractor.ts';
import { checkBalances } from './csvWriter.ts';

// Password-error mapping that the app's handleFile expects (App.tsx:799-801).
function mapPasswordError(err: unknown): never {
  const e = err as { name?: string; code?: number };
  if (e?.name === 'PasswordException') {
    throw new Error(e.code === 2 ? 'WRONG_PASSWORD' : 'NEED_PASSWORD');
  }
  throw err;
}

// dd-mm-yyyy -> yyyy-mm-dd (the ICICI statement uses dd-mm-yyyy).
function toDateISO(ddmmyyyy: string): string {
  const [dd, mm, yyyy] = ddmmyyyy.split('-');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Accurate PDF statement parser, matching the app's ParseResult contract.
 * Replaces extractTextFromPdf + parseStatementLines for the ICICI layout.
 */
export async function parsePdfStatementAccurate(
  data: ArrayBuffer,
  password?: string,
  _dateOrder: DateOrder = 'dmy',
): Promise<ParseResult> {
  let result;
  try {
    result = await extractStatement(data, password);
  } catch (err: unknown) {
    mapPasswordError(err);
  }

  const { rows, openingBalance, closingBalance, warnings } = result!;

  // Map StatementRow[] -> ParsedTxn[] (the app's transaction shape).
  const txns: ParsedTxn[] = rows.map((r) => {
    const isCredit = r.deposits !== null;
    const amount = isCredit ? r.deposits! : r.withdrawals!;
    const dateISO = toDateISO(r.date);
    const [dd, mm] = r.date.split('-').map(Number);
    const description = r.particulars || r.mode || 'Statement entry';
    const hash = txnHash(dateISO, amount, isCredit ? 'credit' : 'debit', description);
    return {
      id: '',
      hash,
      dateISO,
      amount,
      direction: isCredit ? 'credit' : 'debit',
      description,
      monthIndex: mm - 1,
      yearHint: dd && mm ? extractYear(r.date) : new Date().getFullYear(),
      source: 'statement' as const,
    };
  });

  // rawTable for the existing Export diagnostic CSV button (6 columns + header).
  const rawTable: string[][] = [
    ['DATE', 'MODE', 'PARTICULARS', 'DEPOSITS', 'WITHDRAWALS', 'BALANCE'],
    ...rows.map((r) => [
      r.date,
      r.mode,
      r.particulars,
      r.deposits !== null ? r.deposits.toFixed(2) : '',
      r.withdrawals !== null ? r.withdrawals.toFixed(2) : '',
      r.balance.toFixed(2),
    ]),
  ];

  // detection: report the known-correct ICICI profile.
  const detection: ColumnDetection = {
    profile: { dateIdx: 0, descIdx: 2, creditIdx: 3, debitIdx: 4, balanceIdx: 5, refIdx: -1 },
    usedHeaders: true,
    hasBalance: true,
    layoutKey: 'icici-accurate',
    diagnostics: { fallbackUsed: 'heuristic', score: 1, reasons: ['ICICI layout matched via header bands'] },
  };

  // balanceCheck from the accurate reconciliation.
  const check = checkBalances(result!);
  const balanceCheck: BalanceCheck = {
    openingBalance,
    closingBalance,
    totalDeposits: check.totalDeposits,
    totalWithdrawals: check.totalWithdrawals,
    expectedClosing: check.expectedClosing,
    difference: check.difference,
    isValid: check.isValid,
  };

  const errors: string[] = [...warnings];
  if (!check.isValid) {
    errors.push(
      `Balance check failed: expected closing ${check.expectedClosing.toFixed(2)} vs actual ${closingBalance.toFixed(2)} (diff ${check.difference.toFixed(2)}).`,
    );
  }

  return { txns, detection, balanceCheck, rawTable, errors };
}

// Derive a 4-digit year from a dd-mm-yyyy date string.
function extractYear(ddmmyyyy: string): number {
  const parts = ddmmyyyy.split('-');
  return parts.length === 3 ? parseInt(parts[2], 10) : new Date().getFullYear();
}
