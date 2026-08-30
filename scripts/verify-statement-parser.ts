// Temporary verification script — simulates the x-aware extractTextFromPdf output
// for the user's sample statement, then runs the full parse pipeline.
import { parseStatementLines, prepareForInsert, mergeMultilineRows, type DateOrder } from '../src/utils/statementParser.ts';

// Simulated PDF lines with x-positions (matching a typical statement layout):
// DATE(x=40) MODE(x=110) PARTICULARS(x=170) DEPOSITS(x=400) WITHDRAWALS(x=480) BALANCE(x=560)
function line(y: number, cells: [number, string][]): { y: number; cells: [number, string][] } {
  return { y, cells };
}

const simulatedRows: string[][] = [
  // Header row (6 columns from x-mapping)
  ['DATE', 'MODE', 'PARTICULARS', 'DEPOSITS', 'WITHDRAWALS', 'BALANCE'],
  // Txn 1: deposit 60.00 — date on own line, then continuation lines
  ['24-07-2026', '', '', '', '', ''],
  ['', '', '9310066749ptyes', '', '', ''],
  ['', '', 'UPI/9310066749/9310066749@pty/Payment fr/State', '', '', ''],
  ['', '', 'Bank/667440231809/YBLa1a5a38f425f48e8b49121e06830df 54', '', '', ''],
  ['', '', '', '60.00', '', '1,438.64'],
  // Txn 2: withdrawal 60.00 — deposits column empty.
  // NOTE: the description line's 12-digit UTR fragment lands in the
  // WITHDRAWALS column (simulating an x-overlap misassignment) — the parser
  // must NOT treat it as the withdrawal amount.
  ['24-07-2026', '', '', '', '', ''],
  ['', '', 'VIAGGIO SERVICES PRIVATE LIMITED', '', '', ''],
  ['', '', 'UPI/VIAGGIO SE/BHARATPE.80013/Payment fr/FEDERAL', '988280622939', '', ''],
  ['', '', '', '', '60.00', '1,378.64'],
  // Txn 3: deposit 5,000.00
  ['25-07-2026', '', '', '', '', ''],
  ['', '', 'SHAHNAZ KHAN', '', '', ''],
  ['', '', 'UPI/SHAHNAZ KH/9406954607@ybl/Payment fr/HDFC BANK/596735614659/YBLbf67 2a', '', '', ''],
  ['', '', '', '5,000.00', '', '6,378.64'],
];

const result = parseStatementLines(mergeMultilineRows(simulatedRows), 'dmy' as DateOrder);

console.log('=== Detected columns ===');
if (result.detection) {
  console.log({
    dateIdx: result.detection.profile.dateIdx,
    descIdx: result.detection.profile.descIdx,
    creditIdx: result.detection.profile.creditIdx,
    debitIdx: result.detection.profile.debitIdx,
    balanceIdx: result.detection.profile.balanceIdx,
    usedHeaders: result.detection.usedHeaders,
    hasBalance: result.detection.hasBalance,
  });
}

console.log('\n=== Transactions ===');
for (const t of result.txns) {
  console.log(`${t.dateISO}  ${t.direction.toUpperCase().padEnd(6)} ${t.amount.toFixed(2).padStart(9)}  ${t.description.slice(0, 50)}`);
}

console.log('\n=== Balance check ===');
console.log(result.balanceCheck);

console.log('\n=== Errors ===');
console.log(result.errors.length ? result.errors : '(none)');

console.log('\n=== prepareForInsert (ids assigned) ===');
const final = prepareForInsert(result.txns);
console.log(final.map(t => `${t.id}: ${t.direction} ${t.amount}`));

// Assertions
const credits = result.txns.filter(t => t.direction === 'credit');
const debits = result.txns.filter(t => t.direction === 'debit');
let pass = true;
function assert(cond: boolean, msg: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`);
  if (!cond) pass = false;
}
assert(result.txns.length === 3, `3 transactions parsed (got ${result.txns.length})`);
assert(credits.length === 2, `2 credits (got ${credits.length})`);
assert(debits.length === 1, `1 debit (got ${debits.length}) — THE FIX`);
assert(debits[0]?.amount === 60, 'debit amount is 60.00');
assert(result.balanceCheck?.isValid === true, 'balance sheet check passes');
assert(Math.abs((result.balanceCheck?.openingBalance ?? 0) - 1378.64) < 0.01, 'opening balance = 1378.64');
assert(debits[0]?.amount === 60 && debits[0].amount <= 999999999, `debit NOT polluted (got ${debits[0]?.amount})`);
assert(result.balanceCheck && Math.abs(result.balanceCheck.totalWithdrawals - 60) < 0.01, `total withdrawals = 60 (got ${result.balanceCheck?.totalWithdrawals})`);

process.exit(pass ? 0 : 1);

