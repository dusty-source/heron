
// src/coachEngine.ts
import { YearData } from './store/useBudgetStore';
import { forecastNextMonth } from './utils/forecast';

export interface CoachInsight {
  id: string;
  type: 'alert' | 'warning' | 'suggestion' | 'reminder' | 'positive';
  category: 'income' | 'household' | 'debt' | 'savings' | 'general';
  title: string;
  description: string;
  action?: {
    label: string;
    target: 'overview' | 'details' | 'debt' | 'tax' | 'war' | 'sync';
    payload?: any;
  };
  generatedAt: string;
  isDismissed: boolean;
  priority: number; // 1 = high, 2 = medium, 3 = low
}

export interface CoachSettings {
  enabledRules: string[]; // rule IDs: 'capAlert', 'spikeDetection', 'recurringReminder', 'savingsCheck', 'debtAcceleration', 'windfall', 'emergencyFund', 'disasterStreak', 'recoveryStreak', 'predictiveAlert'
  thresholds: {
    capWarning: number;          // default: 0.7
    spikeFactor: number;         // default: 1.5
    predictiveWarning: number;   // default: 0.9
    emergencyMonths: number;     // default: 3
  };
}

export const defaultCoachSettings: CoachSettings = {
  enabledRules: [
    'capAlert',
    'spikeDetection',
    'recurringReminder',
    'savingsCheck',
    'debtAcceleration',
    'windfall',
    'emergencyFund',
    'disasterStreak',
    'recoveryStreak',
    'predictiveAlert',
  ],
  thresholds: {
    capWarning: 0.7,
    spikeFactor: 1.5,
    predictiveWarning: 0.9,
    emergencyMonths: 3,
  },
};

// Helper to format currency (keep consistent with app)
function formatCurrency(val: number): string {
  if (val === 0) return '0';
  return val.toLocaleString('en-IN');
}

// Helper to compute totals (duplicate minimal logic to avoid dependency cycle)
function getTotalForYear(yearData: YearData, section: keyof YearData, monthIndex: number): number {
  const entries = yearData[section] as any[];
  if (!entries) return 0;
  return entries.reduce((sum: number, e: any) => sum + (e.values[monthIndex] || 0), 0);
}

function getHouseholdTotal(yearData: YearData, monthIndex: number): number {
  return getTotalForYear(yearData, 'householdExpenses', monthIndex);
}

function getIncomeTotal(yearData: YearData, monthIndex: number): number {
  return getTotalForYear(yearData, 'incomeEntries', monthIndex);
}

function getDebtTotal(yearData: YearData, monthIndex: number): number {
  return getTotalForYear(yearData, 'debtRepayment', monthIndex);
}

function getSavingsTotal(yearData: YearData, monthIndex: number): number {
  return getTotalForYear(yearData, 'savingsData', monthIndex);
}

function getDebtBalance(yearData: YearData): number {
  // Anchored to the current calendar month (same semantics as the store's
  // getCurrentDebtBalance) so coach debt advice matches the simulator.
  const anchor = yearData.year === String(new Date().getFullYear()) ? new Date().getMonth() : 11;
  let total = 0;
  (yearData.debtProgression || []).forEach(d => {
    let balance = 0;
    for (let i = anchor; i >= 0; i--) {
      if (d.values[i] > 0) { balance = d.values[i]; break; }
    }
    if (balance === 0) {
      for (let i = anchor + 1; i < d.values.length; i++) {
        if (d.values[i] > 0) { balance = d.values[i]; break; }
      }
    }
    total += balance;
  });
  return total;
}

function getDisasterStreak(yearData: YearData, monthIndex: number): number {
  let streak = 0;
  for (let i = monthIndex; i >= 0; i--) {
    if (yearData.remarks.house70?.[String(i)] === 'DISASTER IN MAKING') streak++;
    else break;
  }
  return streak;
}

function getRecoveryStreak(yearData: YearData, monthIndex: number): number {
  let streak = 0;
  for (let i = monthIndex; i >= 0; i--) {
    if (yearData.remarks.house70?.[String(i)] === 'BRAVO!') streak++;
    else break;
  }
  return streak;
}

export function generateInsights(
  yearData: YearData,
  monthIndex: number,
  settings: CoachSettings
): CoachInsight[] {
  const insights: CoachInsight[] = [];
  const currentMonth = yearData.months[monthIndex] || '';
  const income = getIncomeTotal(yearData, monthIndex);
  const household = getHouseholdTotal(yearData, monthIndex);
  const debt = getDebtTotal(yearData, monthIndex);
  const savings = getSavingsTotal(yearData, monthIndex);
  const allocation = yearData.allocationEntries;
  const cap = allocation.find(e => e.id === 'house70')?.values[monthIndex] || 0;
  const totalSavings = yearData.savingsData.reduce((s, e) => s + e.values.reduce((a, b) => a + b, 0), 0);
  const avgHousehold = yearData.householdExpenses.reduce((s, e) => s + e.values.reduce((a, b) => a + b, 0), 0) / 12;

  // --- Rule 1: Household cap alert ---
  if (settings.enabledRules.includes('capAlert') && cap > 0) {
    const pct = (household / cap) * 100;
    const threshold = settings.thresholds.capWarning * 100;
    if (pct >= threshold) {
      insights.push({
        id: `cap-${monthIndex}`,
        type: pct >= 90 ? 'alert' : 'warning',
        category: 'household',
        title: pct >= 90 ? '⚠️ Critical Budget Usage' : '📈 Budget Approaching Cap',
        description: `You've used ${Math.round(pct)}% of your ₹${formatCurrency(cap)} household budget for ${currentMonth}.`,
        action: { label: 'View Expenses', target: 'details' },
        generatedAt: new Date().toISOString(),
        isDismissed: false,
        priority: pct >= 90 ? 1 : 2,
      });
    }
  }

  // --- Rule 2: Spike detection per category ---
  if (settings.enabledRules.includes('spikeDetection')) {
    yearData.householdExpenses.forEach(exp => {
      const currentVal = exp.values[monthIndex] || 0;
      if (currentVal === 0) return;
      const prevVals = exp.values.slice(Math.max(0, monthIndex - 2), monthIndex);
      const avg = prevVals.length ? prevVals.reduce((a, b) => a + b, 0) / prevVals.length : 0;
      const factor = settings.thresholds.spikeFactor;
      if (avg > 0 && currentVal > avg * factor) {
        insights.push({
          id: `spike-${exp.id}-${monthIndex}`,
          type: 'warning',
          category: 'household',
          title: `💰 Spike in ${exp.name}`,
          description: `Spent ₹${formatCurrency(currentVal)} this month vs. average ₹${formatCurrency(Math.round(avg))}.`,
          action: { label: 'Review', target: 'details' },
          generatedAt: new Date().toISOString(),
          isDismissed: false,
          priority: 2,
        });
      }
    });
  }

  // --- Rule 3: Missing recurring expense ---
  if (settings.enabledRules.includes('recurringReminder')) {
    yearData.householdExpenses.forEach(exp => {
      if (exp.recurring && exp.recurring !== 'none' && (exp.values[monthIndex] || 0) === 0) {
        insights.push({
          id: `recurring-${exp.id}-${monthIndex}`,
          type: 'reminder',
          category: 'household',
          title: `📅 ${exp.name} is due`,
          description: `Your recurring ${exp.name} hasn't been recorded for ${currentMonth}.`,
          action: { label: 'Add Now', target: 'details', payload: { entryId: exp.id, month: monthIndex } },
          generatedAt: new Date().toISOString(),
          isDismissed: false,
          priority: 3,
        });
      }
    });
  }

  // --- Rule 4: Savings shortfall ---
  if (settings.enabledRules.includes('savingsCheck')) {
    const target = Math.round(income * 0.10);
    if (savings < target && income > 0) {
      insights.push({
        id: `savings-${monthIndex}`,
        type: 'suggestion',
        category: 'savings',
        title: '📉 Boost Your Savings',
        description: `You saved ₹${formatCurrency(savings)} – aim for ₹${formatCurrency(target)} (10% of income).`,
        action: { label: 'Adjust Budget', target: 'details' },
        generatedAt: new Date().toISOString(),
        isDismissed: false,
        priority: 2,
      });
    }
  }

  // --- Rule 5: Debt acceleration opportunity ---
  if (settings.enabledRules.includes('debtAcceleration')) {
    const debtBalance = getDebtBalance(yearData);
    const totalEmi = yearData.debtRepayment.reduce((sum, e) => sum + (e.values[monthIndex] || 0), 0);
    if (debtBalance > 0 && totalEmi > 0 && debtBalance > 3 * totalEmi) {
      insights.push({
        id: `debt-${monthIndex}`,
        type: 'suggestion',
        category: 'debt',
        title: '💳 Accelerate Debt Payoff',
        description: `Remaining debt ₹${formatCurrency(debtBalance)} is high. Extra ₹5,000/month could save months.`,
        action: { label: 'See Simulator', target: 'debt' },
        generatedAt: new Date().toISOString(),
        isDismissed: false,
        priority: 2,
      });
    }
  }

  // --- Rule 6: Windfall alert (reuse existing logic, but we simulate detection) ---
  if (settings.enabledRules.includes('windfall')) {
    // Simple detection: income > 1.2 * average of previous 3 months
    let baseline = 0;
    let count = 0;
    for (let i = monthIndex - 1; i >= 0 && count < 3; i--) {
      const inc = getIncomeTotal(yearData, i);
      if (inc > 0) { baseline += inc; count++; }
    }
    baseline = count > 0 ? baseline / count : income;
    if (income > baseline * 1.2 && income - baseline > 5000) {
      const extra = income - baseline;
      insights.push({
        id: `windfall-${monthIndex}`,
        type: 'positive',
        category: 'income',
        title: '🎉 Windfall Detected!',
        description: `Extra income of ₹${formatCurrency(extra)} – consider allocating 70% buffer, 20% debt, 10% savings.`,
        action: { label: 'Apply Allocation', target: 'overview' },
        generatedAt: new Date().toISOString(),
        isDismissed: false,
        priority: 1,
      });
    }
  }

  // --- Rule 7: Emergency fund check ---
  if (settings.enabledRules.includes('emergencyFund')) {
    const recommended = avgHousehold * settings.thresholds.emergencyMonths;
    if (avgHousehold > 0 && totalSavings < recommended) {
      insights.push({
        id: `emergency-${monthIndex}`,
        type: 'alert',
        category: 'savings',
        title: '🚨 Emergency Fund Low',
        description: `You have ₹${formatCurrency(totalSavings)} saved – recommended: ₹${formatCurrency(Math.round(recommended))} (${settings.thresholds.emergencyMonths} months of expenses).`,
        action: { label: 'Increase Savings', target: 'details' },
        generatedAt: new Date().toISOString(),
        isDismissed: false,
        priority: 1,
      });
    }
  }

  // --- Rule 8: Progress streaks (motivational) ---
  if (settings.enabledRules.includes('disasterStreak')) {
    const disasterStreak = getDisasterStreak(yearData, monthIndex);
    if (disasterStreak >= 2) {
      insights.push({
        id: `disaster-${monthIndex}`,
        type: 'alert',
        category: 'general',
        title: `🔥 ${disasterStreak} Months of Overspending`,
        description: 'You’ve been in disaster mode. Time to act!',
        action: { label: 'Review Interceptor', target: 'war' },
        generatedAt: new Date().toISOString(),
        isDismissed: false,
        priority: 1,
      });
    }
  }
  if (settings.enabledRules.includes('recoveryStreak')) {
    const recoveryStreak = getRecoveryStreak(yearData, monthIndex);
    if (recoveryStreak >= 2) {
      insights.push({
        id: `recovery-${monthIndex}`,
        type: 'positive',
        category: 'general',
        title: `🌟 ${recoveryStreak} Months of Recovery!`,
        description: 'You’re back on track – keep it going.',
        action: { label: 'Celebrate', target: 'overview' },
        generatedAt: new Date().toISOString(),
        isDismissed: false,
        priority: 3,
      });
    }
  }

  // --- Rule 9: Predictive Alert (next month overspend) ---
  if (settings.enabledRules.includes('predictiveAlert')) {
    // Get total household expense per month for the entire year
    const monthlyTotals = yearData.months.map((_, idx) => getHouseholdTotal(yearData, idx));
    const forecast = forecastNextMonth(monthlyTotals);
    if (forecast && cap > 0) {
      const threshold = settings.thresholds.predictiveWarning;
      if (forecast.predicted > cap * threshold) {
        const pct = Math.round((forecast.predicted / cap) * 100);
        insights.push({
          id: `predict-${monthIndex}`,
          type: 'warning',
          category: 'household',
          title: '🔮 Next Month Projection',
          description: `Your spending trend suggests ₹${formatCurrency(forecast.predicted)} next month – ${pct}% of your ₹${formatCurrency(cap)} cap. ${forecast.r2 > 0.7 ? ' (high confidence)' : ''}`,
          action: { label: 'Adjust Now', target: 'details' },
          generatedAt: new Date().toISOString(),
          isDismissed: false,
          priority: 1,
        });
      }
    }
  }

  // Sort by priority (1 highest) and then by date (newest first)
  insights.sort((a, b) => a.priority - b.priority || new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());

  return insights;
}

// Annual analysis: savings rate, spending spread, concentration, debt, tax shield.
export function generateAnnualInsights(yearData: YearData, settings: CoachSettings): CoachInsight[] {
  const insights: CoachInsight[] = [];
  const year = yearData.year;
  const sum = (arr: { values: number[] }[]) => arr.reduce((s2, e) => s2 + e.values.reduce((a, b) => a + b, 0), 0);
  const income = sum(yearData.incomeEntries);
  const household = sum(yearData.householdExpenses);
  const savings = sum(yearData.savingsData);
  const debtPaid = sum(yearData.debtRepayment);
  const activeMonths = yearData.months.filter((_, i) => yearData.incomeEntries.some(e => e.values[i] > 0) || yearData.householdExpenses.some(e => e.values[i] > 0)).length;
  const push = (ins: Omit<CoachInsight, 'generatedAt' | 'isDismissed'>) => insights.push({ ...ins, generatedAt: new Date().toISOString(), isDismissed: false });
  if (activeMonths === 0) {
    push({ id: `annual-nodata-${year}`, type: 'reminder', category: 'general', priority: 3, title: `No data for ${year} yet`, description: 'Import a bank statement (Sync tab) or add entries in Details to unlock the annual analysis.' });
    return insights;
  }
  if (income > 0) {
    const kept = savings + debtPaid;
    const rate = Math.round((kept / income) * 100);
    push({ id: `annual-savingsrate-${year}`, type: rate >= 30 ? 'positive' : rate >= 10 ? 'suggestion' : 'warning', category: 'savings', priority: 1, title: `You kept ${rate}% of your income in ${year}`, description: `Savings ${formatCurrency(savings)} + debt payments ${formatCurrency(debtPaid)} = ${formatCurrency(kept)} of ${formatCurrency(income)} income. ${rate >= 30 ? 'Excellent discipline.' : rate >= 10 ? 'Aim for 30% by year end.' : 'Try to raise this above 10%.'}` });
  }
  const monthHouse = yearData.months.map((_, i) => getHouseholdTotal(yearData, i));
  const withData = monthHouse.map((v, i) => ({ v, i })).filter(x => x.v > 0);
  if (withData.length >= 2) {
    const max = withData.reduce((a, b) => (b.v > a.v ? b : a));
    const min = withData.reduce((a, b) => (b.v < a.v ? b : a));
    push({ id: `annual-spread-${year}`, type: 'suggestion', category: 'household', priority: 2, title: `Biggest spending gap: ${Math.round(((max.v - min.v) / min.v) * 100)}%`, description: `Highest: ${yearData.months[max.i]} at ${formatCurrency(max.v)}; lowest: ${yearData.months[min.i]} at ${formatCurrency(min.v)}. Levelling out this swing smooths your year.` });
  }
  const top = [...yearData.householdExpenses].map(e => ({ name: e.name, total: e.values.reduce((a, b) => a + b, 0) })).filter(e => e.total > 0).sort((a, b) => b.total - a.total).slice(0, 3);
  if (top.length > 0 && household > 0) {
    const share = Math.round((top.reduce((s2, e) => s2 + e.total, 0) / household) * 100);
    push({ id: `annual-concentration-${year}`, type: 'suggestion', category: 'household', priority: 2, title: `Top ${top.length} categories = ${share}% of spending`, description: top.map(e => `${e.name}: ${formatCurrency(e.total)}`).join(' | ') });
  }
  const capTotal = (yearData.allocationEntries.find(e => e.id === 'house70')?.values.reduce((a, b) => a + b, 0)) || 0;
  if (capTotal > 0) {
    const pct = Math.round((household / capTotal) * 100);
    if (pct > 100) push({ id: `annual-cap-${year}`, type: 'alert', category: 'household', priority: 1, title: `${pct}% of your annual household budget used`, description: `Spent ${formatCurrency(household)} against a ${formatCurrency(capTotal)} yearly cap.` });
    else if (pct >= 90) push({ id: `annual-cap-${year}`, type: 'warning', category: 'household', priority: 1, title: `${pct}% of your annual household budget used`, description: `Spent ${formatCurrency(household)} of ${formatCurrency(capTotal)}. Watch the remaining months closely.` });
  }
  let debtStart = 0, debtEnd = 0;
  yearData.debtProgression.forEach(d => {
    const first = d.values.find(v => v > 0) || 0;
    const last = [...d.values].reverse().find(v => v > 0) || 0;
    debtStart += first; debtEnd += last;
  });
  if (debtStart > debtEnd) {
    push({ id: `annual-debt-${year}`, type: 'positive', category: 'debt', priority: 2, title: `Debt reduced by ${formatCurrency(debtStart - debtEnd)} in ${year}`, description: `From ${formatCurrency(debtStart)} down to ${formatCurrency(debtEnd)}. Check the simulator for faster payoff options.` });
  } else if (debtEnd > 0) {
    push({ id: `annual-debt-${year}`, type: 'suggestion', category: 'debt', priority: 2, title: `${formatCurrency(debtEnd)} of debt outstanding`, description: 'No reduction recorded this year. Visit the Debt tab to plan an accelerated payoff.' });
  }
  const is80C = (c: string) => ['ppf', 'elss', 'sukanya', 'fd', 'other'].includes(c);
  let s80c = 0, sNps = 0, s80d = 0;
  yearData.taxShieldEntries.forEach(e => {
    const t = e.values.reduce((a, b) => a + b, 0);
    if (e.category === 'nps') sNps += t; else if (e.category === 'insurance') s80d += t; else if (is80C(e.category)) s80c += t;
  });
  const taxFilled = Math.min(150000, s80c) + Math.min(50000, sNps) + Math.min(25000, s80d);
  if (taxFilled > 0) {
    const tp = Math.round((taxFilled / 225000) * 100);
    push({ id: `annual-tax-${year}`, type: tp >= 80 ? 'positive' : 'reminder', category: 'savings', priority: 3, title: `Tax shield ${tp}% filled for ${year}`, description: `${formatCurrency(taxFilled)} of qualifying investments recorded across the year.` });
  }
  insights.sort((a, b) => a.priority - b.priority);
  return insights;
}
