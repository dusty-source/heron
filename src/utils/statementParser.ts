// src/utils/statementParser.ts
// Country-agnostic bank-statement parser: CSV or PDF text -> normalized transactions.
// No currency, date-format, bank or country assumptions: every ambiguous dimension
// (day/month order, thousands notation, direction signal) is auto-inferred and can
// be overridden in the preview UI.

export type Direction = 'credit' | 'debit';
export type DateOrder = 'dmy' | 'mdy';

export interface ParsedTxn {
  id: string;
  hash: string;
  dateISO: string; // yyyy-mm-dd
  refId?: string;   // bank reference / UTR / RRN / txn id when the statement exposes one
  amount: number;
  direction: Direction;
  description: string;
  monthIndex: number; // 0..11
  yearHint: number;
  source: 'statement';
}

export interface ColumnProfile {
  dateIdx: number;
  descIdx: number;
  creditIdx: number;
  debitIdx: number;
  balanceIdx: number;
  refIdx: number;
}

export interface ColumnDetection {
  profile: ColumnProfile;
  usedHeaders: boolean;
  hasBalance: boolean;
  layoutKey: string;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8,
  sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
};

// ── hashing (FNV-1a) ────────────────────────────────────────────
export function normalizeRef(raw: string): string {
  return String(raw || '')
    .replace(/^(upi|utr|rrn|txn|ref|chq|cheque|serial|ack|id)/i, '') // only known prefixes
    .replace(/[^A-Z0-9]/gi, '')
    .toUpperCase();
}

export function txnHash(dateISO: string, amount: number, direction: Direction, description: string): string {
  const norm = description.toLowerCase().replace(/\s+/g, ' ').trim();
  const s = `${dateISO}|${amount.toFixed(2)}|${direction}|${norm}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ── amount parsing: any currency symbols/codes are stripped, never interpreted.
// Supports 1,234.56 (Anglo) and 1.234,56 (European) notations.
export function parseAmount(raw: string): number | null {
  if (!raw) return null;
  let t = raw.replace(/[^\d.,\-() \u00a0]/g, '').trim();
  if (!t || !/\d/.test(t)) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (t.startsWith('-')) { neg = true; t = t.slice(1); }
  t = t.replace(/[ \u00a0]/g, '');
  t = t.replace(/^[.,]+|[.,]+$/g, '');
  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  let out: string;
  if (lastComma !== -1 && lastDot !== -1) {
    // both separators present: the right-most one is the decimal separator
    if (lastComma > lastDot) out = t.replace(/\./g, '').replace(',', '.');
    else out = t.replace(/,/g, '');
  } else if (lastComma !== -1) {
    const dec = t.length - lastComma - 1;
    const commas = (t.match(/,/g) || []).length;
    out = commas > 1 || dec === 3 ? t.replace(/,/g, '') : t.replace(',', '.');
  } else if (lastDot !== -1) {
    const dec = t.length - lastDot - 1;
    const dots = (t.match(/\./g) || []).length;
    out = dots > 1 || dec === 3 ? t.replace(/\./g, '') : t;
  } else out = t;
  const n = Number(out);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

function fixYear(y: number): number {
  if (y >= 1000) return y;
  return y < 70 ? 2000 + y : 1900 + y;
}

// ── date parsing: multi-format, day/month order resolved by `order` when ambiguous
export function tryParseDate(raw: string, order: DateOrder): { y: number; m: number; d: number } | null {
  if (!raw) return null;
  const t = raw.trim().replace(/[.,]+$/, '');
  let m = t.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] }; // ISO
  m = t.match(/^(\d{1,2})[- ]([A-Za-z]{3,9})[- ](\d{2,4})$/);
  if (m) { const mo = MONTH_NAMES[m[2].toLowerCase()]; if (mo) return { y: fixYear(+m[3]), m: mo, d: +m[1] }; }
  m = t.match(/^([A-Za-z]{3,9})[- ](\d{1,2}),?[- ](\d{2,4})$/);
  if (m) { const mo = MONTH_NAMES[m[1].toLowerCase()]; if (mo) return { y: fixYear(+m[3]), m: mo, d: +m[2] }; }
  m = t.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);
  if (m) {
    const a = +m[1], b = +m[2], y = fixYear(+m[3]);
    if (a > 12 && b <= 12) return { y, m: b, d: a }; // proven DD/MM
    if (b > 12 && a <= 12) return { y, m: a, d: b }; // proven MM/DD
    return order === 'dmy' ? { y, m: b, d: a } : { y, m: a, d: b };
  }
  return null;
}

export function isDateLike(tok: string): boolean {
  return tryParseDate(tok, 'dmy') !== null || tryParseDate(tok, 'mdy') !== null;
}

function toISO({ y, m, d }: { y: number; m: number; d: number }): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ── CSV ─────────────────────────────────────────────────────────
export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 5).join('\n');
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let inQ = false;
  for (const ch of sample) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : ',';
}

export function parseCSV(text: string): string[][] {
  const delim = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

// ── column detection: header keywords first, then pure structure ──
const RX = {
  date: /date|posted|value\s*dt|txn/i,
  desc: /narration|description|particulars|details|remarks|label|payee|merchant|info|transaction/i,
  credit: /credit|deposit|deposits|received|cr\b|deposit|receipt|incoming|pay[in]?|payment\s*in/i,
  debit: /debit|withdrawal|withdrawals|paid|spent|dr\b|withdrawal|payment\s*out|outgoing|charge|expense/i,
  balance: /balance|\bbal\b/i,
  ref: /ref|utr|rrn|txns?id|reference|chq|cheque|serial/i,
};

const emptyProfile = (): ColumnProfile => ({ dateIdx: -1, descIdx: -1, creditIdx: -1, debitIdx: -1, balanceIdx: -1, refIdx: -1 });

/**
 * Heuristically find the column that is most likely the balance:
 * - Has the largest median absolute value
 * - Values are mostly monotonic (optional)
 * Returns the index, or -1 if not found.
 */
function findBalanceColumn(dataRows: string[][], numericCols: number[]): number {
  if (numericCols.length < 2) return -1;
  let bestIdx = -1;
  let bestScore = -Infinity;
  for (const idx of numericCols) {
    const values = dataRows.map(r => parseAmount(r[idx] || '')).filter(v => v !== null && v !== 0) as number[];
    if (values.length < 2) continue;
    const absVals = values.map(Math.abs);
    const median = absVals.sort((a,b) => a-b)[Math.floor(absVals.length/2)];
    // Score: high median absolute value (balance often larger than transaction)
    // Also prefer columns where values are mostly positive (or mostly negative)
    const posRatio = values.filter(v => v > 0).length / values.length;
    const signConsistency = Math.max(posRatio, 1 - posRatio);
    const score = median * signConsistency;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  }
  return bestIdx;
}

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

function isAmountCell(v: string): boolean {
  const t = v.trim();
  return t !== '' && parseAmount(t) !== null && /\d/.test(t) && !isDateLike(t) && t.replace(/\D/g, '').length <= 12;
}

export function detectColumns(allRows: string[][]): ColumnDetection | null {
  if (allRows.length === 0) return null;
  // 1) header-based mapping
  for (let h = 0; h < Math.min(allRows.length, 15); h++) {
    const row = allRows[h];
    if (!row.some(c => RX.date.test(c))) continue;
    const p = emptyProfile();
    row.forEach((c, i) => {
      if (RX.date.test(c) && p.dateIdx === -1) p.dateIdx = i;
      else if (RX.desc.test(c) && p.descIdx === -1) p.descIdx = i;
      else if (RX.balance.test(c) && p.balanceIdx === -1) p.balanceIdx = i;
      else if (RX.ref.test(c) && p.refIdx === -1) p.refIdx = i;
      else if (RX.credit.test(c) && p.creditIdx === -1) p.creditIdx = i;
      else if (RX.debit.test(c) && p.debitIdx === -1) p.debitIdx = i;
    });
    if (p.dateIdx !== -1 && p.creditIdx !== -1 && p.debitIdx !== -1) {
      return { profile: p, usedHeaders: true, hasBalance: p.balanceIdx !== -1, layoutKey: fnv(`h${p.dateIdx}-${p.descIdx}-${p.creditIdx}-${p.debitIdx}-${p.balanceIdx}-${p.refIdx}`) };
    }
  }
  // 2) structural inference (no usable headers)
  const width = Math.max(...allRows.map(r => r.length));
  const dataRows = allRows.filter(r => r.some(c => isDateLike(c.trim())) && r.some(c => isAmountCell(c)));
  if (dataRows.length < 1) return null;
  const dateScore = Array.from({ length: width }, (_, i) => dataRows.filter(r => isDateLike((r[i] || '').trim())).length / dataRows.length);
  const dateIdx = dateScore.indexOf(Math.max(...dateScore));
  if (dateScore[dateIdx] < 0.6) return null;
  // A column is numeric if most of its non-empty cells parse as amounts —
  // fill-ratio is NOT used, because credit columns are naturally sparse.
  const nonEmpty = Array.from({ length: width }, (_, i) => dataRows.filter(r => (r[i] || '').trim() !== '').length);
  const amtCount = Array.from({ length: width }, (_, i) => dataRows.filter(r => isAmountCell((r[i] || '').trim())).length);
  const numericCols: number[] = [];
  for (let i = 0; i < width; i++) {
    if (i === dateIdx) continue;
    // Require at least 2 valid amounts and that at least 50% of non-empty cells are amounts
    if (amtCount[i] >= 2 && (nonEmpty[i] === 0 || amtCount[i] / nonEmpty[i] >= 0.5)) {
      numericCols.push(i);
    }
  }
  let descIdx = -1, bestLen = 0;
  for (let i = 0; i < width; i++) {
    if (i === dateIdx || numericCols.includes(i)) continue;
    const avg = dataRows.reduce((s, r) => s + (r[i] || '').trim().length, 0) / dataRows.length;
    if (avg > bestLen) { bestLen = avg; descIdx = i; }
  }
  const val = (r: string[], i: number) => (i >= 0 && i < r.length ? parseAmount(r[i]) || 0 : 0);
  const profile = emptyProfile();
  profile.dateIdx = dateIdx;
  profile.descIdx = descIdx;
  // try (credit, debit, balance) combos scored by balance-delta arithmetic
  let best = { score: -1, c: -1, d: -1, b: -1 };
  if (numericCols.length >= 2 && numericCols.length <= 6) {
    for (const c of numericCols) for (const d of numericCols) {
      if (c === d) continue;
      for (const b of [...numericCols, -1]) {
        if (b === c || b === d) continue;
        let match = 0, total = 0;
        for (let i = 1; i < dataRows.length; i++) {
          const delta = val(dataRows[i], b) - val(dataRows[i - 1], b);
          const flow = val(dataRows[i], c) - val(dataRows[i], d);
          if (val(dataRows[i], c) === 0 && val(dataRows[i], d) === 0) continue;
          total++;
          if (Math.abs(delta - flow) < 0.01) match++;
        }
        const score = total > 0 ? match / total : -1;
        if (score > best.score) best = { score, c, d, b };
      }
    }
  }
  if (best.score >= 0.7) {
    profile.creditIdx = best.c;
    profile.debitIdx = best.d;
    profile.balanceIdx = best.b;
    return { profile, usedHeaders: false, hasBalance: best.b !== -1, layoutKey: fnv(`s${dateIdx}-${descIdx}-${best.c}-${best.d}-${best.b}`) };
  }
  // No reliable balance: try to identify credit/debit columns from headers, then markers, then heuristics
  let crCol = -1, drCol = -1;
  
  // 1) Try to find credit/debit columns using header keywords (if not already done)
  //    Scan the first few rows (same as header detection but without requiring date)
  const headerLimit = Math.min(allRows.length, 15);
  for (let h = 0; h < headerLimit && (crCol === -1 || drCol === -1); h++) {
    const row = allRows[h];
    row.forEach((cell, i) => {
      if (RX.credit.test(cell) && crCol === -1 && numericCols.includes(i)) crCol = i;
      if (RX.debit.test(cell) && drCol === -1 && numericCols.includes(i)) drCol = i;
    });
  }

  // 2) If headers didn't work, use Cr/Dr markers in the description column
  if (crCol === -1 || drCol === -1) {
    for (const r of dataRows) {
      const desc = (r[descIdx] || '').toLowerCase();
      const isCr = /\bcr\b|\bcredit\b/.test(desc), isDr = /\bdr\b|\bdebit\b/.test(desc);
      if (!isCr && !isDr) continue;
      for (const i of numericCols) {
        if (parseAmount(r[i] || '') == null) continue;
        if (isCr && crCol === -1) crCol = i;
        if (isDr && drCol === -1) drCol = i;
      }
    }
  }

    // 3) If we have both distinct columns, use them
  if (crCol !== -1 && drCol !== -1 && crCol !== drCol) {
    profile.creditIdx = crCol;
    profile.debitIdx = drCol;
  } else {
    // 4) Heuristic: decide based on the number of numeric columns
    if (numericCols.length === 2) {
      // Exactly two numeric columns: assume they are credit and debit
      profile.creditIdx = numericCols[0];
      profile.debitIdx = numericCols[1];
    } else {
      // More than 2: try to exclude the balance column
      const balanceCandidate = findBalanceColumn(dataRows, numericCols);
      const candidates = numericCols.filter(i => i !== balanceCandidate);
      if (candidates.length >= 2) {
        profile.creditIdx = candidates[0];
        profile.debitIdx = candidates[1];
      } else if (candidates.length === 1) {
        profile.creditIdx = candidates[0];
        profile.debitIdx = -1;
      } else if (numericCols.length >= 2) {
        // fallback to first two if excluding balance failed
        profile.creditIdx = numericCols[0];
        profile.debitIdx = numericCols[1];
      } else if (numericCols.length === 1) {
        profile.creditIdx = numericCols[0];
        profile.debitIdx = -1;
      } else return null;
    }
  }

  return { profile, usedHeaders: false, hasBalance: false, layoutKey: fnv(`m${dateIdx}-${descIdx}-${profile.creditIdx}-${profile.debitIdx}`) };
}

// ── rows -> transactions ────────────────────────────────────────
export function rowsToTxns(rows: string[][],p: ColumnProfile,order: DateOrder,hasBalance: boolean = false): ParsedTxn[] {
  const out: ParsedTxn[] = [];
  let previousBalance: number | null = null;
  for (const r of rows) {
    const d = tryParseDate((r[p.dateIdx] || '').trim(), order);
    if (!d) continue;
    const desc = (p.descIdx >= 0 ? r[p.descIdx] || '' : '').trim().replace(/\s+/g, ' ');
    let direction: Direction | null = null;
    let amount = 0;
    const cr = p.creditIdx >= 0 ? parseAmount(r[p.creditIdx] || '') : null;
    const dr = p.debitIdx >= 0 ? parseAmount(r[p.debitIdx] || '') : null;
    // Primary: use separate credit and debit columns if available
    if (cr != null && cr > 0) { direction = 'credit'; amount = cr; }
    else if (dr != null && dr > 0) { direction = 'debit'; amount = dr; }
    else if (cr != null && dr != null && cr < 0) { direction = 'debit'; amount = -cr; }
    else if (cr != null && dr != null && dr < 0) { direction = 'credit'; amount = -dr; }
    
    // Fallback: single column with sign and/or description markers
    if (!direction) {
      let singleIdx = -1;
      if (p.creditIdx >= 0 && p.debitIdx === -1) singleIdx = p.creditIdx;
      else if (p.debitIdx >= 0 && p.creditIdx === -1) singleIdx = p.debitIdx;
      if (singleIdx !== -1) {
        const amt = parseAmount(r[singleIdx] || '');
        if (amt !== null && amt !== 0) {
          const desc = p.descIdx >= 0 ? (r[p.descIdx] || '').toLowerCase() : '';
          const hasCr = /\bcr\b|\bcredit\b/.test(desc);
          const hasDr = /\bdr\b|\bdebit\b/.test(desc);
          if (amt < 0) {
            if (hasDr) { direction = 'debit'; amount = -amt; }
            else if (hasCr) { direction = 'credit'; amount = -amt; }
            else { direction = 'debit'; amount = -amt; } // default: negative is debit (more common)
          } else {
            // Positive amount
            if (hasDr) { direction = 'debit'; amount = amt; }
            else if (hasCr) { direction = 'credit'; amount = amt; }
            else { direction = 'credit'; amount = amt; } // default: positive as credit
          }
        }
      }
    }
        // --- Balance verification (if balance column exists) ---
    if (hasBalance && p.balanceIdx >= 0) {
      const balanceStr = r[p.balanceIdx] || '';
      const balance = parseAmount(balanceStr);
      if (balance !== null && previousBalance !== null) {
        // Compute expected net change: previousBalance - currentBalance (if balance decreases with debits)
        // OR currentBalance - previousBalance (if balance increases with credits)
        const delta1 = previousBalance - balance; // positive means debit (if balance goes down)
        const delta2 = balance - previousBalance; // positive means credit
        let expectedDir: Direction | null = null;
        let expectedAmt = 0;
        if (Math.abs(delta1) > 0.01 && Math.abs(delta1 - amount) < 0.01) {
          // delta1 matches the detected amount
          expectedDir = delta1 > 0 ? 'debit' : 'credit';
          expectedAmt = Math.abs(delta1);
        } else if (Math.abs(delta2) > 0.01 && Math.abs(delta2 - amount) < 0.01) {
          expectedDir = delta2 > 0 ? 'credit' : 'debit';
          expectedAmt = Math.abs(delta2);
        }
        if (expectedDir && expectedAmt > 0) {
          // If the detected direction/amount differs, we override
          if (direction !== expectedDir || Math.abs(amount - expectedAmt) > 0.01) {
            // Try using the other amount column (if both credit and debit columns exist)
            let alternativeAmount = 0;
            let alternativeDir: Direction | null = null;
            if (p.creditIdx >= 0 && p.debitIdx >= 0 && p.creditIdx !== p.debitIdx) {
              const altCr = p.creditIdx >= 0 ? parseAmount(r[p.creditIdx] || '') : null;
              const altDr = p.debitIdx >= 0 ? parseAmount(r[p.debitIdx] || '') : null;
              if (altCr != null && altCr > 0 && Math.abs(altCr - expectedAmt) < 0.01) {
                alternativeDir = 'credit';
                alternativeAmount = altCr;
              } else if (altDr != null && altDr > 0 && Math.abs(altDr - expectedAmt) < 0.01) {
                alternativeDir = 'debit';
                alternativeAmount = altDr;
              }
            }
            if (alternativeDir && alternativeAmount > 0) {
              direction = alternativeDir;
              amount = alternativeAmount;
            } else {
              // If no alternative matches, we trust the expected direction from balance
              direction = expectedDir;
              amount = expectedAmt;
            }
          }
        }
        // Update previous balance for next row
        previousBalance = balance;
      } else if (balance !== null) {
        // First row: just store the balance
        previousBalance = balance;
      }
    }
    if (!direction || amount <= 0) continue;
    const dateISO = toISO(d);
    const refRaw = p.refIdx >= 0 ? r[p.refIdx] || '' : '';
    const refId = normalizeRef(refRaw) || undefined;
    out.push({
      id: '',
      refId,
      hash: txnHash(dateISO, amount, direction, desc),
      dateISO,
      amount,
      direction,
      description: desc || 'Statement entry',
      monthIndex: d.m - 1,
      yearHint: d.y,
      source: 'statement',
    });
  }

    // Optional: sanity check using total balance change
  if (hasBalance && out.length > 0 && p.balanceIdx >= 0) {
    const firstBalance = parseAmount(rows[0][p.balanceIdx] || '');
    const lastBalance = parseAmount(rows[rows.length-1][p.balanceIdx] || '');
    if (firstBalance !== null && lastBalance !== null) {
      const totalCredits = out.filter(t => t.direction === 'credit').reduce((s, t) => s + t.amount, 0);
      const totalDebits = out.filter(t => t.direction === 'debit').reduce((s, t) => s + t.amount, 0);
      const netChange = totalCredits - totalDebits;
      const balanceChange = lastBalance - firstBalance;
      if (Math.abs(netChange - balanceChange) > 1) {
        console.warn('Global balance mismatch:', { netChange, balanceChange });
      }
    }
  }
    // Deduplicate transactions based on hash
  const seen = new Set<string>();
  const unique: ParsedTxn[] = [];
  for (const txn of out) {
    if (!seen.has(txn.hash)) {
      seen.add(txn.hash);
      unique.push(txn);
    }
  }
  return unique;
}

export function parseCsvStatement(text: string, order: DateOrder): { txns: ParsedTxn[]; detection: ColumnDetection | null } {
  const rows = parseCSV(text);
  const detection = detectColumns(rows);
  if (!detection) return { txns: [], detection: null };
  return { txns: rowsToTxns(rows, detection.profile, order, detection.hasBalance), detection };
}

export async function parsePdfStatement(
  data: ArrayBuffer,
  order: DateOrder,
  password?: string
): Promise<{ txns: ParsedTxn[]; detection: ColumnDetection | null }> {
  const rows = await extractTextFromPdf(data, password);
  if (rows.length === 0) return { txns: [], detection: null };
  return parseStatementLines(rows, order);
}

// ── PDF text -> transactions ────────────────────────────────────

export function parseStatementLines(
  rows: string[][],
  order: DateOrder
): { txns: ParsedTxn[]; detection: ColumnDetection | null } {
  const detection = detectColumns(rows);
  if (!detection) {
    return { txns: [], detection: null };
  }
  const txns = rowsToTxns(rows, detection.profile, order, detection.hasBalance);
  return { txns, detection };
}

// ── PDF text extraction (pdf.js, lazily imported) ───────────────
export async function extractTextFromPdf(
  data: ArrayBuffer,
  password?: string
): Promise<string[][]> {
  const pdfjs = await import('pdfjs-dist');
  const PdfWorker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?worker')).default;
  pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();

  let doc;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(data),
      password: password || undefined,
      isEvalSupported: false,
    }).promise;
  } catch (err: unknown) {
    const e = err as { name?: string; code?: number };
    if (e?.name === 'PasswordException') {
      throw new Error(e.code === 2 ? 'WRONG_PASSWORD' : 'NEED_PASSWORD');
    }
    throw err;
  }

  // Collect all text items with positions
  const allItems: { x: number; y: number; str: string; width: number; height: number }[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();

    for (const item of content.items as unknown as { str: string; transform: number[]; width: number; height: number }[]) {
      if (!item.str || !item.str.trim()) continue;
      const [x, y] = [item.transform[4], item.transform[5]];
      allItems.push({
        x,
        y,
        str: item.str.trim(),
        width: item.width || 0,
        height: item.height || 0,
      });
    }
  }

  if (allItems.length === 0) return [];

  // Group by Y (rows) with dynamic tolerance based on median height
  const sortedByY = [...allItems].sort((a, b) => a.y - b.y);
  const heights = sortedByY.map(i => i.height).filter(h => h > 0);
  const medianHeight = heights.length > 0 ? heights[Math.floor(heights.length / 2)] : 10;
  const tolerance = Math.max(medianHeight * 0.3, 2);

  const rows: { y: number; items: typeof allItems }[] = [];
  for (const item of sortedByY) {
    let found = false;
    for (const row of rows) {
      if (Math.abs(item.y - row.y) <= tolerance) {
        row.items.push(item);
        found = true;
        break;
      }
    }
    if (!found) {
      rows.push({ y: item.y, items: [item] });
    }
  }

  // For each row, group items by X (columns) with overlap tolerance
  // For each row, group items by X (columns) with actual width-based overlap
  const table: string[][] = [];
  for (const row of rows) {
    const sortedItems = row.items.sort((a, b) => a.x - b.x);
    const columns: { x: number; maxRight: number; texts: string[] }[] = [];
    for (const item of sortedItems) {
      const itemRight = item.x + item.width;
      let merged = false;
      for (const col of columns) {
        // If this item overlaps horizontally with the column, merge it
        if (item.x <= col.maxRight + 2) { // 2px tolerance
          col.texts.push(item.str);
          col.maxRight = Math.max(col.maxRight, itemRight);
          merged = true;
          break;
        }
      }
      if (!merged) {
        columns.push({ x: item.x, maxRight: itemRight, texts: [item.str] });
      }
    }
    const rowCells = columns.map(col => col.texts.join(' ').trim());
    table.push(rowCells);
  }

  return table;
}
