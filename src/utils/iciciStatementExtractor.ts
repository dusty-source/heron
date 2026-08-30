// src/utils/iciciStatementExtractor.ts
// Accurate, DOM-free extractor for ICICI-style bank statements (PDF -> structured rows).
// Reuses the battle-tested amount/date utilities from statementParser.ts.
//
// Correctness fixes vs. the original extractTextFromPdf:
//   1. Top-down row assembly (y descending) — pdf.js Y axis points up.
//   2. Header-based column bands detected from the actual header row.
//   3. Row classification: header repeats, Total:/Page footers, B/F, metadata blocks.
//   4. DATE+MODE single text runs ("05-07-2026 NET BANKING") are split.
//   5. Only strict money tokens fill amount columns — UTR fragments can't pollute.
//   6. Per-page "Total:" footers captured as an independent reconciliation oracle.

import type { DateOrder } from './statementParser.ts';
import { parseAmount, isDateLike } from './statementParser.ts';

export interface StatementRow {
  date: string;          // dd-mm-yyyy
  mode: string;
  particulars: string;
  deposits: number | null;
  withdrawals: number | null;
  balance: number;
  page: number;
}

export interface PageTotal {
  page: number;
  deposits: number;
  withdrawals: number;
  balance: number;
}

export interface ExtractionResult {
  rows: StatementRow[];
  pageTotals: PageTotal[];
  openingBalance: number;
  closingBalance: number;
  warnings: string[];
}

interface TextItem {
  x: number;
  y: number;
  str: string;
  width: number;
  height: number;
}

interface Cell {
  x: number;
  right: number;
  str: string;
}

interface HeaderBands {
  centers: number[]; // index = column index
}
// DATE MODE PARTICULARS DEPOSITS WITHDRAWALS BALANCE
const COL = { DATE: 0, MODE: 1, PARTICULARS: 2, DEPOSITS: 3, WITHDRAWALS: 4, BALANCE: 5 };
const NUM_COLS = 6;

function emptyRow(): string[] {
  return new Array(NUM_COLS).fill('');
}

// Robust amount validation: gates on digit count (reject 10-12 digit UTR/phone
// fragments) but parses via parseAmount, which correctly handles BOTH Western
// (1,234.56) and Indian (1,23,456.78) grouping — unlike the stricter regex in
// isStrictMoneyToken which only accepts Western groups.
function parseAmountStrict(raw: string): number | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 0 || digits.length > 9) return null;
  const n = parseAmount(raw);
  if (n === null || !Number.isFinite(n) || n <= 0) return null;
  return n;
}

// Detect the header row (contains DATE + BALANCE keywords) and return each
// column's x-center. Returns null if no usable header is found.
function detectHeaderBands(rawRows: Cell[][]): HeaderBands | null {
  const keywords = [
    /date/i,
    /mode/i,
    /particulars|narration|description/i,
    /deposits/i,
    /withdrawals/i,
    /balance/i,
  ];
  for (const cells of rawRows) {
    const centers: number[] = new Array(NUM_COLS).fill(0);
    const matched: boolean[] = new Array(NUM_COLS).fill(false);
    for (const cell of cells) {
      for (let c = 0; c < keywords.length; c++) {
        if (!matched[c] && keywords[c].test(cell.str)) {
          centers[c] = cell.x + (cell.right - cell.x) / 2;
          matched[c] = true;
          break;
        }
      }
    }
    const hasDate = matched[COL.DATE];
    const hasBalance = matched[COL.BALANCE];
    const hasAmount = matched[COL.DEPOSITS] || matched[COL.WITHDRAWALS];
    if (hasDate && hasBalance && hasAmount) return { centers };
  }
  return null;
}

// Assign a data cell to a column using boundary-based assignment on the cell's
// LEFT EDGE. Boundaries are midpoints between adjacent column centers, except
// the PARTICULARS/DEPOSITS boundary which is extended rightward to accommodate
// wide PARTICULARS text (which can extend toward the amount columns).
function assignColumn(cell: Cell, bands: HeaderBands): number {
  const c = bands.centers;
  const b: number[] = new Array(NUM_COLS).fill(0);
  b[COL.DATE] = -Infinity;
  b[COL.MODE] = (c[COL.DATE] + c[COL.MODE]) / 2;
  b[COL.PARTICULARS] = (c[COL.MODE] + c[COL.PARTICULARS]) / 2;
  // Extend PARTICULARS rightward so wide narrative text isn't pushed into DEPOSITS.
  b[COL.DEPOSITS] = Math.max((c[COL.PARTICULARS] + c[COL.DEPOSITS]) / 2, c[COL.DEPOSITS] - 30);
  b[COL.WITHDRAWALS] = (c[COL.DEPOSITS] + c[COL.WITHDRAWALS]) / 2;
  b[COL.BALANCE] = (c[COL.WITHDRAWALS] + c[COL.BALANCE]) / 2;

  const x = cell.x; // use left edge
  if (x < b[COL.MODE]) return COL.DATE;
  if (x < b[COL.PARTICULARS]) return COL.MODE;
  if (x < b[COL.DEPOSITS]) return COL.PARTICULARS;
  if (x < b[COL.WITHDRAWALS]) return COL.DEPOSITS;
  if (x < b[COL.BALANCE]) return COL.WITHDRAWALS;
  return COL.BALANCE;
}

// Build a 6-cell row from raw cells using header bands.
function buildRow(cells: Cell[], bands: HeaderBands): string[] {
  const row = emptyRow();
  for (const cell of cells) {
    const c = assignColumn(cell, bands);
    row[c] = row[c] ? `${row[c]} ${cell.str}` : cell.str;
  }
  return row;
}

// Split a "DATE MODE" single text run into its two columns.
// e.g. "05-07-2026 NET BANKING" -> date="05-07-2026", mode="NET BANKING".
function splitDateMode(row: string[]): void {
  const dateCell = (row[COL.DATE] || '').trim();
  const m = dateCell.match(/^(\d{2}-\d{2}-\d{4})\s+(.+)$/);
  if (m && isDateLike(m[1])) {
    row[COL.DATE] = m[1];
    if (!(row[COL.MODE] || '').trim()) row[COL.MODE] = m[2];
  }
}

// --- Row classifiers ---------------------------------------------------------
function isHeaderRow(cells: Cell[]): boolean {
  const joined = cells.map(c => c.str).join(' ');
  return /date/i.test(joined) && /balance/i.test(joined) && /particulars|deposits|withdrawals/i.test(joined);
}

function isFooterTotalRow(row: string[]): boolean {
  return /^total:/i.test((row[COL.PARTICULARS] || '').trim()) ||
    /^total:/i.test((row[COL.DATE] || '').trim());
}

function isPageMarkerRow(cells: Cell[]): boolean {
  return /page\s+\d+\s+of\s+\d+/i.test(cells.map(c => c.str).join(' '));
}

function isMetadataOrSummary(cells: Cell[]): boolean {
  const joined = cells.map(c => c.str).join(' ');
  return /customer\s*id|ckyc|account\s+details|account\s+holders|nomination|never\s+share\s+your\s+otp|dial\s+your\s+bank|terms\s+&\s+conditions|system\s+generated\s+statement|this\s+is\s+an\s+authenticated/i.test(joined);
}

function isBfRow(row: string[]): boolean {
  return /^b\/f$/i.test((row[COL.PARTICULARS] || '').trim());
}

export async function extractStatement(
  data: ArrayBuffer,
  password?: string,
  _dateOrder: DateOrder = 'dmy',
): Promise<ExtractionResult> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(data),
    password: password || undefined,
  }).promise;

  const rows: StatementRow[] = [];
  const pageTotals: PageTotal[] = [];
  const warnings: string[] = [];
  let openingBalance = 0;
  let closingBalance = 0;
  let bands: HeaderBands | null = null;

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();

    // 1. Collect non-empty text items with positions.
    const items: TextItem[] = [];
    for (const item of content.items as unknown as { str: string; transform: number[]; width: number; height: number }[]) {
      if (!item.str || !item.str.trim()) continue;
      items.push({
        x: item.transform[4],
        y: item.transform[5],
        str: item.str.trim(),
        width: item.width || 0,
        height: item.height || 0,
      });
    }
    if (items.length === 0) continue;

    // 2. Sort TOP-DOWN: larger y first (pdf.js Y axis points up).
    const sortedByY = [...items].sort((a, b) => b.y - a.y || a.x - b.x);

    // 3. Group by Y into visual rows.
    const heights = sortedByY.map(i => i.height).filter(h => h > 0);
    const medianHeight = heights.length > 0 ? heights[Math.floor(heights.length / 2)] : 10;
    const yTolerance = Math.max(medianHeight * 0.3, 2);

    const yRows: { y: number; items: TextItem[] }[] = [];
    for (const item of sortedByY) {
      let found = false;
      for (const row of yRows) {
        if (Math.abs(item.y - row.y) <= yTolerance) {
          row.items.push(item);
          found = true;
          break;
        }
      }
      if (!found) yRows.push({ y: item.y, items: [item] });
    }

    // 4. Merge horizontally-adjacent items into cells.
    const gapTol = Math.max(3, medianHeight * 0.4);
    const rawRows: Cell[][] = yRows.map(row => {
      const sorted = [...row.items].sort((a, b) => a.x - b.x);
      const cells: Cell[] = [];
      for (const item of sorted) {
        const right = item.x + item.width;
        const last = cells[cells.length - 1];
        if (last && item.x <= last.right + gapTol) {
          last.str += ' ' + item.str;
          last.right = Math.max(last.right, right);
        } else {
          cells.push({ x: item.x, right, str: item.str });
        }
      }
      return cells;
    });

    // 5. Detect header bands once (reuse across pages).
    if (!bands) {
      bands = detectHeaderBands(rawRows);
      if (!bands) {
        warnings.push(`Page ${p}: could not detect header column bands.`);
        continue;
      }
    }

    // 6. Classify + convert each raw row.
    for (const cells of rawRows) {
      if (isHeaderRow(cells)) continue;
      if (isPageMarkerRow(cells)) continue;
      if (isMetadataOrSummary(cells)) continue;

      const row = buildRow(cells, bands);
      splitDateMode(row);

      if (isFooterTotalRow(row)) {
        const dep = parseAmountStrict(row[COL.DEPOSITS] || '') || 0;
        const wd = parseAmountStrict(row[COL.WITHDRAWALS] || '') || 0;
        const bal = parseAmount(row[COL.BALANCE] || '') || 0;
        pageTotals.push({ page: p, deposits: dep, withdrawals: wd, balance: bal });
        closingBalance = bal;
        continue;
      }

      if (isBfRow(row)) {
        const bal = parseAmount(row[COL.BALANCE] || '');
        if (bal !== null) openingBalance = bal;
        continue;
      }

      const dateStr = (row[COL.DATE] || '').trim();
      if (!isDateLike(dateStr)) continue;

      let deposits: number | null = null;
      let withdrawals: number | null = null;

      const depRaw = (row[COL.DEPOSITS] || '').trim();
      const depVal = parseAmountStrict(depRaw);
      if (depVal !== null) deposits = depVal;
      const wdRaw = (row[COL.WITHDRAWALS] || '').trim();
      const wdVal = parseAmountStrict(wdRaw);
      if (wdVal !== null) withdrawals = wdVal;

      const balance = parseAmount(row[COL.BALANCE] || '');
      if (balance === null) {
        warnings.push(`Page ${p}: row dated ${dateStr} has no parseable balance — skipped.`);
        continue;
      }

      rows.push({
        date: dateStr,
        mode: (row[COL.MODE] || '').trim(),
        particulars: (row[COL.PARTICULARS] || '').trim(),
        deposits,
        withdrawals,
        balance,
        page: p,
      });
    }
  }

  if (closingBalance === 0 && rows.length > 0) {
    closingBalance = rows[rows.length - 1].balance;
  }

  return { rows, pageTotals, openingBalance, closingBalance, warnings };
}

