export const months = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'
];

export const formatCurrency = (val: number) => {
  if (val === 0) return '0';
  return val.toLocaleString('en-IN');
};

export const getStatusColor = (val: number) => {
  if (val > 0) return '#30d158';
  if (val < 0) return '#ff453a';
  return '#8e8e93';
};

export const getRemarkColor = (remark: string) => {
  switch (remark) {
    case 'BRAVO!': return '#30d158';
    case 'IN CONTROL': return '#0a84ff';
    case 'WISHFUL FLOCK': return '#ff9f0a';
    case 'HAND TO MOUTH': return '#ff453a';
    case 'DISASTER IN MAKING': return '#ff375f';
    case 'RETAINER': return '#bf5af2';
    default: return '#8e8e93';
  }
};

// ─── Phase 1: Burn-Rate & Allocation Helpers ─────────────────

export const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

export interface BurnRate {
  spent: number;
  cap: number;
  remaining: number;
  dailyVelocity: number;
  daysUntilExhaustion: number;
  daysRemaining: number;
  dailyAllowance: number;
  usedPct: number;
  isCapReached: boolean;
  status: string;
}

export const calculateBurnRate = (
  spent: number,
  cap: number,
  dayOfMonth: number,
  totalDaysInMonth: number
): BurnRate | null => {
  if (cap <= 0 || dayOfMonth <= 0) return null;
  const dailyVelocity = spent / dayOfMonth;
  const remaining = Math.max(0, cap - spent);
  const daysUntilExhaustion = dailyVelocity > 0 ? Math.ceil(remaining / dailyVelocity) : 999;
  const daysRemaining = totalDaysInMonth - dayOfMonth + 1;
  const dailyAllowance = daysRemaining > 0 ? remaining / daysRemaining : 0;
  const usedPct = Math.min(100, (spent / cap) * 100);
  const status = usedPct >= 100 ? 'BROKEN' : usedPct >= 85 ? 'DISASTER IN MAKING' : usedPct >= 60 ? 'WATCH OUT' : usedPct >= 30 ? 'ON TRACK' : 'BRAVO!';
  return { spent, cap, remaining, dailyVelocity, daysUntilExhaustion, daysRemaining, dailyAllowance, usedPct, isCapReached: spent >= cap, status };
};

export const getBurnRingColor = (usedPct: number) => {
  if (usedPct >= 85) return '#ff375f';
  if (usedPct >= 60) return '#ff9f0a';
  return '#30d158';
};

export const getBurnStatusColor = (status: string) => {
  switch (status) {
    case 'BRAVO!': return '#30d158';
    case 'ON TRACK': return '#0a84ff';
    case 'WATCH OUT': return '#ff9f0a';
    case 'DISASTER IN MAKING': return '#ff375f';
    case 'BROKEN': return '#ff453a';
    default: return '#8e8e93';
  }
};

// ─── Phase 3: Tax Shield Helpers ─────────────────────────────

export const TAX_CATEGORIES: Record<string, { label: string; color: string; icon: string }> = {
  ppf: { label: 'PPF', color: '#30d158', icon: 'Shield' },
  elss: { label: 'ELSS', color: '#0a84ff', icon: 'TrendingUp' },
  nps: { label: 'NPS', color: '#bf5af2', icon: 'Briefcase' },
  sukanya: { label: 'Sukanya', color: '#ff375f', icon: 'Heart' },
  insurance: { label: 'Insurance', color: '#ff9f0a', icon: 'Umbrella' },
  fd: { label: 'Tax FD', color: '#5ac8fa', icon: 'Landmark' },
  other: { label: 'Other', color: '#8e8e93', icon: 'FileText' },
};

export const getTaxCategoryColor = (cat: string) => TAX_CATEGORIES[cat]?.color || '#8e8e93';
