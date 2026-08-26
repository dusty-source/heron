
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
  // Sum last positive value of each debt progression
  let total = 0;
  (yearData.debtProgression || []).forEach(d => {
    for (let i = d.values.length - 1; i >= 0; i--) {
      if (d.values[i] > 0) { total += d.values[i]; break; }
    }
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
        id: `cap-${Date.now()}-${Math.random()}`,
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
          id: `spike-${exp.id}-${Date.now()}-${Math.random()}`,
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
          id: `recurring-${exp.id}-${Date.now()}-${Math.random()}`,
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
        id: `savings-${Date.now()}-${Math.random()}`,
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
        id: `debt-${Date.now()}-${Math.random()}`,
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
        id: `windfall-${Date.now()}-${Math.random()}`,
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
        id: `emergency-${Date.now()}-${Math.random()}`,
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
        id: `disaster-${Date.now()}-${Math.random()}`,
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
        id: `recovery-${Date.now()}-${Math.random()}`,
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
          id: `predict-${Date.now()}-${Math.random()}`,
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
