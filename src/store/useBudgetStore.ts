import { useState, useEffect, useCallback } from 'react';

import { generateInsights, generateAnnualInsights, CoachInsight, CoachSettings, defaultCoachSettings } from '../coachEngine';
import { svgGroupedBars, svgLineChart } from '../utils/reportCharts';

export interface DataEntry {
  id: string;
  name: string;
  values: number[];
  recurring?: 'none' | 'monthly' | 'quarterly' | 'annual';
  essential?: boolean; // user-marked essential (protected from Interceptor cut suggestions)
  createdAt: string;
  modifiedAt: string;
}

export interface AuditEntry {
  id: string;
  action: 'add' | 'edit' | 'delete' | 'rename';
  section: string;
  entryName: string;
  oldValue?: string;
  newValue?: string;
  monthIndex?: number;
  timestamp: string;
}

export interface DebtMeta {
  debtId: string;
  name: string;
  interestRate: number;
  emiAmount: number;
  originalPrincipal: number;
  startMonthIndex: number;
}

export interface TaxEntry {
  id: string;
  name: string;
  category: 'ppf' | 'elss' | 'nps' | 'sukanya' | 'insurance' | 'fd' | 'other';
  values: number[];
  limit: number;
  createdAt: string;
  modifiedAt: string;
}

export interface ImportRule {
  match: string; // case-insensitive substring of the transaction description
  section: 'incomeEntries' | 'householdExpenses' | 'savingsData' | 'debtRepayment';
  entryId: string;
}

export interface YearData {
  year: string;
  months: string[];
  incomeEntries: DataEntry[];
  outgoingEntries: DataEntry[];
  allocationEntries: DataEntry[];
  statusEntries: DataEntry[];
  remarks: Record<string, Record<string, string>>;
  householdExpenses: DataEntry[];
  debtRepayment: DataEntry[];
  savingsData: DataEntry[];
  debtProgression: DataEntry[];
  debtMeta: DebtMeta[];
  taxShieldEntries: TaxEntry[];
  windfallBaseline: number;
  auditLog: AuditEntry[];
  createdAt: string;
  modifiedAt: string;
  pendingTxns: ParsedTxn[];      // statement rows awaiting user confirmation
  importedStatementMonths: string[]; // "YYYY-M" months that have had a transaction confirmed (month-level import lock)
  processedTxnHashes: string[];  // dedupe for already-imported/ignored transactions (content-hash fallback)
  processedTxnIds: string[];     // dedupe by bank reference / UTR / RRN when present (primary)
  importRules: ImportRule[];     // remembered description -> row mappings
  familySync: FamilySync;
  coachInsights: CoachInsight[];
  coachSettings: CoachSettings;
}

export interface BudgetState {
  years: Record<string, YearData>;
  activeYear: string;
  availableYears: string[];
  passcode: string | null;
  setupChoiceDone: boolean;
}

export interface DebtSimulatorResult {
  strategy: 'snowball' | 'avalanche';
  totalMonths: number;
  totalInterest: number;
  totalPrincipal: number;
  schedule: { month: number; debtName: string; payment: number; balance: number }[];
}

export interface ExtraPaymentImpact {
  debtId: string;
  debtName: string;
  monthsSaved: number;
  interestSaved: number;
  newPayoffMonths: number;
  baselineMonths: number;
}

export interface TaxShieldStatus {
  filled: number;
  gap: number;
  limit: number;
  pct: number;
  monthlySipNeeded: number;
  monthsRemaining: number;
  entries: { name: string; value: number; category: string }[];
}

export interface WindfallResult {
  extraIncome: number;
  toSavings: number;
  toHousehold: number;
  toDebt: number;
  monthIndex: number;
}

export interface YearComparison {
  year: string;
  totalIncome: number;
  totalHousehold: number;
  totalSavings: number;
  totalDebtPaid: number;
  incomeGrowthPct: number;
  expenseCreepPct: number;
}

export interface InterceptorStatus {
  shouldBlock: boolean;
  streak: number;
  suggestions: { name: string; annualTotal: number; monthlyAvg: number }[];
}

// â”€â”€â”€ Phase 5: Family Sync â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface SharedExpense {
  id: string;
  name: string;
  amount: number;
  monthIndex: number;
  partner: string;
  timestamp: string;
}

export interface FamilySync {
  enabled: boolean;
  partnerName: string;
  sharedExpenses: SharedExpense[];
  noSpendStreak: number;
  lastNoSpendDate: string | null;
  partnerStreak: number;
}

export interface NoSpendStatus {
  streak: number;
  partnerStreak: number;
  combined: number;
  todaySpent: boolean;
}

export interface SyncPayload {
  householdExpenses: { name: string; values: number[] }[];
  noSpendStreak: number;
  partnerName: string;
  timestamp: string;
  checksum: string;
}

const STORAGE_KEY = 'babylonian-heron-data-v6';
const MONTHS_12 = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
const now = () => new Date().toISOString();

// ─── Auto-derived remarks (status badges) ────────────────────────
// Remarks drive the status badges, disaster/recovery streaks and the
// Hand-to-Mouth Interceptor. They are re-derived from live data whenever
// the underlying numbers change, so they can never go stale.
type Remarks = Record<string, Record<string, string>>;
function deriveRemarksForMonth(y: YearData, monthIndex: number): Remarks {
  const sum = (arr: DataEntry[], m: number) => arr.reduce((sm, e) => sm + (e.values[m] || 0), 0);
  const income = sum(y.incomeEntries, monthIndex);
  const household = sum(y.householdExpenses, monthIndex);
  const debt = sum(y.debtRepayment, monthIndex);
  const savings = sum(y.savingsData, monthIndex);
  const cap = y.allocationEntries.find(e => e.id === 'house70')?.values[monthIndex] || 0;
  const pct = cap > 0 ? (household / cap) * 100 : 0;
  const house70 = cap <= 0 ? 'IN CONTROL'
    : pct >= 100 ? 'BROKEN'
    : pct >= 85 ? 'DISASTER IN MAKING'
    : pct >= 60 ? 'WATCH OUT'
    : pct >= 30 ? 'IN CONTROL'
    : 'BRAVO!';
  const saveTarget = Math.round(income * 0.10);
  const saving10 = income <= 0 ? 'RETAINER' : savings < saveTarget ? 'HAND TO MOUTH' : 'RETAINER';
  const debtTarget = Math.round(income * 0.20);
  const debt20 = income <= 0 ? 'IN CONTROL' : debt > 0 && debt >= debtTarget ? 'BRAVO!' : debt > 0 ? 'IN CONTROL' : 'PENDING';
  return {
    ...y.remarks,
    saving10: { ...y.remarks.saving10, [String(monthIndex)]: saving10 },
    house70: { ...y.remarks.house70, [String(monthIndex)]: house70 },
    debt20: { ...y.remarks.debt20, [String(monthIndex)]: debt20 },
  };
}
function deriveRemarksForYear(y: YearData): Remarks {
  let remarks: Remarks = y.remarks;
  for (let m = 0; m < 12; m++) remarks = deriveRemarksForMonth({ ...y, remarks }, m);
  return remarks;
}
const REMARK_SECTIONS: (keyof YearData)[] = ['householdExpenses', 'incomeEntries', 'debtRepayment', 'savingsData'];

// â”€â”€â”€ Passcode hashing (synchronous, avoids storing plaintext) â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Implementation lives in ../utils/sha256 so it can be unit-tested in isolation.
import { hashPasscode } from '../utils/sha256';
import type { ParsedTxn } from '../utils/statementParser';
const PASSCODE_SALT = 'babylonian-heron::v1::';
function saltedHash(code: string): string {
  return hashPasscode(PASSCODE_SALT + code);
}

function createEmptyYear(year: string): YearData {
  const ts = now();
  return {
    year,
    months: [...MONTHS_12],
    incomeEntries: [], // user adds their own income sources
    outgoingEntries: [
      { id: 'saving10', name: '10% - SAVING', values: new Array(12).fill(0), recurring: 'none', createdAt: ts, modifiedAt: ts },
      { id: 'house70', name: '70% - HOUSEHOLD', values: new Array(12).fill(0), recurring: 'none', createdAt: ts, modifiedAt: ts },
      { id: 'debt20', name: '20% - DEBT', values: new Array(12).fill(0), recurring: 'none', createdAt: ts, modifiedAt: ts },
    ],
    allocationEntries: [
      { id: 'saving10', name: '10% - SAVING', values: new Array(12).fill(0), recurring: 'none', createdAt: ts, modifiedAt: ts },
      { id: 'house70', name: '70% - HOUSEHOLD', values: new Array(12).fill(0), recurring: 'none', createdAt: ts, modifiedAt: ts },
      { id: 'debt20', name: '20% - DEBT', values: new Array(12).fill(0), recurring: 'none', createdAt: ts, modifiedAt: ts },
    ],
    statusEntries: [
      { id: 'saving10', name: '10% - SAVING', values: new Array(12).fill(0), recurring: 'none', createdAt: ts, modifiedAt: ts },
      { id: 'house70', name: '70% - HOUSEHOLD', values: new Array(12).fill(0), recurring: 'none', createdAt: ts, modifiedAt: ts },
      { id: 'debt20', name: '20% - DEBT', values: new Array(12).fill(0), recurring: 'none', createdAt: ts, modifiedAt: ts },
    ],
    remarks: {
      saving10: Object.fromEntries(MONTHS_12.map((_, i) => [String(i), 'RETAINER'])),
      house70: Object.fromEntries(MONTHS_12.map((_, i) => [String(i), 'IN CONTROL'])),
      debt20: Object.fromEntries(MONTHS_12.map((_, i) => [String(i), 'IN CONTROL'])),
    },
    householdExpenses: [], // user adds their own expense categories
    debtRepayment: [], // user adds their own EMIs
    savingsData: [], // user adds their own savings instruments
    debtProgression: [], // user adds their own debts
    debtMeta: [], // paired debtMeta rows are created with each debt entry
    taxShieldEntries: [], // user adds their own tax instruments
    pendingTxns: [],
    importedStatementMonths: [],
    processedTxnHashes: [],
    processedTxnIds: [],
    importRules: [],
    familySync: { enabled: false, partnerName: '', sharedExpenses: [], noSpendStreak: 0, lastNoSpendDate: null, partnerStreak: 0 },
    windfallBaseline: 0,
    auditLog: [],
    createdAt: ts,
    modifiedAt: ts,
    coachInsights: [],
    coachSettings: defaultCoachSettings, 
  };
}

// A brand-new state with NO prefilled numbers: every section starts empty and
// the user adds their own income, expenses, debts, EMIs, savings and tax rows.
function createFreshState(setupChoiceDone: boolean): BudgetState {
  const nowYear = String(new Date().getFullYear());
  const nextYear = String(new Date().getFullYear() + 1);
  return {
    years: { [nowYear]: createEmptyYear(nowYear), [nextYear]: createEmptyYear(nextYear) },
    activeYear: nowYear,
    availableYears: [nowYear, nextYear],
    passcode: null,
    setupChoiceDone,
  };
}

function migrateV2ToV3(state: any): BudgetState {
  if (!state || !state.years) return createFreshState(true);
  for (const year of Object.keys(state.years)) {
    const y = state.years[year];
    if (!y) continue;
    const sections: (keyof YearData)[] = ['incomeEntries','outgoingEntries','allocationEntries','statusEntries','householdExpenses','debtRepayment','savingsData','debtProgression'];
    for (const sec of sections) {
      if (!y[sec]) continue;
      for (const entry of y[sec]) {
        if (!entry.recurring) entry.recurring = 'none';
      }
    }
    if (!y.debtMeta) y.debtMeta = [];
  }
  if (!state.passcode && 'passcode' in state === false) state.passcode = null;
  return state as BudgetState;
}

function migrateV3ToV4(state: any): BudgetState {
  if (!state || !state.years) return createFreshState(true);
  const ts = now();
  for (const year of Object.keys(state.years)) {
    const y = state.years[year];
    if (!y) continue;
    if (!y.taxShieldEntries) y.taxShieldEntries = [];
    if (typeof y.windfallBaseline !== 'number') y.windfallBaseline = 0;
  }
  return state as BudgetState;
}

function migrateV4ToV5(state: any): BudgetState {
  if (!state || !state.years) return createFreshState(true);
  for (const year of Object.keys(state.years)) {
    const y = state.years[year];
    if (!y) continue;
    if (!y.familySync) {
      y.familySync = { enabled: false, partnerName: '', sharedExpenses: [], noSpendStreak: 0, lastNoSpendDate: null, partnerStreak: 0 };
    }
      if (!Array.isArray(y.pendingTxns)) y.pendingTxns = [];
      if (!Array.isArray(y.importedStatementMonths)) y.importedStatementMonths = [];
      if (!Array.isArray(y.processedTxnHashes)) y.processedTxnHashes = [];
      if (!Array.isArray(y.processedTxnIds)) y.processedTxnIds = [];
      if (!Array.isArray(y.importRules)) y.importRules = [];
  }
  return state as BudgetState;
}

function loadState(): BudgetState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const migrated = migrateV4ToV5(parsed);
      if (typeof migrated.setupChoiceDone !== 'boolean') migrated.setupChoiceDone = true;
      return migrated;
    }
    // Older app versions: bring stored data forward so the user can choose
    // to retain it (setup-choice dialog) instead of silently discarding it.
    const legacyKeys = ['babylonian-heron-data-v5', 'babylonian-heron-data-v4', 'babylonian-heron-data-v3', 'babylonian-heron-data-v2'];
    for (const key of legacyKeys) {
      const oldRaw = localStorage.getItem(key);
      if (!oldRaw) continue;
      let parsed = JSON.parse(oldRaw);
      if (key.endsWith('v2')) parsed = migrateV2ToV3(parsed);
      if (key.endsWith('v2') || key.endsWith('v3')) parsed = migrateV3ToV4(parsed);
      const migrated = migrateV4ToV5(parsed);
      migrated.setupChoiceDone = false; // ask: retain existing data or start afresh
      return migrated;
    }
  } catch { /* ignore */ }
  // True fresh install: nothing stored anywhere -> start empty, no dialog needed.
  return createFreshState(true);
}
function saveState(state: BudgetState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

export function useBudgetStore() {
  const [state, setState] = useState<BudgetState>(loadState);

  useEffect(() => { saveState(state); }, [state]);

  const currentYear = state.years[state.activeYear];

  const updateEntryValue = useCallback((section: keyof YearData, entryId: string, monthIndex: number, value: number) => {
    setState(prev => {
      const y = prev.years[prev.activeYear];
      if (!y) return prev;
      const entries = [...(y[section] as DataEntry[])];
      const idx = entries.findIndex(e => e.id === entryId);
      if (idx === -1) return prev;
      const entry = { ...entries[idx] };
      const newValues = [...entry.values];
      const oldVal = newValues[monthIndex];
      newValues[monthIndex] = value;
      entry.values = newValues;
      entry.modifiedAt = now();
      entries[idx] = entry;
      // Auto-derive the status remarks so badges, streaks and the Interceptor stay in sync.
      const base0 = { ...y, [section]: entries } as YearData;
      const remarked0 = REMARK_SECTIONS.includes(section) ? { ...base0, remarks: deriveRemarksForMonth(base0, monthIndex) } : base0;
      const updated = { ...remarked0, modifiedAt: now() };
      const newState = { ...prev, years: { ...prev.years, [prev.activeYear]: updated } };
      const auditY = newState.years[newState.activeYear];
      const audit: AuditEntry = { id: `audit-${Date.now()}`, action: 'edit', section: String(section), entryName: entry.name, oldValue: String(oldVal), newValue: String(value), monthIndex, timestamp: now() };
      auditY.auditLog = [audit, ...auditY.auditLog].slice(0, 100);
      return newState;
    });
  }, []);

  const updateEntryName = useCallback((section: keyof YearData, entryId: string, name: string) => {
    setState(prev => {
      const y = prev.years[prev.activeYear];
      if (!y) return prev;
      const entries = [...(y[section] as DataEntry[])];
      const idx = entries.findIndex(e => e.id === entryId);
      if (idx === -1) return prev;
      const oldName = entries[idx].name;
      const entry = { ...entries[idx], name, modifiedAt: now() };
      entries[idx] = entry;
      // Renaming a debt row keeps its paired debtMeta name in sync.
      const newMeta = section === 'debtProgression'
        ? y.debtMeta.map(m => (m.debtId === entryId ? { ...m, name } : m))
        : y.debtMeta;
      const updated = { ...y, [section]: entries, debtMeta: newMeta, modifiedAt: now() };
      const newState = { ...prev, years: { ...prev.years, [prev.activeYear]: updated } };
      const auditY = newState.years[newState.activeYear];
      const audit: AuditEntry = { id: `audit-${Date.now()}`, action: 'rename', section: String(section), entryName: name, oldValue: oldName, newValue: name, timestamp: now() };
      auditY.auditLog = [audit, ...auditY.auditLog].slice(0, 100);
      return newState;
    });
  }, []);

  const addEntry = useCallback((section: keyof YearData, name: string) => {
    setState(prev => {
      const y = prev.years[prev.activeYear];
      if (!y) return prev;
      const entries = [...(y[section] as DataEntry[])];
      const id = `${name.toLowerCase().replace(/\s+/g, '-')}-${now()}`;
      const ts = now();
      entries.push({ id, name, values: new Array(12).fill(0), recurring: 'none', createdAt: ts, modifiedAt: ts });
      // A new debt row needs a paired debtMeta so the payoff simulator can track it.
      const newMeta = section === 'debtProgression'
        ? [...y.debtMeta, { debtId: id, name, interestRate: 0, emiAmount: 0, originalPrincipal: 0, startMonthIndex: 0 }]
        : y.debtMeta;
      const updated = { ...y, [section]: entries, debtMeta: newMeta, modifiedAt: ts };
      const newState = { ...prev, years: { ...prev.years, [prev.activeYear]: updated } };
      const auditY = newState.years[newState.activeYear];
      const audit: AuditEntry = { id: `audit-${now()}`, action: 'add', section: String(section), entryName: name, timestamp: ts };
      auditY.auditLog = [audit, ...auditY.auditLog].slice(0, 100);
      return newState;
    });
  }, []);

  const deleteEntry = useCallback((section: keyof YearData, entryId: string) => {
    setState(prev => {
      const y = prev.years[prev.activeYear];
      if (!y) return prev;
      const entries = (y[section] as DataEntry[]);
      const target = entries.find(e => e.id === entryId);
      const filtered = entries.filter(e => e.id !== entryId);
      // Removing a debt row must also remove its paired debtMeta (no orphans).
      const newMeta = section === 'debtProgression' ? y.debtMeta.filter(m => m.debtId !== entryId) : y.debtMeta;
      const base1 = { ...y, [section]: filtered, debtMeta: newMeta } as YearData;
      const remarked1 = REMARK_SECTIONS.includes(section) ? { ...base1, remarks: deriveRemarksForYear(base1) } : base1;
      const updated = { ...remarked1, modifiedAt: now() };
      const newState = { ...prev, years: { ...prev.years, [prev.activeYear]: updated } };
      if (target) {
        const auditY = newState.years[newState.activeYear];
        const audit: AuditEntry = { id: `audit-${now()}`, action: 'delete', section: String(section), entryName: target.name, timestamp: now() };
        auditY.auditLog = [audit, ...auditY.auditLog].slice(0, 100);
      }
      return newState;
    });
  }, []);

  const setActiveYear = useCallback((year: string) => { setState(prev => ({ ...prev, activeYear: year })); }, []);

  const addYear = useCallback((year: string) => {
    setState(prev => {
      if (prev.years[year]) return prev;
      const newYear = createEmptyYear(year);
      return { ...prev, years: { ...prev.years, [year]: newYear }, availableYears: [...prev.availableYears, year].sort(), activeYear: year };
    });
  }, []);

  const deleteYear = useCallback((year: string) => {
    setState(prev => {
      if (Object.keys(prev.years).length <= 1) return prev;
      const { [year]: _, ...rest } = prev.years;
      const remaining = prev.availableYears.filter(y => y !== year).sort();
      return { ...prev, years: rest, availableYears: remaining, activeYear: prev.activeYear === year ? remaining[0] : prev.activeYear };
    });
  }, []);

  const resetToDefaults = useCallback(() => {
    setState(prev => ({ ...createFreshState(true), passcode: prev.passcode }));
  }, []);

  // One-time first-run choice: retain data carried over from an older app
  // version, or wipe everything and start with an empty slate.
  const completeSetup = useCallback((retainExisting: boolean) => {
    setState(prev => {
      if (retainExisting) return { ...prev, setupChoiceDone: true };
      return { ...createFreshState(true), passcode: prev.passcode };
    });
  }, []);

  const getTotal = useCallback((section: keyof YearData, monthIndex: number) => {
    const y = currentYear;
    if (!y) return 0;
    const entries = y[section] as DataEntry[];
    return entries.reduce((sum, e) => sum + (e.values[monthIndex] || 0), 0);
  }, [currentYear]);

  const autoAllocate = useCallback((monthIndex: number) => {
    setState(prev => {
      const yr = prev.years[prev.activeYear];
      if (!yr) return prev;
      const totalIncome = yr.incomeEntries.reduce((sum, e) => sum + (e.values[monthIndex] || 0), 0);
      if (totalIncome <= 0) return prev;
      const alloc = yr.allocationEntries.map(e => ({ ...e, values: [...e.values], modifiedAt: now() }));
      const saveIdx = alloc.findIndex(e => e.id === 'saving10');
      const houseIdx = alloc.findIndex(e => e.id === 'house70');
      const debtIdx = alloc.findIndex(e => e.id === 'debt20');
      if (saveIdx >= 0) alloc[saveIdx].values[monthIndex] = Math.round(totalIncome * 0.10);
      if (houseIdx >= 0) alloc[houseIdx].values[monthIndex] = Math.round(totalIncome * 0.70);
      if (debtIdx >= 0) alloc[debtIdx].values[monthIndex] = Math.round(totalIncome * 0.20);
      const base2 = { ...yr, allocationEntries: alloc };
      const updated = { ...base2, remarks: deriveRemarksForMonth(base2, monthIndex), modifiedAt: now() };
      return { ...prev, years: { ...prev.years, [prev.activeYear]: updated } };
    });
  }, []);

  // Recompute the 70/20/10 allocation for EVERY month from the current income
  // data (used after income entries are added/removed so allocations never go stale).
  const autoAllocateAll = useCallback(() => {
    setState(prev => {
      const y = prev.years[prev.activeYear];
      if (!y) return prev;
      const alloc = y.allocationEntries.map(e => ({ ...e, values: [...e.values] }));
      for (let m = 0; m < 12; m++) {
        const totalIncome = y.incomeEntries.reduce((sm, e) => sm + (e.values[m] || 0), 0);
        const setVal = (id: string, v: number) => {
          const i = alloc.findIndex(x => x.id === id);
          if (i >= 0) alloc[i].values[m] = Math.round(v);
        };
        setVal('saving10', totalIncome * 0.10);
        setVal('house70', totalIncome * 0.70);
        setVal('debt20', totalIncome * 0.20);
      }
      const base3 = { ...y, allocationEntries: alloc };
      const updated = { ...base3, remarks: deriveRemarksForYear(base3), modifiedAt: now() };
      return { ...prev, years: { ...prev.years, [prev.activeYear]: updated } };
    });
  }, []);

  // Toggle the user's "essential" flag on an entry — essentials are protected
  // from Hand-to-Mouth Interceptor cut suggestions.
  const toggleEntryEssential = useCallback((section: keyof YearData, entryId: string) => {
    setState(prev => {
      const y = prev.years[prev.activeYear];
      if (!y) return prev;
      const entries = [...(y[section] as DataEntry[])];
      const idx = entries.findIndex(e => e.id === entryId);
      if (idx === -1) return prev;
      entries[idx] = { ...entries[idx], essential: !entries[idx].essential, modifiedAt: now() };
      const updated = { ...y, [section]: entries, modifiedAt: now() };
      return { ...prev, years: { ...prev.years, [prev.activeYear]: updated } };
    });
  }, []);

  // ── Statement import: pending queue + confirmation ──
  const txnKey = (t: ParsedTxn) => (t.refId ? `id:${t.refId}` : `h:${t.hash}`);
  const queueTransactions = useCallback((txns: ParsedTxn[]) => {
    setState(prev => {
      const y = prev.years[prev.activeYear];
      if (!y) return prev;
      const processedH = new Set(y.processedTxnHashes);
      const processedI = new Set(y.processedTxnIds);
      const pendingSet = new Set(y.pendingTxns.map(txnKey));
      const fresh = txns.filter(t =>
        !(t.refId ? processedI.has(t.refId) : processedH.has(t.hash)) &&
        !pendingSet.has(txnKey(t))
      );
      if (fresh.length === 0) return prev;
      const withIds = fresh.map((t, i) => ({ ...t, id: `txn-${now()}-${i}` }));
      const updated = { ...y, pendingTxns: [...y.pendingTxns, ...withIds].slice(0, 1000), modifiedAt: now() };
      return { ...prev, years: { ...prev.years, [prev.activeYear]: updated } };
    });
  }, []);

  const confirmImportedTxn = useCallback((txn: ParsedTxn, section: 'incomeEntries' | 'householdExpenses' | 'savingsData' | 'debtRepayment', entryId: string | null, newName: string | null) => {
    setState(prev => {
      const y = prev.years[prev.activeYear];
      if (!y) return prev;
      const ts = now();
      const entries = [...(y[section] as DataEntry[])];
      let targetId = entryId;
      if (!targetId) {
        targetId = `${(newName || 'imported').toLowerCase().replace(/\s+/g, '-')}-${now()}`;
        entries.push({ id: targetId, name: (newName || 'IMPORTED').toUpperCase(), values: new Array(12).fill(0), recurring: 'none', createdAt: ts, modifiedAt: ts });
      }
      const idx = entries.findIndex(e => e.id === targetId);
      if (idx === -1) return prev;
      const values = [...entries[idx].values];
      values[txn.monthIndex] = (values[txn.monthIndex] || 0) + txn.amount;
      entries[idx] = { ...entries[idx], values, modifiedAt: ts };
      const base0 = { ...y, [section]: entries, pendingTxns: y.pendingTxns.filter(t => t.hash !== txn.hash && t.refId !== txn.refId) } as YearData;
      const base1 = { ...base0, processedTxnHashes: txn.refId ? base0.processedTxnHashes : [txn.hash, ...base0.processedTxnHashes].slice(0, 2000) } as YearData;
      const base2 = txn.refId ? { ...base1, processedTxnIds: [txn.refId, ...base1.processedTxnIds].slice(0, 2000) } : base1;
      const base = withImportedMonth(base2, [monthKeyOf(txn)]);
      const updated = { ...base, remarks: deriveRemarksForMonth(base, txn.monthIndex), modifiedAt: ts };
      const newState = { ...prev, years: { ...prev.years, [prev.activeYear]: updated } };
      const auditY = newState.years[newState.activeYear];
      const audit: AuditEntry = { id: `audit-${now()}`, action: 'add', section: String(section), entryName: entries[idx].name, newValue: `${txn.direction} ${txn.amount} (${txn.dateISO})`, timestamp: ts };
      auditY.auditLog = [audit, ...auditY.auditLog].slice(0, 100);
      return newState;
    });
  }, []);

  const monthKeyOf = (t: { dateISO: string }) => t.dateISO.slice(0, 7); // "YYYY-M"
  const withImportedMonth = (base: YearData, months: string[]) => {
    const added = months.filter(m => !base.importedStatementMonths.includes(m));
    return added.length ? { ...base, importedStatementMonths: [...base.importedStatementMonths, ...added].sort() } : base;
  };

  // Allow re-importing a locked month (done deliberately, e.g. after correcting a wrong file).
  const clearImportedMonth = useCallback((month: string) => {
    setState(prev => {
      const y = prev.years[prev.activeYear];
      if (!y) return prev;
      const updated = { ...y, importedStatementMonths: y.importedStatementMonths.filter(m => m !== month), modifiedAt: now() };
      return { ...prev, years: { ...prev.years, [prev.activeYear]: updated } };
    });
  }, []);

  const rejectProcessedTxn = useCallback((txnId: string) => {
    setState(prev => {
      const y = prev.years[prev.activeYear];
      if (!y) return prev;
      const txn = y.pendingTxns.find(t => t.id === txnId);
      if (!txn) return prev;
      const updated = { ...y,
        pendingTxns: y.pendingTxns.filter(t => t.id !== txnId),
        processedTxnHashes: txn.refId ? y.processedTxnHashes : [txn.hash, ...y.processedTxnHashes].slice(0, 2000),
        processedTxnIds: txn.refId ? [txn.refId, ...y.processedTxnIds].slice(0, 2000) : y.processedTxnIds,
        modifiedAt: now() };
      return { ...prev, years: { ...prev.years, [prev.activeYear]: updated } };
    });
  }, []);

  const addImportRule = useCallback((match: string, section: 'incomeEntries' | 'householdExpenses' | 'savingsData' | 'debtRepayment', entryId: string) => {
    setState(prev => {
      const y = prev.years[prev.activeYear];
      if (!y || !match.trim()) return prev;
      const key = match.trim().toLowerCase();
      const rules = [...y.importRules.filter(r => r.match.toLowerCase() !== key), { match: match.trim(), section, entryId }];
      const updated = { ...y, importRules: rules.slice(0, 50), modifiedAt: now() };
      return { ...prev, years: { ...prev.years, [prev.activeYear]: updated } };
    });
  }, []);

  const deleteImportRule = useCallback((match: string) => {
    setState(prev => {
      const y = prev.years[prev.activeYear];
      if (!y) return prev;
      const updated = { ...y, importRules: y.importRules.filter(r => r.match !== match), modifiedAt: now() };
      return { ...prev, years: { ...prev.years, [prev.activeYear]: updated } };
    });
  }, []);

  // One-step guided debt creation: progression row (with current balance),
  // debtMeta (rate/EMI/principal) and optionally a matching EMI outflow row.
  const addDebt = useCallback((name: string, opts: { balance: number; principal: number; rate: number; emi: number; startMonthIndex: number }, addEmiToOutflows: boolean) => {
    setState(prev => {
      const y = prev.years[prev.activeYear];
      if (!y || !name.trim()) return prev;
      const ts = now();
      const clean = name.trim().toUpperCase();
      const pid = `${clean.toLowerCase().replace(/\s+/g, '-')}-${now()}`;
      const activeYearNum = parseInt(prev.activeYear, 10);
      const monthIdx = activeYearNum === new Date().getFullYear() ? new Date().getMonth() : 0;
      const values = new Array(12).fill(0);
      values[monthIdx] = Math.max(0, opts.balance);
      const progression = [...y.debtProgression, { id: pid, name: clean, values, recurring: 'none' as const, createdAt: ts, modifiedAt: ts }];
      const meta = [...y.debtMeta, { debtId: pid, name: clean, interestRate: opts.rate, emiAmount: opts.emi, originalPrincipal: opts.principal > 0 ? opts.principal : opts.balance, startMonthIndex: opts.startMonthIndex }];
      let repayment = [...y.debtRepayment];
      if (addEmiToOutflows && opts.emi > 0) {
        const emiValues = new Array(12).fill(0);
        for (let m = monthIdx; m < 12; m++) emiValues[m] = opts.emi;
        repayment = [...repayment, { id: `${pid}-emi`, name: `${clean} EMI`, values: emiValues, recurring: 'monthly' as const, createdAt: ts, modifiedAt: ts }];
      }
      const updated = { ...y, debtProgression: progression, debtMeta: meta, debtRepayment: repayment, modifiedAt: ts };
      const newState = { ...prev, years: { ...prev.years, [prev.activeYear]: updated } };
      const auditY = newState.years[newState.activeYear];
      const audit: AuditEntry = { id: `audit-${now()}`, action: 'add', section: 'debt', entryName: clean, newValue: `balance ${opts.balance} @ ${opts.rate}% EMI ${opts.emi}`, timestamp: ts };
      auditY.auditLog = [audit, ...auditY.auditLog].slice(0, 100);
      return newState;
    });
  }, []);

  // Push the current debtMeta EMI into the matching Debt Repayment row
  // (created if missing) for the current month onward. Months the user has
  // manually edited to a different amount are left untouched.
  const syncDebtEmiToOutflows = useCallback((debtId: string) => {
    setState(prev => {
      const y = prev.years[prev.activeYear];
      if (!y) return prev;
      const meta = y.debtMeta.find(m => m.debtId === debtId);
      if (!meta || meta.emiAmount <= 0) return prev;
      const ts = now();
      const monthIdx = new Date().getMonth();
      const repayment = [...y.debtRepayment.map(e => ({ ...e, values: [...e.values] }))];
      const targetName = `${meta.name} EMI`;
      let idx = repayment.findIndex(e => e.name === targetName);
      if (idx === -1) {
        repayment.push({ id: `${debtId}-emi-${now()}`, name: targetName, values: new Array(12).fill(0), recurring: 'monthly', createdAt: ts, modifiedAt: ts });
        idx = repayment.length - 1;
      }
      for (let m = monthIdx; m < 12; m++) {
        if (repayment[idx].values[m] === 0 || repayment[idx].values[m] === meta.emiAmount) repayment[idx].values[m] = meta.emiAmount;
      }
      repayment[idx] = { ...repayment[idx], modifiedAt: ts };
      const updated = { ...y, debtRepayment: repayment, modifiedAt: ts };
      return { ...prev, years: { ...prev.years, [prev.activeYear]: updated } };
    });
  }, []);

  const setPasscode = useCallback((passcode: string | null) => {
    // Store only a salted hash â€” never the plaintext PIN.
    setState(prev => ({ ...prev, passcode: passcode == null ? null : saltedHash(passcode) }));
  }, []);
  const verifyPasscode = useCallback((input: string) => {
    if (state.passcode == null) return false;
    // Legacy plaintext PINs stored before hashing was introduced.
    if (/^[0-9]{4}$/.test(state.passcode) && state.passcode === input) return true;
    return saltedHash(input) === state.passcode;
  }, [state.passcode]);

  const getBurnRate = useCallback(() => {
    const nowDate = new Date();
    const currentMonthIdx = nowDate.getMonth();
    const currentYearStr = String(nowDate.getFullYear());
    if (state.activeYear !== currentYearStr) return null;
    const y = currentYear;
    if (!y) return null;
    const dayOfMonth = nowDate.getDate();
    const totalDays = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 0).getDate();
    const spent = y.householdExpenses.reduce((sum, e) => sum + (e.values[currentMonthIdx] || 0), 0);
    const capEntry = y.allocationEntries.find(e => e.id === 'house70');
    const cap = capEntry?.values[currentMonthIdx] || 0;
    if (cap <= 0 || dayOfMonth <= 0) return null;
    const dailyVelocity = spent / dayOfMonth;
    const remaining = Math.max(0, cap - spent);
    const daysUntilExhaustion = dailyVelocity > 0 ? Math.ceil(remaining / dailyVelocity) : 999;
    const daysRemaining = totalDays - dayOfMonth + 1;
    const dailyAllowance = daysRemaining > 0 ? remaining / daysRemaining : 0;
    const usedPct = Math.min(100, (spent / cap) * 100);
    const status = usedPct >= 100 ? 'BROKEN' : usedPct >= 85 ? 'DISASTER IN MAKING' : usedPct >= 60 ? 'WATCH OUT' : usedPct >= 30 ? 'ON TRACK' : 'BRAVO!';
    return { spent, cap, remaining, dailyVelocity, daysUntilExhaustion, daysRemaining, dailyAllowance, usedPct, isCapReached: spent >= cap, status };
  }, [state.activeYear, currentYear]);

  const toggleRecurring = useCallback((section: keyof YearData, entryId: string, frequency: 'none' | 'monthly' | 'quarterly' | 'annual') => {
    setState(prev => {
      const y = prev.years[prev.activeYear];
      if (!y) return prev;
      const entries = [...(y[section] as DataEntry[])];
      const idx = entries.findIndex(e => e.id === entryId);
      if (idx === -1) return prev;
      const entry = { ...entries[idx], recurring: frequency, modifiedAt: now() };
      entries[idx] = entry;
      const updated = { ...y, [section]: entries, modifiedAt: now() };
      const newState = { ...prev, years: { ...prev.years, [prev.activeYear]: updated } };
      const auditY = newState.years[newState.activeYear];
      const audit: AuditEntry = { id: `audit-${now()}`, action: 'edit', section: String(section), entryName: entry.name, oldValue: `recurring:${entries[idx].recurring || 'none'}`, newValue: `recurring:${frequency}`, timestamp: now() };
      auditY.auditLog = [audit, ...auditY.auditLog].slice(0, 100);
      return newState;
    });
  }, []);

  const applyRecurringAutopilot = useCallback((monthIndex: number) => {
    setState(prev => {
      const y = prev.years[prev.activeYear];
      if (!y) return prev;
      const prevMonth = monthIndex - 1;
      if (prevMonth < 0) return prev;
      const household = [...y.householdExpenses];
      let changed = false;
      for (let i = 0; i < household.length; i++) {
        const entry = household[i];
        if (!entry.recurring || entry.recurring === 'none') continue;
        const prevVal = entry.values[prevMonth] || 0;
        if (prevVal > 0 && entry.values[monthIndex] === 0) {
          const newEntry = { ...entry, values: [...entry.values], modifiedAt: now() };
          newEntry.values[monthIndex] = prevVal;
          if (entry.recurring === 'monthly') { for (let m = monthIndex + 1; m < 12; m++) { if (newEntry.values[m] === 0) newEntry.values[m] = prevVal; } }
          if (entry.recurring === 'quarterly') { for (let m = monthIndex + 3; m < 12; m += 3) { if (newEntry.values[m] === 0) newEntry.values[m] = prevVal; } }
          household[i] = newEntry;
          changed = true;
        }
      }
      if (!changed) return prev;
      const base4 = { ...y, householdExpenses: household };
      const updated = { ...base4, remarks: deriveRemarksForYear(base4), modifiedAt: now() };
      const newState = { ...prev, years: { ...prev.years, [prev.activeYear]: updated } };
      const auditY = newState.years[newState.activeYear];
      const audit: AuditEntry = { id: `audit-${now()}`, action: 'edit', section: 'householdExpenses', entryName: 'Recurring Autopilot', oldValue: '0', newValue: `Applied to ${MONTHS_12[monthIndex]}`, timestamp: now() };
      auditY.auditLog = [audit, ...auditY.auditLog].slice(0, 100);
      return newState;
    });
  }, []);

  const getCommittedRecurring = useCallback((monthIndex: number) => {
    const y = currentYear;
    if (!y) return 0;
    return y.householdExpenses.reduce((sum, e) => { if (!e.recurring || e.recurring === 'none') return sum; return sum + (e.values[monthIndex] || 0); }, 0);
  }, [currentYear]);

  const getTrueDisposable = useCallback((monthIndex: number) => {
    const y = currentYear;
    if (!y) return 0;
    const capEntry = y.allocationEntries.find(e => e.id === 'house70');
    const cap = capEntry?.values[monthIndex] || 0;
    const committed = getCommittedRecurring(monthIndex);
    return Math.max(0, cap - committed);
  }, [currentYear, getCommittedRecurring]);

  const updateDebtMeta = useCallback((debtId: string, updates: Partial<DebtMeta>) => {
    setState(prev => {
      const y = prev.years[prev.activeYear];
      if (!y) return prev;
      const meta = [...y.debtMeta];
      const idx = meta.findIndex(m => m.debtId === debtId);
      if (idx === -1) return prev;
      meta[idx] = { ...meta[idx], ...updates };
      const updated = { ...y, debtMeta: meta, modifiedAt: now() };
      return { ...prev, years: { ...prev.years, [prev.activeYear]: updated } };
    });
  }, []);

  // The payoff simulator must start from the balance AS OF TODAY, not the
  // last December value. For the active calendar year the anchor is the
  // current month; for any other year it is December (latest recorded).
  const getDebtAnchorMonth = useCallback(() => {
    const active = parseInt(state.activeYear, 10);
    return active === new Date().getFullYear() ? new Date().getMonth() : 11;
  }, [state.activeYear]);

  const getCurrentDebtBalance = useCallback((debtId: string) => {
    const y = currentYear;
    if (!y) return 0;
    const prog = y.debtProgression.find(d => d.id === debtId);
    if (!prog) return 0;
    const anchor = getDebtAnchorMonth();
    // Most recent recorded (non-zero) balance at or before the anchor month.
    for (let i = anchor; i >= 0; i--) { if (prog.values[i] > 0) return prog.values[i]; }
    // Nothing recorded yet at/before the anchor: fall back to the earliest
    // forward projection so the simulator still has a starting balance.
    for (let i = anchor + 1; i < 12; i++) { if (prog.values[i] > 0) return prog.values[i]; }
    return 0;
  }, [currentYear, getDebtAnchorMonth]);

  const getDebtMonthsRemaining = useCallback((debtId: string) => {
    const y = currentYear;
    if (!y) return 0;
    const meta = y.debtMeta.find(m => m.debtId === debtId);
    const balance = getCurrentDebtBalance(debtId);
    if (!meta || balance <= 0 || meta.emiAmount <= 0) return 0;
    const monthlyRate = meta.interestRate / 100 / 12;
    if (monthlyRate <= 0) return Math.ceil(balance / meta.emiAmount);
    // If the monthly EMI doesn't cover the monthly interest, the balance never
    // amortizes down and the closed-form term is undefined (log of a negative).
    if (meta.emiAmount <= monthlyRate * balance) return Infinity;
    const n = -Math.log(1 - (monthlyRate * balance) / meta.emiAmount) / Math.log(1 + monthlyRate);
    if (!Number.isFinite(n) || n < 0) return Infinity;
    return Math.ceil(n);
  }, [currentYear, getCurrentDebtBalance]);

  const calculateDebtPayoff = useCallback((strategy: 'snowball' | 'avalanche', extraMonthly: number = 0): DebtSimulatorResult | null => {
    const y = currentYear;
    if (!y) return null;
    const debts = y.debtMeta.map(m => {
      const balance = getCurrentDebtBalance(m.debtId);
      return { debtId: m.debtId, name: m.name, balance, rate: m.interestRate, emi: m.emiAmount };
    }).filter(d => d.balance > 0 && d.emi > 0);
    if (debts.length === 0) return null;
    const sorted = strategy === 'snowball' ? [...debts].sort((a, b) => a.balance - b.balance) : [...debts].sort((a, b) => b.rate - a.rate);
    const active = sorted.map(d => ({ ...d, currentBalance: d.balance, paidOff: false }));
    let month = 0;
    let totalInterest = 0;
    const schedule: { month: number; debtName: string; payment: number; balance: number }[] = [];
    while (active.some(d => !d.paidOff) && month < 600) {
      month++;
      let extraPool = extraMonthly;
      for (let i = 0; i < active.length; i++) {
        const debt = active[i];
        if (debt.paidOff) continue;
        const interest = debt.currentBalance * (debt.rate / 100 / 12);
        totalInterest += interest;
        debt.currentBalance += interest;
        let payment = debt.emi;
        const hasEarlierActive = active.slice(0, i).some(d => !d.paidOff);
        if (!hasEarlierActive && extraPool > 0) { const extra = Math.min(extraPool, debt.currentBalance); payment += extra; extraPool -= extra; }
        if (debt.currentBalance <= payment) { payment = debt.currentBalance; debt.currentBalance = 0; debt.paidOff = true; }
        else { debt.currentBalance -= payment; }
        schedule.push({ month, debtName: debt.name, payment: Math.round(payment), balance: Math.round(Math.max(0, debt.currentBalance)) });
      }
    }
    return { strategy, totalMonths: month, totalInterest: Math.round(totalInterest), totalPrincipal: debts.reduce((s, d) => s + d.balance, 0), schedule };
  }, [currentYear, getCurrentDebtBalance]);

  const calculateExtraPaymentImpact = useCallback((debtId: string, extraAmount: number): ExtraPaymentImpact | null => {
    const y = currentYear;
    if (!y) return null;
    const meta = y.debtMeta.find(m => m.debtId === debtId);
    const balance = getCurrentDebtBalance(debtId);
    if (!meta || balance <= 0 || meta.emiAmount <= 0) return null;
    const rate = meta.interestRate / 100 / 12;
    // If the EMI cannot even cover the monthly interest, the balance never
    // amortizes and a baseline-vs-extra comparison is meaningless.
    if (meta.emiAmount <= rate * balance) return null;
    let bBalance = balance, bMonths = 0, bInterest = 0;
    while (bBalance > 0.01 && bMonths < 600) { bMonths++; const interest = bBalance * rate; bInterest += interest; bBalance += interest - meta.emiAmount; if (bBalance <= 0) bBalance = 0; }
    let eBalance = balance, eMonths = 0, eInterest = 0;
    while (eBalance > 0.01 && eMonths < 600) { eMonths++; const interest = eBalance * rate; eInterest += interest; eBalance += interest - meta.emiAmount - extraAmount; if (eBalance <= 0) eBalance = 0; }
    return { debtId, debtName: meta.name, monthsSaved: bMonths - eMonths, interestSaved: Math.round(bInterest - eInterest), newPayoffMonths: eMonths, baselineMonths: bMonths };
  }, [currentYear, getCurrentDebtBalance]);
  // Phase 3: Tax Shield
  const addTaxEntry = useCallback((name: string, category: TaxEntry['category'], limit: number) => {
    setState(prev => {
      const y = prev.years[prev.activeYear];
      if (!y) return prev;
      const entries = [...y.taxShieldEntries];
      const id = `tax-${name.toLowerCase().replace(/\s+/g, '-')}-${now()}`;
      const ts = now();
      entries.push({ id, name, category, values: new Array(12).fill(0), limit, createdAt: ts, modifiedAt: ts });
      const updated = { ...y, taxShieldEntries: entries, modifiedAt: ts };
      const newState = { ...prev, years: { ...prev.years, [prev.activeYear]: updated } };
      const auditY = newState.years[newState.activeYear];
      auditY.auditLog = [{ id: `audit-${now()}`, action: 'add', section: 'taxShield', entryName: name, timestamp: ts }, ...auditY.auditLog].slice(0, 100);
      return newState;
    });
  }, []);

  const updateTaxEntryValue = useCallback((entryId: string, monthIndex: number, value: number) => {
    setState(prev => {
      const y = prev.years[prev.activeYear];
      if (!y) return prev;
      const entries = [...y.taxShieldEntries];
      const idx = entries.findIndex(e => e.id === entryId);
      if (idx === -1) return prev;
      const entry = { ...entries[idx], values: [...entries[idx].values], modifiedAt: now() };
      entry.values[monthIndex] = value;
      entries[idx] = entry;
      const updated = { ...y, taxShieldEntries: entries, modifiedAt: now() };
      return { ...prev, years: { ...prev.years, [prev.activeYear]: updated } };
    });
  }, []);

  const deleteTaxEntry = useCallback((entryId: string) => {
    setState(prev => {
      const y = prev.years[prev.activeYear];
      if (!y) return prev;
      const filtered = y.taxShieldEntries.filter(e => e.id !== entryId);
      const updated = { ...y, taxShieldEntries: filtered, modifiedAt: now() };
      return { ...prev, years: { ...prev.years, [prev.activeYear]: updated } };
    });
  }, []);

  const getTaxShieldStatus = useCallback((monthIndex: number): TaxShieldStatus => {
    const y = currentYear;
    const LIMIT_80C = 150000;   // PPF, ELSS, Sukanya, Tax FD, life-insurance premium (Sec 80C)
    const LIMIT_NPS = 50000;    // NPS additional contribution (Sec 80CCD(1B)) â€” separate head
    const LIMIT_80D = 25000;    // Health insurance premium (Sec 80D, self + family) â€” separate head
    const TOTAL_LIMIT = LIMIT_80C + LIMIT_NPS + LIMIT_80D;
    if (!y) return { filled: 0, gap: TOTAL_LIMIT, limit: TOTAL_LIMIT, pct: 0, monthlySipNeeded: 0, monthsRemaining: 0, entries: [] };
    const entries = y.taxShieldEntries.map(e => ({ name: e.name, value: e.values[monthIndex] || 0, category: e.category }));
    const is80C = (cat: string) => ['ppf', 'elss', 'sukanya', 'fd', 'other'].includes(cat);
    let sum80C = 0, sumNps = 0, sum80D = 0;
    entries.forEach(e => {
      if (e.value <= 0) return;
      if (e.category === 'nps') sumNps += e.value;
      else if (e.category === 'insurance') sum80D += e.value;
      else if (is80C(e.category)) sum80C += e.value;
    });
    // Cap each statutory head at its own legal ceiling (deductions can't exceed the limit).
    const filled = Math.min(LIMIT_80C, sum80C) + Math.min(LIMIT_NPS, sumNps) + Math.min(LIMIT_80D, sum80D);
    const gap = Math.max(0, TOTAL_LIMIT - filled);
    const pct = Math.min(100, (filled / TOTAL_LIMIT) * 100);
    const monthsRemaining = 12 - monthIndex;
    const monthlySipNeeded = monthsRemaining > 0 ? Math.ceil(gap / monthsRemaining) : 0;
    return { filled, gap, limit: TOTAL_LIMIT, pct, monthlySipNeeded, monthsRemaining, entries };
  }, [currentYear]);

  // Phase 3: Windfall
  const detectWindfall = useCallback((monthIndex: number): WindfallResult | null => {
    const y = currentYear;
    if (!y) return null;
    const totalIncome = y.incomeEntries.reduce((s, e) => s + (e.values[monthIndex] || 0), 0);
    if (totalIncome <= 0) return null;
    let baseline = y.windfallBaseline;
    if (baseline <= 0) {
      let sum = 0, count = 0;
      for (let i = monthIndex - 1; i >= 0 && count < 3; i--) {
        const mIncome = y.incomeEntries.reduce((s, e) => s + (e.values[i] || 0), 0);
        if (mIncome > 0) { sum += mIncome; count++; }
      }
      baseline = count > 0 ? Math.round(sum / count) : totalIncome;
    }
    const extra = totalIncome - baseline;
    if (extra <= 5000) return null;
    return { extraIncome: extra, toSavings: Math.round(extra * 0.10), toHousehold: Math.round(extra * 0.70), toDebt: Math.round(extra * 0.20), monthIndex };
  }, [currentYear]);

  const applyWindfall = useCallback((result: WindfallResult) => {
    setState(prev => {
      const y = prev.years[prev.activeYear];
      if (!y) return prev;
      const { monthIndex, toSavings, toHousehold, toDebt } = result;
      const savings = [...y.savingsData];
      const household = [...y.householdExpenses];
      const debt = [...y.debtRepayment];
      const ts = now();
      const pushOrAdd = (arr: DataEntry[], id: string, name: string, amount: number) => {
        const idx = arr.findIndex(e => e.id === id);
        if (idx >= 0) { const v = [...arr[idx].values]; v[monthIndex] = (v[monthIndex] || 0) + amount; arr[idx] = { ...arr[idx], values: v, modifiedAt: ts }; }
        else { const v = new Array(12).fill(0); v[monthIndex] = amount; arr.push({ id, name, values: v, recurring: 'none', createdAt: ts, modifiedAt: ts }); }
      };
      pushOrAdd(savings, 'windfall-savings', 'WINDFALL SAVINGS', toSavings);
      pushOrAdd(household, 'windfall-buffer', 'WINDFALL BUFFER', toHousehold);
      pushOrAdd(debt, 'windfall-debt', 'WINDFALL DEBT KNOCKOUT', toDebt);
      const base5 = { ...y, savingsData: savings, householdExpenses: household, debtRepayment: debt };
      const updated = { ...base5, remarks: deriveRemarksForYear(base5), modifiedAt: ts };
      const newState = { ...prev, years: { ...prev.years, [prev.activeYear]: updated } };
      const auditY = newState.years[newState.activeYear];
      auditY.auditLog = [{ id: `audit-${now()}`, action: 'add', section: 'windfall', entryName: `Windfall Allocation`, newValue: `S:${toSavings} H:${toHousehold} D:${toDebt}`, timestamp: ts }, ...auditY.auditLog].slice(0, 100);
      return newState;
    });
  }, []);

  const setWindfallBaseline = useCallback((baseline: number) => {
    setState(prev => {
      const y = prev.years[prev.activeYear];
      if (!y) return prev;
      return { ...prev, years: { ...prev.years, [prev.activeYear]: { ...y, windfallBaseline: baseline, modifiedAt: now() } } };
    });
  }, []);

  // Phase 4: Hand-to-Mouth Interceptor
  const getDisasterStreak = useCallback((monthIndex: number): number => {
    const y = currentYear;
    if (!y) return 0;
    let streak = 0;
    for (let i = monthIndex; i >= 0; i--) {
      if (y.remarks.house70?.[String(i)] === 'DISASTER IN MAKING') streak++;
      else break;
    }
    return streak;
  }, [currentYear]);

  const getRecoveryStreak = useCallback((monthIndex: number): number => {
    const y = currentYear;
    if (!y) return 0;
    let streak = 0;
    for (let i = monthIndex; i >= 0; i--) {
      if (y.remarks.house70?.[String(i)] === 'BRAVO!') streak++;
      else break;
    }
    return streak;
  }, [currentYear]);

  const getInterceptorStatus = useCallback((monthIndex: number): InterceptorStatus => {
    const streak = getDisasterStreak(monthIndex);
    const y = currentYear;
    const suggestions: { name: string; annualTotal: number; monthlyAvg: number }[] = [];
    if (y && streak >= 2) {
      const legacyProtected = ['HOUSE RENT', 'SCHOOL FEE', 'SCHOOL TRANSPORT', 'ELECTRICITY', 'INTERNET', 'MILK'];
      // Protected = user-marked essential, a monthly commitment, or a known essential.
      const isProtected = (e: DataEntry) => e.essential === true || e.recurring === 'monthly' || legacyProtected.includes(e.name);
      y.householdExpenses.forEach(e => {
        const total = e.values.reduce((a, b) => a + b, 0);
        if (total > 5000 && !isProtected(e)) {
          suggestions.push({ name: e.name, annualTotal: total, monthlyAvg: Math.round(total / 12) });
        }
      });
      suggestions.sort((a, b) => b.annualTotal - a.annualTotal);
    }
    return { shouldBlock: streak >= 2, streak, suggestions: suggestions.slice(0, 3) };
  }, [currentYear, getDisasterStreak]);

  // Phase 4: YOY War Room
  const getYearComparison = useCallback((): YearComparison[] => {
    const sorted = Object.keys(state.years).sort();
    return sorted.map((year, idx) => {
      const y = state.years[year];
      const totalIncome = y.incomeEntries.reduce((s, e) => s + e.values.reduce((a, b) => a + b, 0), 0);
      const totalHousehold = y.householdExpenses.reduce((s, e) => s + e.values.reduce((a, b) => a + b, 0), 0);
      const totalSavings = y.savingsData.reduce((s, e) => s + e.values.reduce((a, b) => a + b, 0), 0);
      const totalDebtPaid = y.debtRepayment.reduce((s, e) => s + e.values.reduce((a, b) => a + b, 0), 0);
      const prev = idx > 0 ? state.years[sorted[idx - 1]] : null;
      const prevIncome = prev ? prev.incomeEntries.reduce((s, e) => s + e.values.reduce((a, b) => a + b, 0), 0) : 0;
      const prevHousehold = prev ? prev.householdExpenses.reduce((s, e) => s + e.values.reduce((a, b) => a + b, 0), 0) : 0;
      return {
        year,
        totalIncome,
        totalHousehold,
        totalSavings,
        totalDebtPaid,
        incomeGrowthPct: prevIncome > 0 ? Math.round(((totalIncome - prevIncome) / prevIncome) * 100) : 0,
        expenseCreepPct: prevHousehold > 0 ? Math.round(((totalHousehold - prevHousehold) / prevHousehold) * 100) : 0,
      };
    });
  }, [state.years]);

  const getDebtReductionVelocity = useCallback((year: string): number => {
    const y = state.years[year];
    if (!y) return 0;
    let totalPaid = 0;
    y.debtProgression.forEach(d => {
      const first = d.values.find(v => v > 0) || 0;
      const last = [...d.values].reverse().find(v => v > 0) || 0;
      totalPaid += Math.max(0, first - last);
    });
    const monthsWithData = y.debtProgression[0]?.values.filter(v => v > 0).length || 12;
    return Math.round(totalPaid / Math.max(1, monthsWithData));
  }, [state.years]);

  const getSavingsAccumulation = useCallback((year: string): number => {
    const y = state.years[year];
    if (!y) return 0;
    return y.savingsData.reduce((s, e) => s + e.values.reduce((a, b) => a + b, 0), 0);
  }, [state.years]);
// Phase 5: Family Sync
const enableFamilySync = useCallback((partnerName: string) => {
  setState(prev => {
    const y = prev.years[prev.activeYear];
    if (!y) return prev;
    const updated = { ...y, familySync: { ...y.familySync, enabled: true, partnerName }, modifiedAt: now() };
    return { ...prev, years: { ...prev.years, [prev.activeYear]: updated } };
  });
}, []);

const disableFamilySync = useCallback(() => {
  setState(prev => {
    const y = prev.years[prev.activeYear];
    if (!y) return prev;
    const updated = { ...y, familySync: { ...y.familySync, enabled: false, partnerName: '', sharedExpenses: [] }, modifiedAt: now() };
    return { ...prev, years: { ...prev.years, [prev.activeYear]: updated } };
  });
}, []);

const addSharedExpense = useCallback((name: string, amount: number, monthIndex: number, partner: string) => {
  setState(prev => {
    const y = prev.years[prev.activeYear];
    if (!y) return prev;
    const shared = [...y.familySync.sharedExpenses];
    shared.unshift({ id: `shared-${now()}`, name, amount, monthIndex, partner, timestamp: now() });
    const updated = { ...y, familySync: { ...y.familySync, sharedExpenses: shared.slice(0, 50) }, modifiedAt: now() };
    return { ...prev, years: { ...prev.years, [prev.activeYear]: updated } };
  });
}, []);

const updateNoSpendStreak = useCallback(() => {
  setState(prev => {
    const y = prev.years[prev.activeYear];
    if (!y) return prev;
    const today = new Date().toISOString().split('T')[0];
    const fs = y.familySync;
    let streak = fs.noSpendStreak;
    if (fs.lastNoSpendDate !== today) {
      streak = (fs.lastNoSpendDate === new Date(new Date(now()).getTime() - 86400000).toISOString().split('T')[0]) ? streak + 1 : 1;
    }
    const updated = { ...y, familySync: { ...fs, noSpendStreak: streak, lastNoSpendDate: today }, modifiedAt: now() };
    return { ...prev, years: { ...prev.years, [prev.activeYear]: updated } };
  });
}, []);

const getNoSpendStatus = useCallback((): NoSpendStatus => {
  const y = currentYear;
  if (!y) return { streak: 0, partnerStreak: 0, combined: 0, todaySpent: false };
  const fs = y.familySync;
  const today = new Date().toISOString().split('T')[0];
  const nowDate = new Date();
  // "Spent today" is only meaningful for the current calendar year/month.
  // (Per-day expense tracking is not in the data model yet, so recording ANY
  // expense in the current month is used as a conservative proxy.)
  const todaySpent = state.activeYear === String(nowDate.getFullYear())
    ? y.householdExpenses.some(e => e.values[nowDate.getMonth()] > 0)
    : false;
  return { streak: fs.noSpendStreak, partnerStreak: fs.partnerStreak, combined: fs.noSpendStreak + fs.partnerStreak, todaySpent };
}, [currentYear, state.activeYear]);

const generateSyncPayload = useCallback((): string => {
  const y = currentYear;
  if (!y) return '';
  const payload: SyncPayload = {
    householdExpenses: y.householdExpenses.map(e => ({ name: e.name, values: e.values })),
    noSpendStreak: y.familySync.noSpendStreak,
    partnerName: y.familySync.partnerName || 'Partner',
    timestamp: now(),
    checksum: '',
  };
  payload.checksum = btoa(JSON.stringify(payload.householdExpenses)).slice(0, 8);
  return btoa(JSON.stringify(payload));
}, [currentYear]);

const applySyncPayload = useCallback((encoded: string) => {
  let payload: SyncPayload | null = null;
  try {
    payload = JSON.parse(atob(encoded)) as SyncPayload;
  } catch {
    return; // malformed base64 or JSON
  }
  if (!payload || !Array.isArray(payload.householdExpenses)) return;
  // Reject edited/corrupted payloads â€” the same checksum is embedded on generate.
  const expectedChecksum = btoa(JSON.stringify(payload.householdExpenses)).slice(0, 8);
  if (payload.checksum && payload.checksum !== expectedChecksum) {
    console.warn('[heron] Sync payload checksum mismatch â€“ ignoring payload.', { got: payload.checksum, expectedChecksum });
    return;
  }
  setState(prev => {
      const y = prev.years[prev.activeYear];
      if (!y) return prev;
      const shared: SharedExpense[] = [];
      const household = y.householdExpenses.map(e => ({ ...e, values: [...e.values] }));
      payload.householdExpenses.forEach(pe => {
        if (!pe.name) return;
        let entry = household.find(e => e.name === pe.name);
        if (!entry) {
          // Partner tracks an expense category we do not have yet — adopt it.
          entry = { id: `sync-${pe.name.toLowerCase().replace(/\s+/g, '-')}-${now()}`, name: pe.name, values: new Array(12).fill(0), recurring: 'none', createdAt: now(), modifiedAt: now() };
          household.push(entry);
        }
        pe.values.forEach((v, mi) => {
          if (v > 0 && entry && entry.values[mi] !== v) {
            shared.push({ id: `sync-${now()}-${mi}`, name: pe.name, amount: v, monthIndex: mi, partner: payload.partnerName, timestamp: payload.timestamp });
            // Adopt the partner number where we have not recorded one; keep ours otherwise.
            if (entry.values[mi] === 0) entry.values[mi] = v;
          }
        });
      });
      const fs = y.familySync;
      const base6 = { ...y, householdExpenses: household };
      const updated = { ...base6, remarks: deriveRemarksForYear(base6), familySync: { ...fs, partnerStreak: payload.noSpendStreak, sharedExpenses: [...fs.sharedExpenses, ...shared].slice(0, 50) }, modifiedAt: now() };
      return { ...prev, years: { ...prev.years, [prev.activeYear]: updated } };
    });
}, []);

// Phase 5: Export & Backup
const exportToCSV = useCallback((): string => {
  const y = currentYear;
  if (!y) return '';
  let csv = 'Category,Entry,Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec,Total\n';
  const sections = [
    { name: 'Income', key: 'incomeEntries' as const },
    { name: 'Household', key: 'householdExpenses' as const },
    { name: 'Debt Repayment', key: 'debtRepayment' as const },
    { name: 'Savings', key: 'savingsData' as const },
    { name: 'Tax Shield', key: 'taxShieldEntries' as const },
  ];
  const csvCell = (v: string) => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
  sections.forEach(sec => {
    const entries = y[sec.key] as DataEntry[];
    entries.forEach(e => {
      const total = e.values.reduce((a, b) => a + b, 0);
      csv += `${csvCell(sec.name)},${csvCell(e.name)},${e.values.join(',')},${total}\n`;
    });
  });
  return csv;
}, [currentYear]);

const exportToJSON = useCallback((): string => {
  return JSON.stringify(state, null, 2);
}, [state]);

const importFromJSON = useCallback((json: string) => {
  try {
    const parsed = JSON.parse(json);
    const migrated = migrateV4ToV5(parsed);
    setState(migrated);
  } catch { /* ignore */ }
}, []);

﻿const generatePDFReport = useCallback((monthIndex: number): string => {
  const y = currentYear;
  if (!y) return '';
  const fmt = (v: number) => v.toLocaleString('en-IN');
  const sum = (arr: DataEntry[], m: number) => arr.reduce((sm, e) => sm + (e.values[m] || 0), 0);
  const income = sum(y.incomeEntries, monthIndex);
  const household = sum(y.householdExpenses, monthIndex);
  const debt = sum(y.debtRepayment, monthIndex);
  const savings = sum(y.savingsData, monthIndex);
  const cap = y.allocationEntries.find(e => e.id === 'house70')?.values[monthIndex] || 0;
  const capPct = cap > 0 ? Math.min(100, Math.round((household / cap) * 100)) : 0;
  const tax = getTaxShieldStatus(monthIndex);
  const insights = (y.coachInsights || []).filter(i => !i.isDismissed).slice(0, 6);
  const chart = svgGroupedBars(y.months.map((_, m) => ({ label: y.months[m].slice(0, 3), values: [sum(y.incomeEntries, m), sum(y.householdExpenses, m) + sum(y.debtRepayment, m) + sum(y.savingsData, m)] })), [{ name: 'In', color: '#30d158' }, { name: 'Out', color: '#ff453a' }]);
  const remark = y.remarks.house70?.[String(monthIndex)] || 'N/A';
  const html = `
<!DOCTYPE html>
<html><head><title>Heron Monthly Report - ${y.months[monthIndex]} ${y.year}</title><style>
body { font-family: -apple-system, sans-serif; max-width: 820px; margin: 32px auto; color: #333; }
h1 { font-size: 22px; border-bottom: 2px solid #0a84ff; padding-bottom: 8px; } h2 { font-size: 16px; margin-top: 24px; }
.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 16px 0; }
.card { background: #f5f5f7; padding: 12px; border-radius: 10px; }
.card-label { font-size: 10px; color: #666; text-transform: uppercase; }
.card-value { font-size: 17px; font-weight: 700; margin-top: 2px; }
.green { color: #30d158; } .red { color: #ff453a; } .blue { color: #0a84ff; } .orange { color: #ff9f0a; }
table { width: 100%; border-collapse: collapse; margin-top: 10px; }
th { text-align: left; padding: 8px; background: #1c1c1e; color: #fff; font-size: 11px; }
td { padding: 7px; border-bottom: 1px solid #eee; font-size: 12px; }
.badge { display: inline-block; padding: 2px 10px; border-radius: 10px; font-size: 10px; font-weight: 700; background: #eef; border: 1px solid #ccd; }
.insight { background: #f5f5f7; border-left: 4px solid #0a84ff; padding: 8px 12px; margin: 8px 0; font-size: 12px; }
.footer { margin-top: 32px; font-size: 10px; color: #999; text-align: center; }
</style></head><body>
<h1>Heron Monthly Report \u2014 ${y.months[monthIndex]} ${y.year}</h1>
<div class="cards">
<div class="card"><div class="card-label">Total Income</div><div class="card-value green">\u20b9${fmt(income)}</div></div>
<div class="card"><div class="card-label">Household</div><div class="card-value red">\u20b9${fmt(household)}</div></div>
<div class="card"><div class="card-label">Debt Repayment</div><div class="card-value blue">\u20b9${fmt(debt)}</div></div>
<div class="card"><div class="card-label">Savings</div><div class="card-value green">\u20b9${fmt(savings)}</div></div>
<div class="card"><div class="card-label">Net Flow</div><div class="card-value ${income - household - debt - savings >= 0 ? 'green' : 'red'}">\u20b9${fmt(income - household - debt - savings)}</div></div>
<div class="card"><div class="card-label">Household Cap Used</div><div class="card-value ${capPct >= 85 ? 'red' : capPct >= 60 ? 'orange' : 'green'}">${capPct}% of \u20b9${fmt(cap)}</div></div>
</div>
<h2>12-Month Income vs Outgoing</h2>
<div>${chart}</div>
<h2>Status</h2>
<p style="font-size:12px">Household: <span class="badge">${remark}</span> \u00b7 Savings: <span class="badge">${y.remarks.saving10?.[String(monthIndex)] || 'N/A'}</span> \u00b7 Debt: <span class="badge">${y.remarks.debt20?.[String(monthIndex)] || 'N/A'}</span></p>
<h2>Tax Shield</h2>
<p style="font-size:12px">Filled <b>\u20b9${fmt(Math.round(tax.filled))}</b> of \u20b9${fmt(tax.limit)} (${tax.pct}%) \u00b7 Gap \u20b9${fmt(Math.round(tax.gap))} \u00b7 Suggested monthly SIP \u20b9${fmt(tax.monthlySipNeeded)}</p>
<h2>Household Expenses</h2>
<table><thead><tr><th>Expense</th><th>Amount</th><th>% of Household</th></tr></thead><tbody>
${y.householdExpenses.filter(e => e.values[monthIndex] > 0).map(e => `<tr><td>${e.name}</td><td>\u20b9${fmt(e.values[monthIndex])}</td><td>${household > 0 ? Math.round((e.values[monthIndex] / household) * 100) : 0}%</td></tr>`).join('')}
</tbody></table>
<h2>Coach Insights</h2>
${insights.length > 0 ? insights.map(i => `<div class="insight"><b>${i.title}</b><br/>${i.description}</div>`).join('') : '<p style="font-size:12px;color:#999">No active insights for this month.</p>'}
<div class="footer">Generated by Babylonian Heron \u00b7 ${new Date().toLocaleDateString('en-IN')}</div>
</body></html>`;
  return html;
}, [currentYear, getTaxShieldStatus]);

const generateAnnualPDFReport = useCallback((): string => {
  const y = currentYear;
  if (!y) return '';
  const fmt = (v: number) => v.toLocaleString('en-IN');
  const sumAll = (arr: DataEntry[]) => arr.reduce((sm, e) => sm + e.values.reduce((a, b) => a + b, 0), 0);
  const income = sumAll(y.incomeEntries);
  const household = sumAll(y.householdExpenses);
  const debt = sumAll(y.debtRepayment);
  const savings = sumAll(y.savingsData);
  const rate = income > 0 ? Math.round(((savings + debt) / income) * 100) : 0;
  const chart = svgGroupedBars(y.months.map((_, m) => ({ label: y.months[m].slice(0, 3), values: [sum(y.incomeEntries, m), sum(y.householdExpenses, m) + sum(y.debtRepayment, m) + sum(y.savingsData, m)] })), [{ name: 'In', color: '#30d158' }, { name: 'Out', color: '#ff453a' }]);
  const debtPerMonth = y.months.map((_, m) => ({ label: y.months[m].slice(0, 3), value: y.debtProgression.reduce((sm, e) => sm + (e.values[m] || 0), 0) }));
  const hasDebt = debtPerMonth.some(p => p.value > 0);
  const debtChart = svgLineChart(debtPerMonth, '#0a84ff');
  const is80C = (c: string) => ['ppf', 'elss', 'sukanya', 'fd', 'other'].includes(c);
  let s80c = 0, sNps = 0, s80d = 0;
  y.taxShieldEntries.forEach(e => {
    const t = e.values.reduce((a, b) => a + b, 0);
    if (e.category === 'nps') sNps += t; else if (e.category === 'insurance') s80d += t; else if (is80C(e.category)) s80c += t;
  });
  const taxFilled = Math.min(150000, s80c) + Math.min(50000, sNps) + Math.min(25000, s80d);
  const taxPct = Math.round((taxFilled / 225000) * 100);
  const annualIns = generateAnnualInsights(y, y.coachSettings || defaultCoachSettings);
  const html = `
<!DOCTYPE html>
<html><head><title>Heron Annual Report - ${y.year}</title><style>
body { font-family: -apple-system, sans-serif; max-width: 820px; margin: 32px auto; color: #333; }
h1 { font-size: 22px; border-bottom: 2px solid #bf5af2; padding-bottom: 8px; } h2 { font-size: 16px; margin-top: 24px; }
.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 16px 0; }
.card { background: #f5f5f7; padding: 12px; border-radius: 10px; }
.card-label { font-size: 10px; color: #666; text-transform: uppercase; }
.card-value { font-size: 17px; font-weight: 700; margin-top: 2px; }
.green { color: #30d158; } .red { color: #ff453a; } .blue { color: #0a84ff; }
table { width: 100%; border-collapse: collapse; margin-top: 10px; }
th { text-align: left; padding: 8px; background: #1c1c1e; color: #fff; font-size: 11px; }
td { padding: 7px; border-bottom: 1px solid #eee; font-size: 12px; }
.insight { background: #f5f5f7; border-left: 4px solid #bf5af2; padding: 8px 12px; margin: 8px 0; font-size: 12px; }
.footer { margin-top: 32px; font-size: 10px; color: #999; text-align: center; }
</style></head><body>
<h1>Heron Annual Report \u2014 ${y.year}</h1>
<div class="cards">
<div class="card"><div class="card-label">Total Income</div><div class="card-value green">\u20b9${fmt(income)}</div></div>
<div class="card"><div class="card-label">Household Spending</div><div class="card-value red">\u20b9${fmt(household)}</div></div>
<div class="card"><div class="card-label">Savings Rate</div><div class="card-value blue">${rate}%</div></div>
<div class="card"><div class="card-label">Debt Repaid</div><div class="card-value blue">\u20b9${fmt(debt)}</div></div>
<div class="card"><div class="card-label">Saved / Invested</div><div class="card-value green">\u20b9${fmt(savings)}</div></div>
<div class="card"><div class="card-label">Tax Shield Filled</div><div class="card-value blue">${taxPct}%</div></div>
</div>
<h2>Monthly Income vs Outgoing</h2>
<div>${chart}</div>
${hasDebt ? '<h2>Debt Balance Progression</h2><div>' + debtChart + '</div>' : ''}
<h2>Month by Month</h2>
<table><thead><tr><th>Month</th><th>Income</th><th>Household</th><th>Debt Paid</th><th>Savings</th><th>Net</th></tr></thead><tbody>
${y.months.map((m, i) => {
    const inc = sum(y.incomeEntries, i);
    const hou = sum(y.householdExpenses, i);
    const deb = sum(y.debtRepayment, i);
    const sav = sum(y.savingsData, i);
    return `<tr><td>${m}</td><td>\u20b9${fmt(inc)}</td><td>\u20b9${fmt(hou)}</td><td>\u20b9${fmt(deb)}</td><td>\u20b9${fmt(sav)}</td><td>\u20b9${fmt(inc - hou - deb - sav)}</td></tr>`;
  }).join('')}
</tbody></table>
<h2>Household Breakdown (Year)</h2>
<table><thead><tr><th>Category</th><th>Year Total</th><th>% of Spending</th></tr></thead><tbody>
${y.householdExpenses.map(e => ({ name: e.name, total: e.values.reduce((a, b) => a + b, 0) })).filter(e => e.total > 0).sort((a, b) => b.total - a.total).map(e => `<tr><td>${e.name}</td><td>\u20b9${fmt(e.total)}</td><td>${household > 0 ? Math.round((e.total / household) * 100) : 0}%</td></tr>`).join('')}
</tbody></table>
<h2>Annual Coach Analysis</h2>
${annualIns.map(i => `<div class="insight"><b>${i.title}</b><br/>${i.description}</div>`).join('')}
<div class="footer">Generated by Babylonian Heron \u00b7 ${new Date().toLocaleDateString('en-IN')}</div>
</body></html>`;
  return html;
}, [currentYear]);

function sumAll2Month(y: YearData, m: number, section: keyof YearData): number {
  return (y[section] as DataEntry[]).reduce((sm, e) => sm + (e.values[m] || 0), 0);
}
  const getIncomeTotal = useCallback((monthIndex: number) => getTotal('incomeEntries', monthIndex), [getTotal]);
  
  const getOutgoingTotal = useCallback((monthIndex: number) => {
  const y = currentYear;
  if (!y) return 0;
  const household = y.householdExpenses.reduce((sum, e) => sum + (e.values[monthIndex] || 0), 0);
  const debt = y.debtRepayment.reduce((sum, e) => sum + (e.values[monthIndex] || 0), 0);
  const savings = y.savingsData.reduce((sum, e) => sum + (e.values[monthIndex] || 0), 0);
  return household + debt + savings;
}, [currentYear]);
  
  const getAllocationTotal = useCallback((monthIndex: number) => getTotal('allocationEntries', monthIndex), [getTotal]);
  const getHouseholdTotal = useCallback((monthIndex: number) => getTotal('householdExpenses', monthIndex), [getTotal]);
  const getDebtRepaymentTotal = useCallback((monthIndex: number) => getTotal('debtRepayment', monthIndex), [getTotal]);
  const getSavingsTotal = useCallback((monthIndex: number) => getTotal('savingsData', monthIndex), [getTotal]);
  
  // â”€â”€â”€ Coach Engine â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const generateCoachInsights = useCallback((monthIndex: number) => {
    // Entirely stable (empty deps): computes from the latest state inside
    // setState, and skips no-op writes. The App debounced effect depends on
    // this callback and [selectedMonth, activeYear]; because this callback
    // never changes identity, generation cannot loop back into the effect.
    setState(prev => {
      const yr = prev.years[prev.activeYear];
      if (!yr) return prev;
      const settings = yr.coachSettings || defaultCoachSettings;
      const newInsights = generateInsights(yr, monthIndex, settings);
      // Upsert: fresh insights (deterministic id = rule+scope) replace stale
      // copies, rules no longer generated are pruned, and an insight the user
      // already dismissed stays dismissed (never resurrected by regeneration).
      const existing = yr.coachInsights || [];
      const dismissedIds = new Set(
        existing.filter(ins => ins.isDismissed).map(ins => ins.id)
      );
      const merged = newInsights.map(ins =>
        dismissedIds.has(ins.id) ? { ...ins, isDismissed: true } : ins
      ).slice(0, 20);
      // Skip the write when nothing changed so we don't create a fresh
      // `currentYear` reference (which would retrigger generation).
      const unchanged =
        existing.length === merged.length &&
        existing.every((e, i) => e.id === merged[i].id && e.isDismissed === merged[i].isDismissed);
      if (unchanged) return prev;
      return {
        ...prev,
        years: {
          ...prev.years,
          [prev.activeYear]: { ...yr, coachInsights: merged },
        },
      };
    });
  }, []);

  const dismissCoachInsight = useCallback((insightId: string) => {
    setState(prev => {
      const y = prev.years[prev.activeYear];
      if (!y) return prev;
      const insights = y.coachInsights.map(ins => 
        ins.id === insightId ? { ...ins, isDismissed: true } : ins
      );
      const updated = { ...y, coachInsights: insights, modifiedAt: now() };
      return { ...prev, years: { ...prev.years, [prev.activeYear]: updated } };
    });
  }, []);

  const updateCoachSettings = useCallback((newSettings: Partial<CoachSettings>) => {
    setState(prev => {
      const y = prev.years[prev.activeYear];
      if (!y) return prev;
      const updated = { 
        ...y, 
        coachSettings: { ...y.coachSettings, ...newSettings },
        modifiedAt: now() 
      };
      return { ...prev, years: { ...prev.years, [prev.activeYear]: updated } };
    });
  }, []);
  
  return {
    state,
    currentYear,
    updateEntryValue,
    updateEntryName,
    addEntry,
    deleteEntry,
    setActiveYear,
    addYear,
    deleteYear,
    resetToDefaults,
    completeSetup,
    autoAllocate,
    autoAllocateAll,
    toggleEntryEssential,
    addDebt,
    syncDebtEmiToOutflows,
    queueTransactions,
    confirmImportedTxn,
    rejectProcessedTxn,
    clearImportedMonth,
    addImportRule,
    deleteImportRule,
    setPasscode,
    verifyPasscode,
    getBurnRate,
    getIncomeTotal,
    getOutgoingTotal,
    getAllocationTotal,
    getHouseholdTotal,
    getDebtRepaymentTotal,
    getSavingsTotal,
    toggleRecurring,
    applyRecurringAutopilot,
    getCommittedRecurring,
    getTrueDisposable,
    updateDebtMeta,
    getCurrentDebtBalance,
    getDebtMonthsRemaining,
    calculateDebtPayoff,
    calculateExtraPaymentImpact,
    addTaxEntry,
    updateTaxEntryValue,
    deleteTaxEntry,
    getTaxShieldStatus,
    detectWindfall,
    applyWindfall,
    setWindfallBaseline,
    getDisasterStreak,
    getRecoveryStreak,
    getInterceptorStatus,
    getYearComparison,
    getDebtReductionVelocity,
    getSavingsAccumulation,
    enableFamilySync,
    disableFamilySync,
    addSharedExpense,
    updateNoSpendStreak,
    getNoSpendStatus,
    generateSyncPayload,
    applySyncPayload,
    exportToCSV,
    exportToJSON,
    importFromJSON,
    generatePDFReport,
    generateAnnualPDFReport,
  generateCoachInsights,
  dismissCoachInsight,
  updateCoachSettings,    
  };
}


