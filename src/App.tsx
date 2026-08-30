import { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wallet, TrendingUp, TrendingDown, Home, CreditCard, PiggyBank,
  BarChart3, Activity, Plus, Trash2,
  Edit3, Check, RotateCcw, Clock, AlertTriangle, Lock, Settings,
  Shield, Sparkles, ChevronRight, X, Repeat, Target, Swords, AlertOctagon,
  Zap, Users, Download, FileText, FileSpreadsheet, QrCode, ScanLine, Copy,
  CheckCircle2, Share2, Lightbulb, Eye, EyeOff
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie,
  BarChart, Bar, LineChart, Line
} from 'recharts';
import { useBudgetStore } from './store/useBudgetStore';
import type { TaxEntry, WindfallResult, InterceptorStatus, NoSpendStatus, SharedExpense, YearData } from './store/useBudgetStore';
import { formatCurrency, getStatusColor, getRemarkColor, getBurnRingColor, getBurnStatusColor, getTaxCategoryColor } from './data/budgetData';
import type { BurnRate } from './data/budgetData';
import { generateAnnualInsights, defaultCoachSettings } from './coachEngine';
import { parseCsvStatement, type ParsedTxn, type DateOrder, type ParseResult, gridToCsv, diagnosticsToCsv } from './utils/statementParser';
import { parsePdfStatementAccurate } from './utils/pdfStatementAdapter';

type Tab = 'overview' | 'details' | 'debt' | 'tax' | 'war' | 'sync' | 'coach';
type EditSection = 'income' | 'household' | 'debt-repay' | 'savings' | 'debt-prog' | 'tax' | null;
type PasscodeMode = 'set' | 'verify' | null;
type RecurringFreq = 'none' | 'monthly' | 'quarterly' | 'annual';

const MONTHS_12 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ─── Animated Number ─────────────────────────────────────── */
function AnimatedNumber({ value, prefix = '' }: { value: number; prefix?: string }) {
  return (
    <motion.span key={value} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="tabular-nums">
      {prefix}{formatCurrency(value)}
    </motion.span>
  );
}

/* ─── Summary Strip Card ─────────────────────────────────── */
function SummaryStripCard({ title, value, icon, color, subtitle, delay }: {
  title: string; value: number; icon: React.ReactNode; color: string; subtitle?: string; delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, type: 'spring' }}
      className="summary-strip-card glass-card rounded-2xl p-3.5 ios-shadow card-hover snap-start"
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${color}18`, color }}>{icon}</div>
        <span className="text-[10px] text-ios-text-secondary font-semibold uppercase tracking-wider">{title}</span>
      </div>
      <div className="text-[15px] font-bold text-ios-text leading-tight tracking-tight">
        <AnimatedNumber value={Math.abs(value)} prefix={value < 0 ? '-' : ''} />
      </div>
      {subtitle && <div className="text-[9px] text-ios-text-secondary mt-1">{subtitle}</div>}
    </motion.div>
  );
}

/* ─── Progress Bar ────────────────────────────────────────── */
function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((Math.abs(value) / max) * 100, 100) : 0;
  return (
    <div className="w-full h-1.5 bg-ios-surface-2 rounded-full overflow-hidden">
      <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, ease: 'easeOut' }} className="h-full rounded-full" style={{ background: color }} />
    </div>
  );
}

/* ─── Status Badge ────────────────────────────────────────── */
function StatusBadge({ text }: { text: string }) {
  const color = getRemarkColor(text);
  return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: `${color}15`, color, border: `1px solid ${color}25` }}>{text}</span>;
}

/* ─── Recurring Badge ─────────────────────────────────────── */
function RecurringBadge({ freq }: { freq?: RecurringFreq }) {
  if (!freq || freq === 'none') return null;
  const colors = { monthly: '#30d158', quarterly: '#0a84ff', annual: '#bf5af2' };
  const labels = { monthly: 'M', quarterly: 'Q', annual: 'A' };
  return (
    <span className="recurring-badge" style={{ background: `${colors[freq]}18`, color: colors[freq] }}>
      <Repeat size={8} className="mr-0.5 inline" />{labels[freq]}
    </span>
  );
}

/* ─── Editable Row ────────────────────────────────────────── */
function EditableRow({
  name, value, onChange, onNameChange, onDelete, isEditing, recurring, onRecurringChange, essential, onToggleEssential
}: {
  name: string; value: number; onChange: (v: number) => void;
  onNameChange?: (n: string) => void; onDelete?: () => void;
  isEditing: boolean; recurring?: RecurringFreq; onRecurringChange?: (f: RecurringFreq) => void;
  essential?: boolean; onToggleEssential?: () => void;
}) {
  const [localVal, setLocalVal] = useState(String(value));
  const [localName, setLocalName] = useState(name);
  const localValRef = useRef(localVal);
  const localNameRef = useRef(localName);
  const wasEditing = useRef(isEditing);

  useEffect(() => { localValRef.current = localVal; }, [localVal]);
  useEffect(() => { localNameRef.current = localName; }, [localName]);

  // Commit pending changes when edit mode is exited
  useEffect(() => {
    if (wasEditing.current && !isEditing) {
      onChange(Number(localValRef.current) || 0);
      if (onNameChange) onNameChange(localNameRef.current);
    }
    wasEditing.current = isEditing;
  }, [isEditing, onChange, onNameChange]);

  // Sync with props when not editing
  useEffect(() => {
    if (!isEditing) {
      setLocalVal(String(value));
      setLocalName(name);
    }
  }, [value, name, isEditing]);

  if (!isEditing) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-between py-2 px-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[13px] text-ios-text-secondary truncate">{name}</span>
          <RecurringBadge freq={recurring} />
          {essential && <span className="text-[10px]" title="Essential — protected from Interceptor cuts">🛡</span>}
        </div>
        <span className="text-[13px] font-semibold text-ios-text tabular-nums">{formatCurrency(value)}</span>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 py-1.5 px-1 flex-wrap">
      {onNameChange && (
        <input value={localName} onChange={e => setLocalName(e.target.value)} onBlur={() => onNameChange(localName)}
          className="flex-1 min-w-0 bg-ios-surface-2 rounded-xl px-3 py-1.5 text-[13px] text-ios-text border border-ios-border/30 focus:border-ios-blue outline-none" />
      )}
      {!onNameChange && <span className="flex-1 text-[13px] text-ios-text-secondary truncate">{name}</span>}
      <input type="number" value={localVal} onChange={e => setLocalVal(e.target.value)} onBlur={() => onChange(Number(localVal) || 0)}
        className="w-24 bg-ios-surface-2 rounded-xl px-3 py-1.5 text-[13px] text-ios-text text-right border border-ios-border/30 focus:border-ios-blue outline-none tabular-nums" />
      {onRecurringChange && (
        <div className="flex gap-0.5">
          {(['none','monthly','quarterly','annual'] as RecurringFreq[]).map(f => (
            <button key={f} onClick={() => onRecurringChange(f)}
              className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase transition-all ${recurring === f ? 'bg-ios-blue text-white' : 'bg-ios-surface-2 text-ios-text-secondary'}`}>
              {f === 'none' ? '×' : f[0]}
            </button>
          ))}
        </div>
      )}
      {onToggleEssential && (
        <motion.button whileTap={{ scale: 0.8 }} onClick={onToggleEssential}
          className={`w-7 h-7 rounded-lg flex items-center justify-center text-[11px] ${essential ? 'bg-ios-green/20 text-ios-green' : 'bg-ios-surface-2 text-ios-text-secondary'}`}
          title="Mark as essential (protected from Interceptor cuts)">🛡</motion.button>
      )}
      {onDelete && (
        <motion.button whileTap={{ scale: 0.8 }} onClick={onDelete} className="w-7 h-7 rounded-lg bg-ios-red/15 flex items-center justify-center text-ios-red">
          <Trash2 size={13} />
        </motion.button>
      )}
    </motion.div>
  );
}



/* ─── Bottom Sheet ────────────────────────────────────────── */
function BottomSheet({ isOpen, onClose, title, children }: { isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-md flex items-end justify-center"
          onClick={onClose}>
          <motion.div initial={{ y: '110%' }} animate={{ y: 0 }} exit={{ y: '110%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="bottom-sheet w-full rounded-t-3xl p-5 pb-10 max-w-lg max-h-[88dvh] flex flex-col overflow-y-auto scroll-touch"
            onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-ios-text-secondary/25 rounded-full mx-auto mb-5 shrink-0" />
            <h3 className="text-lg font-bold text-ios-text mb-4 shrink-0">{title}</h3>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ─── Phase 1: BurnRateCard ───────────────────────────────── */
function BurnRateCard({ burn }: { burn: BurnRate }) {
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (burn.usedPct / 100) * circumference;
  const color = getBurnRingColor(burn.usedPct);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.5 }}
      className="glass-card rounded-2xl p-4 ios-shadow relative overflow-hidden">
      <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full opacity-20" style={{ background: color, filter: 'blur(40px)' }} />
      <div className="flex items-center gap-3 relative z-10">
        <div className="burn-ring">
          <svg viewBox="0 0 56 56">
            <circle className="burn-ring-bg" cx="28" cy="28" r={radius} />
            <circle className="burn-ring-progress" cx="28" cy="28" r={radius}
              stroke={color} strokeDasharray={circumference} strokeDashoffset={offset} />
          </svg>
          <div className="burn-ring-text" style={{ color }}>{Math.round(burn.usedPct)}%</div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-ios-text-secondary mb-0.5 font-medium">Daily Allowance</div>
          <div className="text-xl font-bold tabular-nums tracking-tight" style={{ color: getBurnStatusColor(burn.status) }}>
            {formatCurrency(Math.round(burn.dailyAllowance))}
            <span className="text-[11px] font-normal text-ios-text-secondary ml-1">/day</span>
          </div>
          <div className="text-[10px] text-ios-text-secondary mt-1">
            {burn.isCapReached ? (
              <span className="text-ios-red font-semibold">CAP BROKEN — {formatCurrency(burn.spent - burn.cap)} over</span>
            ) : burn.daysUntilExhaustion <= burn.daysRemaining ? (
              <span>Exhausts in <span className="font-semibold text-ios-orange">{burn.daysUntilExhaustion} days</span></span>
            ) : (
              <span>Safe — <span className="font-semibold text-ios-green">{burn.daysRemaining} days left</span></span>
            )}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-ios-border/15 relative z-10">
        <div className="text-center">
          <div className="text-[10px] text-ios-text-secondary font-medium">Spent</div>
          <div className="text-xs font-bold text-ios-text tabular-nums">{formatCurrency(burn.spent)}</div>
        </div>
        <div className="text-center">
          <div className="text-[10px] text-ios-text-secondary font-medium">Cap</div>
          <div className="text-xs font-bold text-ios-text tabular-nums">{formatCurrency(burn.cap)}</div>
        </div>
        <div className="text-center">
          <div className="text-[10px] text-ios-text-secondary font-medium">Remaining</div>
          <div className="text-xs font-bold tabular-nums" style={{ color: burn.remaining > 0 ? '#30d158' : '#ff453a' }}>
            {formatCurrency(burn.remaining)}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ─── Phase 1: CrashBanner ──────────────────────────────────── */
function CrashBanner({ burn }: { burn: BurnRate }) {
  if (burn.usedPct < 60) return null;
  let message = '';
  let icon = <AlertTriangle size={16} />;
  let bg = '';
  if (burn.usedPct >= 100) {
    message = `BUDGET BROKEN — You are ${formatCurrency(burn.spent - burn.cap)} over the 70% household cap. Stop spending.`;
    bg = 'rgba(255,55,95,0.12)';
  } else if (burn.usedPct >= 85) {
    message = `DISASTER IN MAKING — At this rate, your budget crashes in ${burn.daysUntilExhaustion} days. Slow down now.`;
    bg = 'rgba(255,55,95,0.08)';
  } else {
    message = `WATCH OUT — ${Math.round(burn.usedPct)}% of household budget used. Pace yourself.`;
    bg = 'rgba(255,159,10,0.08)';
  }
  return (
    <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }}
      className="crash-banner rounded-xl px-3 py-2.5 mx-4 mb-2" style={{ background: bg }}>
      <div className="flex items-center gap-2">
        <div className="crash-icon-wrap" style={{ color: burn.usedPct >= 85 ? '#ff375f' : '#ff9f0a' }}>{icon}</div>
        <span className="text-[11px] font-semibold leading-tight" style={{ color: burn.usedPct >= 85 ? '#ff375f' : '#ff9f0a' }}>
          {message}
        </span>
      </div>
    </motion.div>
  );
}

/* ─── Phase 1: PasscodeModal ──────────────────────────────── */
function PasscodeModal({ mode, onVerify, onSet, onClose }: {
  mode: PasscodeMode;
  onVerify: (code: string) => boolean;
  onSet: (code: string) => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);
  const handleKey = (key: string) => {
    if (input.length < 4) {
      const next = input + key;
      setInput(next);
      if (next.length === 4) {
        setTimeout(() => {
          if (mode === 'set') { onSet(next); setInput(''); onClose(); }
          else {
            if (onVerify(next)) { setInput(''); onClose(); }
            else { setError(true); setTimeout(() => { setError(false); setInput(''); }, 400); }
          }
        }, 150);
      }
    }
  };
  const handleBackspace = () => setInput(prev => prev.slice(0, -1));
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="passcode-overlay">
      <div className="absolute top-6 right-6">
        <button onClick={onClose} className="w-10 h-10 rounded-full bg-ios-surface-2 flex items-center justify-center text-ios-text-secondary">
          <X size={18} />
        </button>
      </div>
      <div className="text-center mb-8">
        <div className="w-14 h-14 rounded-2xl bg-ios-blue/20 flex items-center justify-center mx-auto mb-4">
          <Lock size={24} className="text-ios-blue" />
        </div>
        <h3 className="text-lg font-semibold text-ios-text mb-1">{mode === 'set' ? 'Set Passcode' : 'Enter Passcode'}</h3>
        <p className="text-xs text-ios-text-secondary">{mode === 'set' ? 'Create a 4-digit override code' : 'Unlock to add expenses'}</p>
      </div>
      <div className="passcode-dots">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`passcode-dot ${i < input.length ? 'filled' : ''} ${error ? 'animate-pulse' : ''}`}
            style={error ? { borderColor: '#ff375f', background: '#ff375f' } : {}} />
        ))}
      </div>
      <div className="passcode-pad">
        {keys.map((k, i) => (
          k === '' ? <div key={i} /> : (
            <button key={i} onClick={() => k === '⌫' ? handleBackspace() : handleKey(k)}
              className="passcode-key" style={k === '⌫' ? { fontSize: 18 } : {}}>{k}</button>
          )
        ))}
      </div>
    </motion.div>
  );
}

/* ─── Phase 2: DebtSimulatorCard ──────────────────────────── */
function DebtSimulatorCard({ store }: { store: ReturnType<typeof useBudgetStore> }) {
  const [strategy, setStrategy] = useState<'snowball' | 'avalanche'>('avalanche');
  const [extraMonthly, setExtraMonthly] = useState(5000);
  const [selectedDebtExtra, setSelectedDebtExtra] = useState<string>('vehicle');
  const { currentYear, getCurrentDebtBalance, getDebtMonthsRemaining, calculateDebtPayoff, calculateExtraPaymentImpact, updateDebtMeta, syncDebtEmiToOutflows } = store;
  const payoff = useMemo(() => calculateDebtPayoff(strategy, extraMonthly), [calculateDebtPayoff, strategy, extraMonthly]);
  const extraImpact = useMemo(() => calculateExtraPaymentImpact(selectedDebtExtra, extraMonthly), [calculateExtraPaymentImpact, selectedDebtExtra, extraMonthly]);
  if (!currentYear) return null;
  return (
    <div className="space-y-3">
      {currentYear.debtMeta.map(meta => {
        const balance = getCurrentDebtBalance(meta.debtId);
        const monthsLeft = getDebtMonthsRemaining(meta.debtId);
        const progress = meta.originalPrincipal > 0 ? ((meta.originalPrincipal - balance) / meta.originalPrincipal) * 100 : 0;
        return (
          <motion.div key={meta.debtId} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-2xl p-4 ios-shadow card-hover">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-ios-blue/20 text-ios-blue"><CreditCard size={14} /></div>
                <span className="text-xs font-bold text-ios-text tracking-wide">{meta.name}</span>
              </div>
              <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-ios-surface-2 text-ios-text-secondary">{Number.isFinite(monthsLeft) ? (meta.emiAmount > 0 ? `${monthsLeft} payments left` : 'Set up this loan') : 'EMI below interest'}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <div className="text-[10px] text-ios-text-secondary font-medium">Balance</div>
                <div className="text-xs font-bold text-ios-text tabular-nums">{formatCurrency(Math.round(balance))}</div>
              </div>
              <div>
                <div className="text-[10px] text-ios-text-secondary font-medium">EMI</div>
                <input type="number" value={meta.emiAmount} onChange={e => updateDebtMeta(meta.debtId, { emiAmount: Number(e.target.value) || 0 })}
                  className="w-20 bg-ios-surface-2 rounded-lg px-2 py-0.5 text-xs font-bold text-ios-text text-right border border-ios-border/30 focus:border-ios-blue outline-none tabular-nums" />
              </div>
            </div>
            <div className="mb-2">
              <div className="flex justify-between text-[10px] mb-1">
                <span className="text-ios-text-secondary font-medium">Paid off</span>
                <span className="text-ios-green font-bold">{Math.round(progress)}%</span>
              </div>
              <div className="w-full h-1.5 bg-ios-surface-2 rounded-full overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ duration: 0.8 }} className="h-full rounded-full bg-ios-blue" />
              </div>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] text-ios-text-secondary font-medium">Rate</span>
              <input type="number" value={meta.interestRate}
                onChange={e => updateDebtMeta(meta.debtId, { interestRate: Number(e.target.value) || 0 })}
                className="w-16 bg-ios-surface-2 rounded-lg px-2 py-1 text-[10px] text-ios-text text-right border border-ios-border/30 focus:border-ios-blue outline-none tabular-nums" />
              <span className="text-[10px] text-ios-text-secondary font-medium">%</span>
              <span className="text-[10px] text-ios-text-secondary font-medium ml-1">Principal</span>
              <input type="number" value={meta.originalPrincipal}
                onChange={e => updateDebtMeta(meta.debtId, { originalPrincipal: Number(e.target.value) || 0 })}
                className="w-24 bg-ios-surface-2 rounded-lg px-2 py-1 text-[10px] text-ios-text text-right border border-ios-border/30 focus:border-ios-blue outline-none tabular-nums" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-ios-text-secondary">Since {currentYear.months[meta.startMonthIndex] || '—'} {currentYear.year}</span>
              <button onClick={() => syncDebtEmiToOutflows(meta.debtId)} className="text-[9px] font-bold px-2 py-1 rounded-lg bg-ios-purple/15 text-ios-purple">Sync EMI to outflows</button>
            </div>
          </motion.div>
        );
      })}
      {currentYear.debtMeta.length === 0 && (
        <div className="py-4 text-center text-[11px] text-ios-text-secondary">No debts yet — add one under Debt Progression, then set its EMI, rate & principal here</div>
      )}
      <div className="glass-card rounded-2xl p-4 ios-shadow">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-bold text-ios-text">Payoff Strategy</span>
          <div className="flex bg-ios-surface-2 rounded-xl p-0.5">
            <button onClick={() => setStrategy('snowball')} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${strategy === 'snowball' ? 'bg-ios-surface text-ios-text shadow-sm' : 'text-ios-text-secondary'}`}>Snowball</button>
            <button onClick={() => setStrategy('avalanche')} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${strategy === 'avalanche' ? 'bg-ios-surface text-ios-text shadow-sm' : 'text-ios-text-secondary'}`}>Avalanche</button>
          </div>
        </div>
        {payoff && (
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="text-center p-2.5 rounded-xl bg-ios-surface-2">
              <div className="text-[10px] text-ios-text-secondary font-medium">Total Months</div>
              <div className="text-sm font-bold text-ios-text">{payoff.totalMonths}</div>
            </div>
            <div className="text-center p-2.5 rounded-xl bg-ios-surface-2">
              <div className="text-[10px] text-ios-text-secondary font-medium">Interest</div>
              <div className="text-sm font-bold text-ios-orange">{formatCurrency(payoff.totalInterest)}</div>
            </div>
            <div className="text-center p-2.5 rounded-xl bg-ios-surface-2">
              <div className="text-[10px] text-ios-text-secondary font-medium">Principal</div>
              <div className="text-sm font-bold text-ios-green">{formatCurrency(payoff.totalPrincipal)}</div>
            </div>
          </div>
        )}
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-ios-text-secondary font-medium whitespace-nowrap">Extra/month</span>
          <input type="range" min="0" max="50000" step="1000" value={extraMonthly}
            onChange={e => setExtraMonthly(Number(e.target.value))} className="flex-1 accent-ios-blue" />
          <span className="text-xs font-bold text-ios-text w-16 text-right tabular-nums">{formatCurrency(extraMonthly)}</span>
        </div>
      </div>
      <div className="glass-card rounded-2xl p-4 ios-shadow">
        <div className="flex items-center gap-2 mb-3">
          <Target size={14} className="text-ios-purple" />
          <span className="text-sm font-bold text-ios-text">Extra Payment Impact</span>
        </div>
        <div className="flex items-center gap-2 mb-3">
          <select value={selectedDebtExtra} onChange={e => setSelectedDebtExtra(e.target.value)}
            className="flex-1 bg-ios-surface-2 rounded-xl px-3 py-2 text-xs text-ios-text border border-ios-border/30 focus:border-ios-blue outline-none">
            {currentYear.debtMeta.filter(m => getCurrentDebtBalance(m.debtId) > 0).map(m => (
              <option key={m.debtId} value={m.debtId}>{m.name}</option>
            ))}
          </select>
        </div>
        {extraImpact && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
            <div className="p-3 rounded-xl bg-ios-green/10 border border-ios-green/20">
              <div className="text-[10px] text-ios-green font-bold mb-1 uppercase tracking-wide">Impact</div>
              <div className="text-xs text-ios-text leading-relaxed">
                Pay <span className="font-bold text-ios-text">{formatCurrency(extraMonthly)}</span> extra on {extraImpact.debtName} EMI → save <span className="font-bold text-ios-green">{formatCurrency(extraImpact.interestSaved)}</span> interest → debt-free <span className="font-bold text-ios-green">{extraImpact.monthsSaved}</span> months earlier
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="text-center p-2.5 rounded-xl bg-ios-surface-2">
                <div className="text-[10px] text-ios-text-secondary font-medium">Current</div>
                <div className="text-xs font-bold text-ios-text">{extraImpact.baselineMonths} mo</div>
              </div>
              <div className="text-center p-2.5 rounded-xl bg-ios-surface-2">
                <div className="text-[10px] text-ios-text-secondary font-medium">With Extra</div>
                <div className="text-xs font-bold text-ios-green">{extraImpact.newPayoffMonths} mo</div>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

/* ─── Phase 3: Windfall Modal ─────────────────────────────── */
function WindfallModal({ data, activeYear, onApply, onClose }: { data: WindfallResult; activeYear: string; onApply: () => void; onClose: () => void; }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-5">
      <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
        className="glass-card rounded-2xl p-5 w-full max-w-xs ios-shadow border border-ios-yellow/20">
        <div className="w-12 h-12 rounded-2xl bg-ios-yellow/20 flex items-center justify-center mx-auto mb-3">
          <Sparkles size={24} className="text-ios-yellow" />
        </div>
        <h3 className="text-base font-bold text-ios-text text-center mb-1">Windfall Detected!</h3>
        <p className="text-[11px] text-ios-text-secondary text-center mb-4">
          Extra income of {formatCurrency(data.extraIncome)} detected. Heron suggests:
        </p>
        <div className="space-y-2 mb-4">
          <div className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-ios-green/10 border border-ios-green/20">
            <span className="text-xs text-ios-green font-bold">10% Savings</span>
            <span className="text-sm font-bold text-ios-green tabular-nums">{formatCurrency(data.toSavings)}</span>
          </div>
          <div className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-ios-blue/10 border border-ios-blue/20">
            <span className="text-xs text-ios-blue font-bold">70% Household Buffer</span>
            <span className="text-sm font-bold text-ios-blue tabular-nums">{formatCurrency(data.toHousehold)}</span>
          </div>
          <div className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-ios-purple/10 border border-ios-purple/20">
            <span className="text-xs text-ios-purple font-bold">20% Debt Knockout</span>
            <span className="text-sm font-bold text-ios-purple tabular-nums">{formatCurrency(data.toDebt)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { sessionStorage.setItem(`windfall-${activeYear}-${data.monthIndex}`, '1'); onClose(); }}
            className="flex-1 py-2.5 rounded-xl bg-ios-surface-2 text-xs font-medium text-ios-text-secondary">Dismiss</button>
          <button onClick={() => { onApply(); onClose(); }}
            className="flex-1 py-2.5 rounded-xl bg-ios-yellow/20 text-xs font-bold text-ios-yellow">Apply</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ─── Phase 4: Interceptor Modal ─────────────────────────────── */
function InterceptorModal({ status, onReview, onOverride, onClose }: {
  status: InterceptorStatus;
  onReview: () => void;
  onOverride: () => void;
  onClose: () => void;
}) {
  const totalCut = status.suggestions.reduce((s, g) => s + g.monthlyAvg, 0);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-5">
      <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
        className="glass-card rounded-2xl p-5 w-full max-w-xs ios-shadow border border-ios-red/20">
        <div className="w-12 h-12 rounded-2xl bg-ios-red/20 flex items-center justify-center mx-auto mb-3">
          <AlertOctagon size={24} className="text-ios-red" />
        </div>
        <h3 className="text-base font-bold text-ios-text text-center mb-1">DISASTER STREAK: {status.streak} MONTHS</h3>
        <p className="text-[11px] text-ios-text-secondary text-center mb-4">
          Your household budget has been in disaster mode for {status.streak} consecutive months. Action required before adding new expenses.
        </p>
        {status.suggestions.length > 0 && (
          <div className="space-y-2 mb-4">
            <div className="text-[10px] text-ios-text-secondary font-bold uppercase tracking-wider">Suggested Cuts</div>
            {status.suggestions.map(s => (
              <div key={s.name} className="flex justify-between py-2 px-3 rounded-xl bg-ios-surface-2">
                <span className="text-xs text-ios-text-secondary">{s.name}</span>
                <span className="text-xs font-bold text-ios-red">-{formatCurrency(s.monthlyAvg)}/mo</span>
              </div>
            ))}
            <div className="flex justify-between py-2 px-3 rounded-xl bg-ios-red/10 border border-ios-red/20">
              <span className="text-xs text-ios-red font-bold">Total Monthly Cut</span>
              <span className="text-xs font-bold text-ios-red">{formatCurrency(totalCut)}/mo</span>
            </div>
          </div>
        )}
        <div className="space-y-2">
          <button onClick={() => { onReview(); onClose(); }}
            className="w-full py-2.5 rounded-xl bg-ios-blue/20 text-xs font-medium text-ios-blue">Review Budget</button>
          <button onClick={() => { onOverride(); onClose(); }}
            className="w-full py-2.5 rounded-xl bg-ios-surface-2 text-xs font-medium text-ios-text-secondary">Override & Add Anyway</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ─── Phase 5: Sync QR Code ────────────────────────────────── */
function SyncQRCode({ payload }: { payload: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvasRef.current || !payload) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const size = 200;
    const cells = 25;
    const cellSize = size / cells;
    canvas.width = size;
    canvas.height = size;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    let hash = 0;
    for (let i = 0; i < payload.length; i++) hash = ((hash << 5) - hash) + payload.charCodeAt(i);
    const absHash = Math.abs(hash);
    for (let r = 0; r < cells; r++) {
      for (let c = 0; c < cells; c++) {
        const idx = (r * cells + c);
        const bit = ((absHash + idx * 31) % 100) < 45;
        if (bit || (r < 3 && c < 3) || (r < 3 && c > cells - 4) || (r > cells - 4 && c < 3)) {
          ctx.fillStyle = '#000';
          ctx.fillRect(c * cellSize + 1, r * cellSize + 1, cellSize - 2, cellSize - 2);
        }
      }
    }
    ctx.fillStyle = '#000';
    [ [0,0], [cells-4,0], [0,cells-4] ].forEach(([cx, cy]) => {
      ctx.fillRect(cx * cellSize, cy * cellSize, cellSize * 3, cellSize * 3);
      ctx.fillStyle = '#fff';
      ctx.fillRect(cx * cellSize + cellSize, cy * cellSize + cellSize, cellSize, cellSize);
      ctx.fillStyle = '#000';
      ctx.fillRect(cx * cellSize + cellSize * 1.2, cy * cellSize + cellSize * 1.2, cellSize * 0.6, cellSize * 0.6);
    });
  }, [payload]);
  return <canvas ref={canvasRef} className="w-48 h-48 rounded-xl" />;
}

/* ─── Phase 5: No-Spend Challenge ──────────────────────────── */
function NoSpendChallengeCard({ status, onCheckIn }: { status: NoSpendStatus; onCheckIn: () => void; }) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const combinedTarget = 30;
  const offset = circumference - (Math.min(status.combined, combinedTarget) / combinedTarget) * circumference;
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-2xl p-4 ios-shadow card-hover">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-ios-green/20 flex items-center justify-center text-ios-green"><Zap size={16} /></div>
          <span className="text-sm font-bold text-ios-text">No-Spend Challenge</span>
        </div>
        <span className="text-[10px] text-ios-text-secondary font-medium">{status.combined} days combined</span>
      </div>
      <div className="flex items-center gap-4">
        <div className="relative w-24 h-24 flex-shrink-0">
          <svg viewBox="0 0 88 88" className="w-24 h-24 -rotate-90">
            <circle cx="44" cy="44" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
            <circle cx="44" cy="44" r={radius} fill="none" stroke="#30d158" strokeWidth="8" strokeLinecap="round"
              strokeDasharray={circumference} strokeDashoffset={offset} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-bold text-ios-text">{status.combined}</span>
            <span className="text-[9px] text-ios-text-secondary">/ {combinedTarget}</span>
          </div>
        </div>
        <div className="flex-1 space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-ios-text-secondary font-medium">Your streak</span>
            <span className="text-ios-green font-bold">{status.streak} days</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-ios-text-secondary font-medium">Partner streak</span>
            <span className="text-ios-blue font-bold">{status.partnerStreak} days</span>
          </div>
          <motion.button whileTap={{ scale: 0.95 }} onClick={onCheckIn}
            className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all ${status.todaySpent ? 'bg-ios-red/15 text-ios-red' : 'bg-ios-green/15 text-ios-green'}`}>
            {status.todaySpent ? 'Spent today — reset tomorrow' : 'Check In: No Spend Today'}
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}

/* ─── Phase 5: Shared Dashboard ──────────────────────────── */
function SharedDashboard({ expenses }: { expenses: SharedExpense[] }) {
  if (expenses.length === 0) return null;
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-2xl p-4 ios-shadow card-hover">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-xl bg-ios-blue/20 flex items-center justify-center text-ios-blue"><Users size={16} /></div>
        <span className="text-sm font-bold text-ios-text">Shared Dashboard</span>
      </div>
      <div className="space-y-2">
        {expenses.slice(0, 5).map(se => (
          <div key={se.id} className="flex items-center justify-between py-2 border-b border-ios-border/15 last:border-0">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-ios-surface-2 flex items-center justify-center text-[10px] text-ios-text-secondary font-bold">{se.partner[0]}</div>
              <div>
                <div className="text-xs text-ios-text font-medium">{se.name}</div>
                <div className="text-[10px] text-ios-text-secondary">{MONTHS_12[se.monthIndex]} • {se.partner}</div>
              </div>
            </div>
            <span className="text-xs font-bold text-ios-text tabular-nums">₹{se.amount.toLocaleString('en-IN')}</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

/* ── Statement Import ──────────────────────────── */
type ImportRow = {
  txn: ParsedTxn;
  uid: string; // stable per-row identity for checkbox toggles (avoids parser id ambiguity)
  selected: boolean;
  dupe: boolean;
  yearMismatch: boolean;
  section: 'incomeEntries' | 'householdExpenses' | 'savingsData' | 'debtRepayment';
  entryId: string;
  newName: string;
};

function suggestedRowName(desc: string): string {
  const m = desc.match(/[A-Za-z]{3,}/);
  return m ? m[0].toUpperCase() : 'IMPORTED';
}

function StatementImportSection({ store, selectedMonth }: { 
  store: ReturnType<typeof useBudgetStore>; 
  selectedMonth: number 
}) {
  const { state, currentYear, queueTransactions, confirmImportedTxn, autoAllocate, generateCoachInsights } = store;
  
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [password, setPassword] = useState('');
  const [dateOrder, setDateOrder] = useState<DateOrder>('dmy');
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [parseResultState, setParseResultState] = useState<ParseResult | null>(null);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<'all' | 'credit' | 'debit'>('all');
  const [showPassword, setShowPassword] = useState(false);
  const [monthBlocked, setMonthBlocked] = useState(false);
  const [importAnyway, setImportAnyway] = useState(false);
  const [completion, setCompletion] = useState<null | { imported: number; dupes: number; deferred: number; skipped: number }>(null);
  const PAGE_SIZE = 50;
  const pending = currentYear?.pendingTxns || [];
  const rules = currentYear?.importRules || [];

  const buildRows = (txns: ParsedTxn[]): ImportRow[] => {
    const processedH = new Set(currentYear?.processedTxnHashes || []);
    const processedI = new Set(currentYear?.processedTxnIds || []);
    const importedMonths = new Set(currentYear?.importedStatementMonths || []);
    const activeYearNum = parseInt(state.activeYear, 10);
    const seenKeys = new Set<string>();
    return txns.map((t, i) => {
      const rule = rules.find(r => t.description.toLowerCase().includes(r.match.toLowerCase()));
      const section = rule ? rule.section : t.direction === 'credit' ? 'incomeEntries' : 'householdExpenses';
      let entryId = rule ? rule.entryId : '';
      const list = section === 'incomeEntries' ? (currentYear?.incomeEntries || []) : (currentYear?.householdExpenses || []);
      if (entryId && !list.some(e => e.id === entryId)) entryId = '';
      const key = (t.refId ? `id:${t.refId}` : `h:${t.hash}`);
      const inBatch = seenKeys.has(key);
      seenKeys.add(key);
      const monthKey = t.dateISO.slice(0, 7);
      const monthImported = importedMonths.has(monthKey);
      const isDupe = t.refId ? processedI.has(t.refId) : processedH.has(t.hash);
      // Assign unique id for UI row operations (checkbox, dropdowns, name edits).
      // Prefer existing non-empty id; otherwise use hash-based index.
      const txn = { ...t, id: t.id || `${t.hash}-${i}` };
      return { 
        uid: `row-${i}`, 
        selected: true, 
        dupe: isDupe || inBatch, 
        yearMismatch: t.yearHint !== activeYearNum, 
        monthImported, 
        section, 
        entryId, 
        newName: entryId ? '' : suggestedRowName(t.description),
        txn 
      };
    });
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) e.target.value = '';
    if (!file || !currentYear) return;
    setBusy(true); setError(''); setNotice(''); setCompletion(null); setImportAnyway(false); setMonthBlocked(false); setPage(0);
    try {
      const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
      let txns: ParsedTxn[] = [];
      let parseRes: ParseResult | null = null;
      if (isPdf) {
        const buf = await file.arrayBuffer();
        const result = await parsePdfStatementAccurate(buf, password || undefined, dateOrder);
        txns = result.txns;
        parseRes = result;
        setParseResultState(result);
      } else {
        const text = await file.text();
        const result = parseCsvStatement(text, dateOrder);
        txns = result.txns;
        parseRes = result;
        setParseResultState(result);
      }
      
      // Phase 4: Log ParseResult diagnostics before user confirmation
      if (parseRes?.detection?.diagnostics) {
        const diag = parseRes.detection.diagnostics;
        console.warn(`[App] Parsing used ${diag.fallbackUsed || 'heuristic'} fallback, score: ${diag.score ?? '?'}`);
      }
      
      if (txns.length === 0) {
        setError('No transactions detected in this file. For password-protected PDFs enter the password above; you can also try switching the date order.');
        setBusy(false);
        return;
      }
      const built = buildRows(txns);
      const monthSet = new Set(built.map(r => r.txn.dateISO.slice(0, 7)));
      const locked = new Set(currentYear?.importedStatementMonths || []);
      const allLocked = built.length > 0 && [...monthSet].every(m => locked.has(m));
      if (built.every(r => r.dupe)) {
        setNotice(`All ${built.length} transactions were already imported earlier — nothing new.`);
        setBusy(false);
        return;
      }
      if (allLocked && !importAnyway) {
        setMonthBlocked(true);
        setRows(built);
        setBusy(false);
        return;
      }
      setRows(built);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Import failed';
      if (msg === 'WRONG_PASSWORD') setError('Incorrect statement password — please check and try again.');
      else if (msg === 'NEED_PASSWORD') setError('This PDF is password-protected — enter the statement password above and try again.');
      else setError('Import failed: ' + msg);
    }
    setBusy(false);
  };

  const handleConfirm = () => {
    if (!rows || !currentYear) return;
    const chosen = rows.filter(r => r.selected && !r.dupe && !r.yearMismatch && (r.entryId || r.newName.trim()));
    for (const r of chosen) {
      confirmImportedTxn(r.txn, r.section, r.entryId || null, r.entryId ? null : r.newName.trim());
      if (r.txn.direction === 'credit') autoAllocate(r.txn.monthIndex);
    }
    const deferred = rows.filter(r => !r.selected && !r.dupe && !r.yearMismatch).map(r => r.txn);
    if (deferred.length) queueTransactions(deferred);
    generateCoachInsights(selectedMonth);
    const skipped = rows.filter(r => r.selected && !r.dupe && !r.yearMismatch && !r.entryId && !r.newName.trim()).length;
    setNotice(`${chosen.length} imported • ${rows.filter(r => r.dupe).length} duplicates skipped • ${deferred.length} kept for later${skipped ? ` • ${skipped} skipped (no category chosen)` : ''}`);
    setRows(null);
  };

  const reviewPending = () => {
    if (!currentYear) return;
    setRows(buildRows(currentYear.pendingTxns));
    setNotice(''); setError('');
  };

  return (
    <div className="glass-card rounded-2xl p-4 ios-shadow card-hover">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-bold text-ios-text tracking-tight">Import Statement</span>
        {pending.length > 0 && (
          <button onClick={reviewPending} className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-ios-orange/15 text-ios-orange">
            {pending.length} pending — review
          </button>
        )}
      </div>
      <p className="text-[10px] text-ios-text-secondary mb-3 leading-relaxed">
        Import a bank statement (PDF or CSV) from any bank or country. Transactions are parsed on-device, shown for your review, and only recorded after you confirm.
      </p>
      <input ref={fileRef} type="file" accept=".pdf,.csv,.txt,text/csv,application/pdf" className="hidden" onChange={handleFile} />
      <div className="flex items-center gap-2">
        <motion.button whileTap={{ scale: 0.95 }} disabled={busy} onClick={() => fileRef.current?.click()}
          className="flex-1 py-2.5 rounded-xl bg-ios-blue/15 text-xs font-bold text-ios-blue flex items-center justify-center gap-1.5 disabled:opacity-50">
          <Plus size={13} /> {busy ? 'Parsing…' : 'Choose statement file'}
        </motion.button>
        <button onClick={() => setDateOrder(dateOrder === 'dmy' ? 'mdy' : 'dmy')}
          className="px-3 py-2.5 rounded-xl bg-ios-surface-2 text-[10px] font-bold text-ios-text-secondary uppercase">
          {dateOrder}
        </button>
      </div>
      <div className="relative mt-2">
        <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Statement password (only for protected PDFs)" autoComplete="off" autoCapitalize="none" autoCorrect="off"
          className="w-full bg-ios-surface-2 rounded-xl px-3 py-2 pr-10 text-[11px] text-ios-text border border-ios-border/30 outline-none" />
        {password && (
          <button type="button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-ios-text-secondary">
            {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
      </div>
      {error && <div className="mt-2 text-[10px] text-ios-red font-medium">{error}</div>}
      {notice && <div className="mt-2 text-[10px] text-ios-green font-medium">{notice}</div>}
      
      {/* Phase 4: ParseResult diagnostics */}
      {parseResultState?.detection?.diagnostics && (
        <div className="mt-2 p-2 rounded-xl bg-ios-surface-2 border border-ios-border/30">
          {(() => {
            const diag = parseResultState.detection.diagnostics;
            const score = diag.score ?? 0;
            
            // Render status indicator based on detection quality
            if (score > 0.7) {
              return (
                <div className="flex items-center gap-1.5 mb-1 text-ios-green">
                  <CheckCircle2 size={14} />
                  <span>Detection confidence: {Math.round(score * 100)}%</span>
                </div>
              );
            } else if (diag.fallbackUsed === 'balanceDelta') {
              return (
                <div className="flex items-center gap-1.5 mb-1 text-ios-orange">
                  <AlertTriangle size={14} />
                  <span>Used balance-delta fallback ({diag.reasons?.join(', ') || 'no columns found'})</span>
                </div>
              );
            } else {
              return (
                <div className="flex items-center gap-1.5 mb-1 text-ios-orange">
                  <AlertTriangle size={14} />
                  <span>Heuristic fallback used ({diag.reasons?.join(', ') || 'no clear match'})</span>
                </div>
              );
            }
          })()}
        </div>
      )}

      <BottomSheet isOpen={!!rows} onClose={() => setRows(null)} title="Review imported transactions">
        {rows && (
          <>
            {monthBlocked && (
              <div className="mb-2 p-2.5 rounded-xl bg-ios-orange/15 text-[11px] text-ios-orange">
                This month was already imported. Import again? (per-transaction dedupe keeps it safe)
                <button onClick={() => { setImportAnyway(true); setMonthBlocked(false); }} className="ml-2 font-bold underline">Import anyway</button>
              </div>
            )}
            {!monthBlocked && completion && (
              <div className="mb-2 p-2.5 rounded-xl bg-ios-green/15 text-[11px] text-ios-green">
                {completion.imported} imported • {completion.dupes} duplicates skipped • {completion.deferred} kept later
                {completion.skipped > 0 ? ` • ${completion.skipped} skipped (no category)` : ''}
              </div>
            )}
            <div className="flex items-center justify-between mb-2">
              <div className="flex gap-1.5">
                {(['all', 'credit', 'debit'] as const).map(f => (
                  <button key={f} onClick={() => { setFilter(f); setPage(0); }} className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${filter === f ? 'bg-ios-blue text-white' : 'bg-ios-surface-2 text-ios-text-secondary'}`}>{f}</button>
                ))}
              </div>
              <span className="text-[10px] text-ios-text-secondary">{rows.length} total</span>
            </div>
            <div className="space-y-2 flex-1 min-h-0 overflow-y-auto overscroll-contain scroll-touch">
              {rows.filter(r => filter === 'all' || (filter === 'credit' ? r.txn.direction === 'credit' : r.txn.direction === 'debit')).length > 0 ? (
                rows.filter(r => filter === 'all' || (filter === 'credit' ? r.txn.direction === 'credit' : r.txn.direction === 'debit')).slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(r => (
                <div key={r.uid} className={`p-2.5 rounded-xl border ${r.dupe || r.yearMismatch ? 'opacity-50 border-ios-border/10' : 'border-ios-border/20'} bg-ios-surface-2`}>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setRows(rows.map(x => (x.uid === r.uid ? { ...x, selected: !x.selected } : x)))}
                      className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold ${r.selected ? 'bg-ios-blue text-white' : 'bg-ios-surface text-ios-text-secondary border border-ios-border/30'}`}>
                      {r.selected ? '✓' : ''}
                    </button>
                    <button onClick={() => setRows(rows.map(x => (x.uid === r.uid ? { ...x, txn: { ...x.txn, direction: x.txn.direction === 'credit' ? 'debit' : 'credit' } } : x)))}
                      className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold ${r.txn.direction === 'credit' ? 'bg-ios-green/15 text-ios-green' : 'bg-ios-red/15 text-ios-red'}`}>
                      {r.txn.direction === 'credit' ? 'CR' : 'DR'}
                    </button>
                    <span className="text-[11px] font-bold text-ios-text tabular-nums">{formatCurrency(r.txn.amount)}</span>
                    <span className="text-[9px] text-ios-text-secondary ml-auto">{r.txn.dateISO}</span>
                  </div>
                  <div className="text-[10px] text-ios-text-secondary truncate mt-1">{r.txn.description}</div>
                  {!r.dupe && !r.yearMismatch && (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <select value={r.section} onChange={e => setRows(rows.map(x => (x.uid === r.uid ? { ...x, section: e.target.value as ImportRow['section'], entryId: '', newName: suggestedRowName(x.txn.description) } : x)))}
                        className='w-full bg-ios-surface rounded-xl px-2 py-1.5 text-[10px] text-ios-text border border-ios-border/30 outline-none mb-1'>
                        <option value="incomeEntries">→ Incoming (income)</option>
                        <option value="householdExpenses">→ Expense (household)</option>
                        <option value="savingsData">→ Savings</option>
                        <option value="debtRepayment">→ Debt Repayment (EMI)</option>
                      </select>
                      <select value={r.entryId} onChange={e => setRows(rows.map(x => (x.uid === r.uid ? { ...x, entryId: e.target.value, newName: e.target.value ? '' : x.newName } : x)))}
                        className='flex-1 bg-ios-surface rounded-xl px-2 py-1.5 text-[10px] text-ios-text border border-ios-border/30 outline-none'>
                        <option value="">＋ New row…</option>
                        {(r.section === 'incomeEntries' ? currentYear.incomeEntries : r.section === 'savingsData' ? currentYear.savingsData : r.section === 'debtRepayment' ? currentYear.debtRepayment : currentYear.householdExpenses).map(en => (
                          <option key={en.id} value={en.id}>{en.name}</option>
                        ))}
                      </select>
                      {!r.entryId && (
                        <input value={r.newName} onChange={e => setRows(rows.map(x => (x.uid === r.uid ? { ...x, newName: e.target.value } : x)))}
                          placeholder="New row name" className="flex-1 bg-ios-surface rounded-xl px-2 py-1.5 text-[10px] text-ios-text border border-ios-border/30 outline-none" />
                      )}
                    </div>
                  )}
                  {r.dupe && <div className="text-[9px] text-ios-text-secondary mt-1">Already imported earlier</div>}
                  {r.yearMismatch && <div className="text-[9px] text-ios-orange mt-1">Dated {r.txn.yearHint} — switch to that year to import</div>}
                </div>
              ))
            ) : (
                <div className="py-6 text-center text-[11px] text-ios-text-secondary">No {filter === 'all' ? '' : filter + ' '}transactions in this view.</div>
              )}
            </div>

            {Math.ceil(rows.filter(r => filter === 'all' || (filter === 'credit' ? r.txn.direction === 'credit' : r.txn.direction === 'debit')).length / PAGE_SIZE) > 1 && (
              <div className="flex items-center justify-between mt-3">
                <button disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))} className="px-3 py-1.5 rounded-xl bg-ios-surface-2 text-[11px] font-bold text-ios-text-secondary disabled:opacity-40">← Prev</button>
                <span className="text-[10px] text-ios-text-secondary">Page {page + 1} / {Math.ceil(rows.filter(r => filter === 'all' || (filter === 'credit' ? r.txn.direction === 'credit' : r.txn.direction === 'debit')).length / PAGE_SIZE)}</span>
                <button disabled={(page + 1) * PAGE_SIZE >= rows.filter(r => filter === 'all' || (filter === 'credit' ? r.txn.direction === 'credit' : r.txn.direction === 'debit')).length} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 rounded-xl bg-ios-surface-2 text-[11px] font-bold text-ios-text-secondary disabled:opacity-40">Next →</button>
              </div>
            )}
            {parseResultState && (
              <div className="flex items-center gap-2 mt-3 border-t border-ios-border/30 pt-3">
                <motion.button whileTap={{ scale: 0.95 }} onClick={async () => {
                  const csvGrid = gridToCsv(parseResultState.rawTable || []);
                  const csvDiag = diagnosticsToCsv(parseResultState);
                  
                  // Create two file objects with UTF-8 BOM for Excel compatibility
                  const blobGrid = new Blob([csvGrid], { type: 'text/csv;charset=utf-8;' });
                  const blobDiag = new Blob([csvDiag], { type: 'text/csv;charset=utf-8;' });
                  
                  // Prefer Web Share API (mobile), fall back to Blob download pattern
                  if ('share' in navigator && parseResultState.txns.length > 0) {
                    try {
                      const shareData = [new File([blobGrid], 'heron-grid.csv', { type: 'text/csv' }),
                                         new File([blobDiag], 'heron-diagnostic.csv', { type: 'text/csv' })];
                      await navigator.share({ files: shareData });
                    } catch (e) {
                      // Share cancelled or failed - fall through to download fallback
                    }
                  }
                  
                  // Fallback: auto-download both files (works in dev/standalone browsers)
                  const urls = [URL.createObjectURL(blobGrid), URL.createObjectURL(blobDiag)];
                  const names = ['heron-grid.csv', 'heron-diagnostic.csv'];
                  for (let i = 0; i < names.length; i++) {
                    const a = document.createElement('a');
                    a.href = urls[i];
                    a.download = names[i];
                    a.style.display = 'none';
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(() => { document.body.removeChild(a); }, 100);
                  }
                  
                  // Clean up URLs after download completes
                  if (urls[0]) URL.revokeObjectURL(urls[0]);
                  if (urls[1]) URL.revokeObjectURL(urls[1]);
                }}
                  disabled={!parseResultState.rawTable}
                  className="px-3 py-1.5 rounded-xl bg-ios-blue/15 text-[11px] font-bold text-ios-blue disabled:bg-gray-200 disabled:text-gray-400">
                  📋 Export diagnostic CSV
                </motion.button>
                <span className="text-[9px] text-gray-400">Exports extracted grid + metadata</span>
              </div>
            )}
            <button onClick={handleConfirm} className="w-full mt-3 py-2.5 rounded-xl bg-ios-green/15 text-xs font-bold text-ios-green">
              Confirm selected ({rows.filter(r => r.selected && !r.dupe && !r.yearMismatch && (r.entryId || r.newName.trim())).length})
            </button>
          </>
        )}
      </BottomSheet>
    </div>
  );
}
/* ─── Main App ────────────────────────────────────────────── */
export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth()); // start at current calendar month
  const [editSection, setEditSection] = useState<EditSection>(null);
  const [newEntryName, setNewEntryName] = useState('');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showAddYear, setShowAddYear] = useState(false);
  const [newYearVal, setNewYearVal] = useState('');
  const [showYearMenu, setShowYearMenu] = useState(false);
  const [showWindfall, setShowWindfall] = useState(false);
  const [windfallData, setWindfallData] = useState<WindfallResult | null>(null);
  const [showTaxAdd, setShowTaxAdd] = useState(false);
  const [newTaxName, setNewTaxName] = useState('');
  const [newTaxCategory, setNewTaxCategory] = useState<TaxEntry['category']>('other');
  const [newTaxLimit, setNewTaxLimit] = useState('150000');
  const [passcodeMode, setPasscodeMode] = useState<PasscodeMode>(null);
  const [capOverride, setCapOverride] = useState(false);
  const [showCapToast, setShowCapToast] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showInterceptor, setShowInterceptor] = useState(false);
  const [interceptorBypass, setInterceptorBypass] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncMode, setSyncMode] = useState<'show' | 'scan'>('show');
  const [syncPayload, setSyncPayload] = useState('');
  const [scanInput, setScanInput] = useState('');

  const [copied, setCopied] = useState(false);
  const [partnerNameInput, setPartnerNameInput] = useState('');
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [addSheetSection, setAddSheetSection] = useState<keyof YearData | null>(null);
  const [showAddDebt, setShowAddDebt] = useState(false);
  const [adName, setAdName] = useState('');
  const [adBalance, setAdBalance] = useState('');
  const [adPrincipal, setAdPrincipal] = useState('');
  const [adRate, setAdRate] = useState('');
  const [adEmi, setAdEmi] = useState('');
  const [adEmiOutflows, setAdEmiOutflows] = useState(true);
  

  const store = useBudgetStore();
  const { state, currentYear, updateEntryValue, updateEntryName, addEntry, deleteEntry,
    setActiveYear, addYear, deleteYear, resetToDefaults, completeSetup,
    autoAllocate, autoAllocateAll, toggleEntryEssential, setPasscode, verifyPasscode, getBurnRate,
    getIncomeTotal, getOutgoingTotal, getAllocationTotal, getHouseholdTotal, getDebtRepaymentTotal, getSavingsTotal,
    toggleRecurring, applyRecurringAutopilot, getCommittedRecurring, getTrueDisposable,
    addTaxEntry, updateTaxEntryValue, deleteTaxEntry,
    getTaxShieldStatus, detectWindfall, applyWindfall, getDisasterStreak, getRecoveryStreak, getInterceptorStatus, getYearComparison,
    getDebtReductionVelocity, enableFamilySync, disableFamilySync, generateSyncPayload, applySyncPayload, exportToCSV, exportToJSON, importFromJSON,
    generatePDFReport, generateAnnualPDFReport, generateCoachInsights, dismissCoachInsight, updateCoachSettings, addDebt, updateNoSpendStreak, getNoSpendStatus } = store;

  const months = currentYear?.months || [];
  const currentMonth = months[selectedMonth] || '';

  // Live calendar anchor: re-checked every minute AND immediately when the
  // app returns from the background (iOS suspends timers), so the month belt
  // and the selection roll over automatically when the calendar month changes.
  const [now, setNow] = useState(() => new Date());
  const calendarMonth = now.getMonth();
  const autoMonthRef = useRef(calendarMonth); // month last set by auto-follow
  useEffect(() => {
    const check = () => {
      const d = new Date();
      setNow(prev => (prev.getMonth() !== d.getMonth() || prev.getFullYear() !== d.getFullYear() ? d : prev));
    };
    check();
    const iv = setInterval(check, 60000);
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  // On calendar month rollover: follow automatically only if the user was
  // still on the previously auto-selected month. A manual pick of another
  // month is respected (no yanking); auto-follow resumes from the new month.
  useEffect(() => {
    if (selectedMonth === autoMonthRef.current) {
      setSelectedMonth(calendarMonth);
    }
    autoMonthRef.current = calendarMonth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarMonth]);

  // Month belt: starts at the current calendar month and wraps Dec->Jan.
  // Each chip carries its TRUE calendar index (0=Jan..11=Dec) so every data
  // getter/update keeps reading the correct calendar month, and the label
  // is always the month its click actually selects.
  const monthBelt = useMemo(() => {
    const src = currentYear?.months || [];
    const start = calendarMonth;
    return src.map((_, k) => {
      const idx = (start + k) % 12;
      return { label: src[idx], idx };
    });
  }, [currentYear?.months, calendarMonth]);
  const noSpendStatus = useMemo(() => getNoSpendStatus(), [getNoSpendStatus, currentYear, selectedMonth]);
  const incomeTotal = getIncomeTotal(selectedMonth);
  const outgoingTotal = getOutgoingTotal(selectedMonth);
  const allocationTotal = getAllocationTotal(selectedMonth);
  const householdTotal = getHouseholdTotal(selectedMonth);
  const debtRepayTotal = getDebtRepaymentTotal(selectedMonth);
  const committedRecurring = useMemo(() => getCommittedRecurring(selectedMonth), [getCommittedRecurring, selectedMonth]);
  const trueDisposable = useMemo(() => getTrueDisposable(selectedMonth), [getTrueDisposable, selectedMonth]);
  const interceptorStatus = useMemo(() => getInterceptorStatus(selectedMonth), [getInterceptorStatus, selectedMonth]);
  const disasterStreak = useMemo(() => getDisasterStreak(selectedMonth), [getDisasterStreak, selectedMonth]);
  const recoveryStreak = useMemo(() => getRecoveryStreak(selectedMonth), [getRecoveryStreak, selectedMonth]);
  const yearComparison = useMemo(() => getYearComparison(), [getYearComparison]);

  const selectedMonthCap = useMemo(() => {
    if (!currentYear) return null;
    const capEntry = currentYear.allocationEntries.find(e => e.id === 'house70');
    const cap = capEntry?.values[selectedMonth] || 0;
    const spent = currentYear.householdExpenses.reduce((sum, e) => sum + (e.values[selectedMonth] || 0), 0);
    return { cap, spent, isCapReached: cap > 0 && spent >= cap };
  }, [currentYear, selectedMonth]);

  const burnRate = useMemo(() => getBurnRate(), [getBurnRate]);

  useEffect(() => {
    setCapOverride(false);
    setInterceptorBypass(false);
  }, [selectedMonth, state.activeYear]);

  useEffect(() => {
    const wf = detectWindfall(selectedMonth);
    if (wf && wf.extraIncome > 5000) {
      setWindfallData(wf);
      const dismissed = sessionStorage.getItem(`windfall-${state.activeYear}-${selectedMonth}`);
      if (!dismissed) setShowWindfall(true);
    } else {
      setWindfallData(null);
    }
  }, [selectedMonth, state.activeYear, detectWindfall]);

  const [coachFilter, setCoachFilter] = useState<'all' | 'alert' | 'warning' | 'suggestion' | 'reminder' | 'positive'>('all');
  const [coachScope, setCoachScope] = useState<'monthly' | 'annual'>('monthly');
  const annualInsights = useMemo(() => (currentYear ? generateAnnualInsights(currentYear, currentYear.coachSettings || defaultCoachSettings) : []), [currentYear]);
  useEffect(() => {
  // Regenerate insights only when the month or year changes (or on manual
  // refresh). NOTE: we deliberately do NOT depend on `currentYear?.modifiedAt`;
  // generation used to bump that timestamp, which retriggered this effect in a
  // ~500ms feedback loop — the source of the "flickering" Coach feed.
  const timer = setTimeout(() => {
    generateCoachInsights(selectedMonth);
  }, 500);
  return () => clearTimeout(timer);
}, [selectedMonth, state.activeYear, generateCoachInsights]);

  const grandIncoming = useMemo(() => months.reduce((s, _, i) => s + getIncomeTotal(i), 0), [months, getIncomeTotal]);
  const grandOutgoing = useMemo(() => months.reduce((s, _, i) => s + getOutgoingTotal(i), 0), [months, getOutgoingTotal]);
  const grandDebtPaid = useMemo(() => currentYear?.debtRepayment.reduce((s, e) => s + e.values.reduce((a, b) => a + b, 0), 0) || 0, [currentYear]);

  const chartData = useMemo(() => months.map((m, i) => ({
    month: m, incoming: getIncomeTotal(i), outgoing: getOutgoingTotal(i),
  })), [months, getIncomeTotal, getOutgoingTotal]);

  const debtChartData = useMemo(() => months.map((m, i) => ({
    month: m, vehicle: currentYear?.debtProgression[0]?.values[i] || 0, gpu: currentYear?.debtProgression[1]?.values[i] || 0,
  })), [months, currentYear]);

  const expenseChartData = useMemo(() => (currentYear?.householdExpenses || [])
    .filter(e => e.values[selectedMonth] > 0)
    .map(e => ({ name: e.name, value: e.values[selectedMonth] })), [currentYear, selectedMonth]);

  const debtPieData = useMemo(() => {
    if (!currentYear) return [];
    return currentYear.debtProgression.filter(d => d.values[selectedMonth] > 0).map((d, i) => ({
      name: d.name, value: d.values[selectedMonth], color: ['#0a84ff', '#bf5af2', '#ff9f0a'][i % 3]
    }));
  }, [currentYear, selectedMonth]);

  const handleAddEntry = (section: keyof YearData) => {
    if (!newEntryName.trim()) return;
    if (section === 'householdExpenses') {
      if (interceptorStatus.shouldBlock && !interceptorBypass) { setShowInterceptor(true); return; }
    }
    if (section === 'householdExpenses' && selectedMonthCap?.isCapReached && !capOverride) {
      setShowCapToast(true);
      setTimeout(() => setShowCapToast(false), 3000);
      setPasscodeMode('verify');
      return;
    }
    addEntry(section, newEntryName.trim().toUpperCase());
    setNewEntryName('');
    setCapOverride(false);
    setInterceptorBypass(false);
  };

  const handleAddYear = () => {
    if (!newYearVal.trim() || !/^\d{4}$/.test(newYearVal)) return;
    addYear(newYearVal.trim());
    setNewYearVal('');
    setShowAddYear(false);
  };

  const handleIncomeEdit = (entryId: string, monthIndex: number, value: number) => {
    updateEntryValue('incomeEntries', entryId, monthIndex, value);
    setTimeout(() => autoAllocate(monthIndex), 0);
  };

  const handleCopyPayload = () => {
    navigator.clipboard.writeText(syncPayload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadCSV = () => {
    const csv = exportToCSV();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `heron-${state.activeYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadJSON = () => {
    const json = exportToJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = `heron-backup-${state.activeYear}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenPDF = () => {
    const html = generatePDFReport(selectedMonth);
    const win = window.open('', '_blank');
    if (win) { win.document.write(html); win.document.close(); }
  };

  const handleOpenAnnualPDF = () => {
    const html = generateAnnualPDFReport();
    const win = window.open('', '_blank');
    if (win) { win.document.write(html); win.document.close(); }
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (text) importFromJSON(text);
    };
    reader.readAsText(file);
  };

  const openAddSheet = (section: keyof YearData) => {
    setAddSheetSection(section);
    setNewEntryName('');
    setAddSheetOpen(true);
  };

  const confirmAddFromSheet = () => {
    if (!addSheetSection) return;
    handleAddEntry(addSheetSection);
    setAddSheetOpen(false);
  };

  const handleAddDebt = () => {
    const bal = Number(adBalance) || 0;
    if (!adName.trim() || bal <= 0) return;
    addDebt(adName.trim(), { balance: bal, principal: Number(adPrincipal) || 0, rate: Number(adRate) || 0, emi: Number(adEmi) || 0, startMonthIndex: new Date().getMonth() }, adEmiOutflows);
    setShowAddDebt(false);
    setAdName(''); setAdBalance(''); setAdPrincipal(''); setAdRate(''); setAdEmi('');
  };

  const SectionHeader = ({ title, section, onAdd, locked }: { title: string; section: EditSection; onAdd?: () => void; locked?: boolean }) => (
    <div className="flex items-center justify-between mb-3">
      <span className="text-sm font-bold text-ios-text tracking-tight">{title}</span>
      <div className="flex items-center gap-2">
        {onAdd && (
          <motion.button whileTap={{ scale: 0.85 }} onClick={onAdd}
            className={`w-8 h-8 rounded-xl flex items-center justify-center ${locked ? 'bg-ios-red/15 text-ios-red' : 'bg-ios-green/15 text-ios-green'}`}>
            {locked ? <Lock size={14} /> : <Plus size={16} />}
          </motion.button>
        )}
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => setEditSection(editSection === section ? null : section)}
          className={`w-8 h-8 rounded-xl flex items-center justify-center ${editSection === section ? 'bg-ios-blue/15 text-ios-blue' : 'bg-ios-surface-2 text-ios-text-secondary'}`}>
          {editSection === section ? <Check size={16} /> : <Edit3 size={14} />}
        </motion.button>
      </div>
    </div>
  );

  if (!currentYear) return (
    <div className="h-[100dvh] w-full flex items-center justify-center text-ios-text-secondary bg-ios-bg">
      <motion.div animate={{ opacity: [0.5, 1, 0.5] }} transition={{ repeat: Infinity, duration: 1.5 }}>Loading...</motion.div>
    </div>
  );

  const tabs = [
    { id: 'overview' as Tab, icon: <BarChart3 size={20} />, label: 'Overview' },
    { id: 'details' as Tab, icon: <Activity size={20} />, label: 'Details' },
    { id: 'debt' as Tab, icon: <CreditCard size={20} />, label: 'Debt' },
    { id: 'tax' as Tab, icon: <Shield size={20} />, label: 'Tax' },
    { id: 'war' as Tab, icon: <Swords size={20} />, label: 'War Room' },
    { id: 'sync' as Tab, icon: <Users size={20} />, label: 'Sync' },
    { id: 'coach' as Tab, icon: <Lightbulb size={20} />, label: 'Coach' },
  ];

  return (
    <div className="w-full h-[100dvh] min-h-[100dvh] overflow-hidden flex flex-col bg-ios-bg gradient-mesh">
      {/* Safe Area Top Spacer (single source: --sat) */}
      <div className="shrink-0" style={{ height: 'var(--sat)' }} />

      {/* Header */}
        <motion.header initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="shrink-0 px-5 pt-1 pb-1">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight">
              <span className="bg-gradient-to-r from-white via-white to-ios-text-secondary bg-clip-text text-transparent">Babylonian Heron</span>
            </h1>
            <p className="text-[11px] text-ios-text-secondary font-medium mt-0.5">{currentMonth} {state.activeYear}</p>
          </div>
          <div className="flex items-center gap-2">
            <motion.button whileTap={{ scale: 0.88 }} onClick={() => setShowSettings(true)}
              className="w-9 h-9 rounded-full bg-ios-surface-2 flex items-center justify-center ios-shadow-sm text-ios-text-secondary card-hover">
              <Settings size={16} />
            </motion.button>
            <motion.button whileTap={{ scale: 0.88 }} onClick={() => setShowResetConfirm(true)}
              className="w-9 h-9 rounded-full bg-ios-surface-2 flex items-center justify-center ios-shadow-sm text-ios-text-secondary card-hover">
              <RotateCcw size={16} />
            </motion.button>
            <motion.div whileHover={{ rotate: 15 }} className="w-10 h-10 rounded-full bg-ios-surface-2 flex items-center justify-center ios-shadow-sm card-hover">
              <Activity size={18} className="text-ios-blue" />
            </motion.div>
          </div>
        </div>
      </motion.header>

      {/* Year Switcher */}
      <div className="shrink-0 px-4 mb-1">
        <div className="flex items-center gap-2">
          <div className="flex-1 flex gap-1.5 overflow-x-auto scroll-x pb-1">
            {state.availableYears.map(year => (
              <motion.button key={year} whileTap={{ scale: 0.92 }} onClick={() => { setActiveYear(year); setSelectedMonth(0); }}
                className={`px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                  state.activeYear === year ? 'bg-ios-purple text-white ios-shadow-sm' : 'bg-ios-surface-2 text-ios-text-secondary'
                }`}>
                {year}
              </motion.button>
            ))}
            <motion.button whileTap={{ scale: 0.92 }} onClick={() => setShowAddYear(true)}
              className="w-8 h-8 rounded-full bg-ios-surface-2 flex items-center justify-center text-ios-text-secondary">
              <Plus size={14} />
            </motion.button>
          </div>
          {state.availableYears.length > 1 && (
            <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowYearMenu(!showYearMenu)}
              className="w-8 h-8 rounded-full bg-ios-surface-2 flex items-center justify-center text-ios-text-secondary">
              <Trash2 size={13} />
            </motion.button>
          )}
        </div>
        {showYearMenu && (
          <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }}
            className="mt-2 glass-card rounded-xl p-2 ios-shadow">
            <div className="text-[10px] text-ios-text-secondary font-bold mb-1 px-1 uppercase tracking-wider">Delete Year</div>
            {state.availableYears.filter(y => y !== state.activeYear).map(year => (
              <button key={year} onClick={() => { deleteYear(year); setShowYearMenu(false); }}
                className="w-full text-left px-2 py-1.5 rounded-lg text-xs text-ios-red hover:bg-ios-red/10 transition-colors font-medium">
                Delete {year}
              </button>
            ))}
          </motion.div>
        )}
      </div>

      {/* Crash Banner */}
      {burnRate && <CrashBanner burn={burnRate} />}
      {disasterStreak >= 2 && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          className="mx-4 mb-2 px-4 py-2.5 rounded-xl bg-ios-red/10 border border-ios-red/20 flex items-center gap-2">
          <AlertOctagon size={14} className="text-ios-red flex-shrink-0" />
          <span className="text-[11px] font-bold text-ios-red">DISASTER STREAK: {disasterStreak} months — Interceptor Active</span>
        </motion.div>
      )}
      {recoveryStreak >= 2 && disasterStreak < 2 && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          className="mx-4 mb-2 px-4 py-2.5 rounded-xl bg-ios-green/10 border border-ios-green/20 flex items-center gap-2">
          <Zap size={14} className="text-ios-green flex-shrink-0" />
          <span className="text-[11px] font-bold text-ios-green">RECOVERY STREAK: {recoveryStreak} months — BRAVO!</span>
        </motion.div>
      )}

      {/* Summary Strip */}
      <div className="shrink-0 flex gap-2 overflow-x-auto scroll-x pb-2 px-4 mb-1">
        <SummaryStripCard title="Total In" value={grandIncoming} icon={<TrendingUp size={14} />} color="#30d158" subtitle={state.activeYear} delay={0.1} />
        <SummaryStripCard title="Total Out" value={grandOutgoing} icon={<TrendingDown size={14} />} color="#ff453a" subtitle={state.activeYear} delay={0.15} />
        <SummaryStripCard title="Debt Paid" value={grandDebtPaid} icon={<CreditCard size={14} />} color="#0a84ff" subtitle="EMI cleared" delay={0.2} />
        <SummaryStripCard title="Net Flow" value={grandIncoming - grandOutgoing} icon={<Wallet size={14} />}
          color={grandIncoming >= grandOutgoing ? '#30d158' : '#ff453a'} subtitle="Overall balance" delay={0.25} />
      </div>

      {/* Month Selector */}
      <div className="shrink-0 px-4 mb-2">
        <div className="flex gap-1.5 overflow-x-auto scroll-x pb-1">
          {monthBelt.map(({ label, idx }) => (
            <motion.button key={idx} whileTap={{ scale: 0.9 }} onClick={() => setSelectedMonth(idx)}
              className={`px-3 py-2 rounded-xl text-[11px] font-bold whitespace-nowrap transition-all ${
                selectedMonth === idx ? 'bg-ios-blue text-white ios-shadow-sm' : 'bg-ios-surface-2 text-ios-text-secondary'
              }`}>
              {label}
            </motion.button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scroll-container px-4"
        style={{ paddingBottom: 'calc(var(--sab) + 76px)' }}>
        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <motion.div key="overview" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }} className="space-y-3 stagger-children">
              {/* Hero Balance Card */}
              <div className="glass-card rounded-3xl p-5 ios-shadow-lg relative overflow-hidden">
                <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full opacity-20" style={{ background: 'linear-gradient(135deg, #bf5af2, #0a84ff)', filter: 'blur(50px)' }} />
                <div className="absolute -bottom-10 -left-10 w-32 h-32 rounded-full opacity-15" style={{ background: '#30d158', filter: 'blur(40px)' }} />
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-ios-text-secondary font-medium">Net Balance</span>
                    <StatusBadge text={currentYear.remarks.house70?.[String(selectedMonth)] || 'N/A'} />
                  </div>
                  <div className="text-[32px] font-bold text-ios-text tracking-tight mb-3">
                    <AnimatedNumber value={incomeTotal - outgoingTotal} prefix="₹" />
                  </div>
                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-ios-text-secondary font-medium">Incoming</span>
                        <span className="text-ios-green font-bold">{formatCurrency(incomeTotal)}</span>
                      </div>
                      <ProgressBar value={incomeTotal} max={Math.max(incomeTotal, outgoingTotal, 1)} color="#30d158" />
                    </div>
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-ios-text-secondary font-medium">Outgoing</span>
                        <span className="text-ios-red font-bold">{formatCurrency(outgoingTotal)}</span>
                      </div>
                      <ProgressBar value={outgoingTotal} max={Math.max(incomeTotal, outgoingTotal, 1)} color="#ff453a" />
                    </div>
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-ios-text-secondary font-medium">Balance</span>
                        <span className="font-bold" style={{ color: getStatusColor(incomeTotal - outgoingTotal) }}>
                          {formatCurrency(incomeTotal - outgoingTotal)}
                        </span>
                      </div>
                      <ProgressBar value={Math.abs(incomeTotal - outgoingTotal)} max={Math.max(Math.abs(incomeTotal - outgoingTotal), incomeTotal, outgoingTotal, 1)} color={getStatusColor(incomeTotal - outgoingTotal)} />
                    </div>
                  </div>
                </div>
              </div>

              {burnRate && <BurnRateCard burn={burnRate} />}

              {/* Income Card */}
              <div className="glass-card rounded-2xl p-4 ios-shadow card-hover">
                <SectionHeader title="Incoming" section="income" onAdd={() => openAddSheet('incomeEntries')} />
                <div className="space-y-1">
                  {currentYear.incomeEntries.map(entry => (
                    <EditableRow key={entry.id} name={entry.name} value={entry.values[selectedMonth]}
                      isEditing={editSection === 'income'}
                      onChange={v => handleIncomeEdit(entry.id, selectedMonth, v)}
                      onNameChange={n => updateEntryName('incomeEntries', entry.id, n)}
                      onDelete={() => { deleteEntry('incomeEntries', entry.id); autoAllocateAll(); }} />
                  ))}
                  {currentYear.incomeEntries.length === 0 && (
                    <div className="py-4 text-center text-[11px] text-ios-text-secondary">No entries yet — tap + to add your first income source</div>
                  )}
                  <div className="pt-2 border-t border-ios-border/15 flex justify-between">
                    <span className="text-xs font-bold text-ios-text">Total</span>
                    <span className="text-xs font-bold text-ios-green">{formatCurrency(incomeTotal)}</span>
                  </div>
                </div>
              </div>

              {/* Allocation Card */}
              <div className="glass-card rounded-2xl p-4 ios-shadow card-hover">
                <SectionHeader title="Allocation" section={null} />
                <div className="space-y-3">
                  {currentYear.allocationEntries.map((entry, idx) => {
                    const colors = ['#bf5af2', '#0a84ff', '#ff9f0a'];
                    const icons = [<PiggyBank size={14} />, <Home size={14} />, <CreditCard size={14} />];
                    return (
                      <div key={entry.id} className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `${colors[idx]}15`, color: colors[idx] }}>{icons[idx]}</div>
                        <div className="flex-1">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-ios-text-secondary font-medium">{entry.name}</span>
                            <span className="text-ios-text font-bold">{formatCurrency(entry.values[selectedMonth])}</span>
                          </div>
                          <ProgressBar value={entry.values[selectedMonth]} max={allocationTotal || 1} color={colors[idx]} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Status Card */}
<div className="glass-card rounded-2xl p-4 ios-shadow card-hover">
  <span className="text-sm font-bold text-ios-text block mb-3 tracking-tight">Status</span>
  <div className="space-y-2">
    {(() => {
      // Compute status from actual allocations vs. real outflows
      const y = currentYear;
      if (!y) return null;
      const alloc = y.allocationEntries;
      const household = getHouseholdTotal(selectedMonth);
      const debt = getDebtRepaymentTotal(selectedMonth);
      const savings = getSavingsTotal(selectedMonth);

      const statusItems = [
        {
          id: 'saving10',
          name: '10% - SAVING',
          allocation: alloc.find(e => e.id === 'saving10')?.values[selectedMonth] || 0,
          actual: savings,
        },
        {
          id: 'house70',
          name: '70% - HOUSEHOLD',
          allocation: alloc.find(e => e.id === 'house70')?.values[selectedMonth] || 0,
          actual: household,
        },
        {
          id: 'debt20',
          name: '20% - DEBT',
          allocation: alloc.find(e => e.id === 'debt20')?.values[selectedMonth] || 0,
          actual: debt,
        },
      ];

      return statusItems.map((item) => {
        const diff = item.actual - item.allocation;
        const remark = y.remarks[item.id]?.[String(selectedMonth)] || 'N/A';
        return (
          <div key={item.id} className="flex items-center justify-between py-2 border-b border-ios-border/15 last:border-0">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ background: getStatusColor(diff) }} />
              <span className="text-xs text-ios-text-secondary font-medium">{item.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold tabular-nums" style={{ color: getStatusColor(diff) }}>
                {diff >= 0 ? '+' : ''}{formatCurrency(diff)}
              </span>
              <StatusBadge text={remark} />
            </div>
          </div>
        );
      });
    })()}
  </div>
</div>

              {/* Trend Chart */}
              <div className="glass-card rounded-2xl p-4 ios-shadow card-hover">
                <span className="text-sm font-bold text-ios-text block mb-3 tracking-tight">12-Month Trend</span>
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="incGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#30d158" stopOpacity={0.3} /><stop offset="95%" stopColor="#30d158" stopOpacity={0} /></linearGradient>
                        <linearGradient id="outGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ff453a" stopOpacity={0.3} /><stop offset="95%" stopColor="#ff453a" stopOpacity={0} /></linearGradient>
                      </defs>
                      <XAxis dataKey="month" tick={{ fill: '#8e8e93', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: '#1c1c1e', border: '1px solid #38383a', borderRadius: '12px', fontSize: '12px', color: '#fff' }} formatter={(val: unknown) => formatCurrency(val as number)} />
                      <Area type="monotone" dataKey="incoming" stroke="#30d158" strokeWidth={2.5} fill="url(#incGrad)" />
                      <Area type="monotone" dataKey="outgoing" stroke="#ff453a" strokeWidth={2.5} fill="url(#outGrad)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'details' && (
            <motion.div key="details" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }} className="space-y-3 stagger-children">
              {/* True Disposable Card */}
              <div className="glass-card rounded-2xl p-4 ios-shadow card-hover">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-ios-text">True Disposable</span>
                  <span className="text-xs font-bold text-ios-blue tabular-nums">{formatCurrency(trueDisposable)}</span>
                </div>
                <div className="flex justify-between text-[10px] mb-1">
                  <span className="text-ios-text-secondary font-medium">Committed Recurring</span>
                  <span className="text-ios-text-secondary tabular-nums font-medium">{formatCurrency(committedRecurring)}</span>
                </div>
                <ProgressBar value={committedRecurring} max={selectedMonthCap?.cap || 1} color="#bf5af2" />
                <div className="flex justify-between text-[10px] mt-1">
                  <span className="text-ios-text-secondary font-medium">70% Cap</span>
                  <span className="text-ios-text-secondary tabular-nums font-medium">{formatCurrency(selectedMonthCap?.cap || 0)}</span>
                </div>
                <motion.button whileTap={{ scale: 0.95 }} onClick={() => applyRecurringAutopilot(selectedMonth)}
                  className="w-full mt-3 py-2.5 rounded-xl bg-ios-purple/15 text-xs font-bold text-ios-purple flex items-center justify-center gap-1.5">
                  <Repeat size={12} /> Apply Recurring Autopilot
                </motion.button>
              </div>

              {/* Household Expenses */}
              <div className="glass-card rounded-2xl p-4 ios-shadow card-hover">
                <SectionHeader title="Household Expenses" section="household" onAdd={() => openAddSheet('householdExpenses')} locked={selectedMonthCap?.isCapReached && !capOverride} />
                <div className="space-y-1">
                  {currentYear.householdExpenses.map(entry => (
                    <EditableRow key={entry.id} name={entry.name} value={entry.values[selectedMonth]}
                      isEditing={editSection === 'household'}
                      recurring={entry.recurring}
                      onRecurringChange={f => toggleRecurring('householdExpenses', entry.id, f)}
                      onChange={v => updateEntryValue('householdExpenses', entry.id, selectedMonth, v)}
                      onNameChange={n => updateEntryName('householdExpenses', entry.id, n)}
                      onDelete={() => deleteEntry('householdExpenses', entry.id)}
                      essential={entry.essential}
                      onToggleEssential={() => toggleEntryEssential('householdExpenses', entry.id)} />
                  ))}
                  {currentYear.householdExpenses.length === 0 && (
                    <div className="py-4 text-center text-[11px] text-ios-text-secondary">No expense categories yet — tap + to add your first one</div>
                  )}
                  <div className="pt-2 border-t border-ios-border/15 flex justify-between">
                    <span className="text-xs font-bold text-ios-text">Total</span>
                    <span className="text-xs font-bold text-ios-red">{formatCurrency(householdTotal)}</span>
                  </div>
                  {selectedMonthCap && selectedMonthCap.cap > 0 && (
                    <div className="mt-2">
                      <div className="flex justify-between text-[10px] mb-1">
                        <span className="text-ios-text-secondary font-medium">70% Cap Usage</span>
                        <span className={selectedMonthCap.isCapReached ? 'text-ios-red font-bold' : 'text-ios-text-secondary font-medium'}>
                          {Math.min(100, Math.round((selectedMonthCap.spent / selectedMonthCap.cap) * 100))}%
                        </span>
                      </div>
                      <ProgressBar value={selectedMonthCap.spent} max={selectedMonthCap.cap} color={selectedMonthCap.isCapReached ? '#ff375f' : '#0a84ff'} />
                    </div>
                  )}
                </div>
              </div>

              {/* Debt Repayment */}
              <div className="glass-card rounded-2xl p-4 ios-shadow card-hover">
                <SectionHeader title="Debt Repayment" section="debt-repay" onAdd={() => openAddSheet('debtRepayment')} />
                <div className="space-y-1">
                  {currentYear.debtRepayment.map(entry => (
                    <EditableRow key={entry.id} name={entry.name} value={entry.values[selectedMonth]}
                      isEditing={editSection === 'debt-repay'}
                      onChange={v => updateEntryValue('debtRepayment', entry.id, selectedMonth, v)}
                      onNameChange={n => updateEntryName('debtRepayment', entry.id, n)}
                      onDelete={() => deleteEntry('debtRepayment', entry.id)} />
                  ))}
                  {currentYear.debtRepayment.length === 0 && (
                    <div className="py-4 text-center text-[11px] text-ios-text-secondary">No EMIs yet — tap + to add your debt repayments</div>
                  )}
                  <div className="pt-2 border-t border-ios-border/15 flex justify-between">
                    <span className="text-xs font-bold text-ios-text">Total</span>
                    <span className="text-xs font-bold text-ios-orange">{formatCurrency(debtRepayTotal)}</span>
                  </div>
                </div>
              </div>

              {/* Savings */}
              <div className="glass-card rounded-2xl p-4 ios-shadow card-hover">
                <SectionHeader title="Savings" section="savings" onAdd={() => openAddSheet('savingsData')} />
                <div className="space-y-1">
                  {currentYear.savingsData.map(entry => (
                    <EditableRow key={entry.id} name={entry.name} value={entry.values[selectedMonth]}
                      isEditing={editSection === 'savings'}
                      onChange={v => updateEntryValue('savingsData', entry.id, selectedMonth, v)}
                      onNameChange={n => updateEntryName('savingsData', entry.id, n)}
                      onDelete={() => deleteEntry('savingsData', entry.id)} />
                  ))}
                  {currentYear.savingsData.length === 0 && (
                    <div className="py-4 text-center text-[11px] text-ios-text-secondary">No savings instruments yet — tap + to add one</div>
                  )}
                </div>
              </div>

              {expenseChartData.length > 0 && (
                <div className="glass-card rounded-2xl p-4 ios-shadow card-hover">
                  <span className="text-sm font-bold text-ios-text block mb-3 tracking-tight">Expense Distribution</span>
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={expenseChartData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3} dataKey="value">
                          {expenseChartData.map((_, i) => <Cell key={i} fill={['#0a84ff', '#30d158', '#ff9f0a', '#bf5af2', '#ff375f', '#5ac8fa', '#5e5ce6'][i % 7]} />)}
                        </Pie>
                        <Tooltip contentStyle={{ background: '#1c1c1e', border: '1px solid #38383a', borderRadius: '12px', fontSize: '12px', color: '#fff' }} formatter={(val: unknown) => formatCurrency(val as number)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'debt' && (
            <motion.div key="debt" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }} className="space-y-3 stagger-children">
              <DebtSimulatorCard store={store} />
              <div className="glass-card rounded-2xl p-4 ios-shadow card-hover">
                <SectionHeader title="Debt Progression" section="debt-prog" onAdd={() => setShowAddDebt(true)} />
                <div className="space-y-1">
                  {currentYear.debtProgression.map(entry => (
                    <EditableRow key={entry.id} name={entry.name} value={entry.values[selectedMonth]}
                      isEditing={editSection === 'debt-prog'}
                      onChange={v => updateEntryValue('debtProgression', entry.id, selectedMonth, v)}
                      onNameChange={n => updateEntryName('debtProgression', entry.id, n)}
                      onDelete={() => deleteEntry('debtProgression', entry.id)} />
                  ))}
                  {currentYear.debtProgression.length === 0 && (
                    <div className="py-4 text-center text-[11px] text-ios-text-secondary">No debts yet — tap + to add one, then set its principal, rate & EMI below</div>
                  )}
                </div>
              </div>
              {debtPieData.length > 0 && (
                <div className="glass-card rounded-2xl p-4 ios-shadow card-hover">
                  <span className="text-sm font-bold text-ios-text block mb-3 tracking-tight">Debt Composition</span>
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={debtPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3} dataKey="value">
                          {debtPieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                        </Pie>
                        <Tooltip contentStyle={{ background: '#1c1c1e', border: '1px solid #38383a', borderRadius: '12px', fontSize: '12px', color: '#fff' }} formatter={(val: unknown) => formatCurrency(val as number)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
              <div className="glass-card rounded-2xl p-4 ios-shadow card-hover">
                <span className="text-sm font-bold text-ios-text block mb-3 tracking-tight">Debt Trend</span>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={debtChartData}>
                      <defs>
                        <linearGradient id="vGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#0a84ff" stopOpacity={0.3} /><stop offset="95%" stopColor="#0a84ff" stopOpacity={0} /></linearGradient>
                        <linearGradient id="gGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#bf5af2" stopOpacity={0.3} /><stop offset="95%" stopColor="#bf5af2" stopOpacity={0} /></linearGradient>
                      </defs>
                      <XAxis dataKey="month" tick={{ fill: '#8e8e93', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: '#1c1c1e', border: '1px solid #38383a', borderRadius: '12px', fontSize: '12px', color: '#fff' }} formatter={(val: unknown) => formatCurrency(val as number)} />
                      <Area type="monotone" dataKey="vehicle" stroke="#0a84ff" strokeWidth={2.5} fill="url(#vGrad)" />
                      <Area type="monotone" dataKey="gpu" stroke="#bf5af2" strokeWidth={2.5} fill="url(#gGrad)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'tax' && (
            <motion.div key="tax" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }} className="space-y-3 stagger-children">
              {(() => {
                const tax = getTaxShieldStatus(selectedMonth);
                const radius = 36;
                const circumference = 2 * Math.PI * radius;
                const offset = circumference - (tax.pct / 100) * circumference;
                return (
                  <div className="glass-card rounded-2xl p-4 ios-shadow card-hover">
                    <div className="flex items-center gap-4">
                      <div className="relative w-20 h-20 flex-shrink-0">
                        <svg viewBox="0 0 84 84" className="w-20 h-20 -rotate-90">
                          <circle cx="42" cy="42" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
                          <circle cx="42" cy="42" r={radius} fill="none" stroke={tax.pct >= 100 ? '#30d158' : tax.pct >= 70 ? '#0a84ff' : '#ff9f0a'}
                            strokeWidth="8" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-sm font-bold text-ios-text">{Math.round(tax.pct)}%</span>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-ios-text-secondary font-medium mb-0.5">Tax Shield (80C + 80D + NPS)</div>
                        <div className="text-lg font-bold text-ios-text tabular-nums">{formatCurrency(tax.filled)} <span className="text-xs font-normal text-ios-text-secondary">/ {formatCurrency(tax.limit)}</span></div>
                        <div className="text-[10px] mt-1">
                          {tax.pct >= 100 ? (
                            <span className="text-ios-green font-bold">Limit Filled! Well done.</span>
                          ) : (
                            <span className="text-ios-text-secondary">Gap: <span className="text-ios-orange font-bold">{formatCurrency(tax.gap)}</span> · SIP: {formatCurrency(tax.monthlySipNeeded)}/mo</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="glass-card rounded-2xl p-4 ios-shadow card-hover">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-bold text-ios-text tracking-tight">Tax Investments</span>
                  <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowTaxAdd(true)}
                    className="w-8 h-8 rounded-xl bg-ios-green/15 flex items-center justify-center text-ios-green">
                    <Plus size={16} />
                  </motion.button>
                </div>
                <div className="space-y-2">
                  {currentYear.taxShieldEntries.map(entry => {
                    const val = entry.values[selectedMonth] || 0;
                    const catColor = getTaxCategoryColor(entry.category);
                    return (
                      <div key={entry.id} className="flex items-center gap-3 py-2 border-b border-ios-border/15 last:border-0">
                        <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: `${catColor}15`, color: catColor }}>
                          <Target size={14} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-center mb-0.5">
                            <span className="text-xs text-ios-text-secondary font-medium truncate">{entry.name}</span>
                            <span className="text-xs font-bold text-ios-text tabular-nums">{formatCurrency(val)}</span>
                          </div>
                          <div className="w-full h-1 bg-ios-surface-2 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, (val / entry.limit) * 100)}%`, background: catColor }} />
                          </div>
                        </div>
                        {editSection === 'tax' && (
                          <>
                            <input type="number" value={val} onChange={e => updateTaxEntryValue(entry.id, selectedMonth, Number(e.target.value))}
                              className="w-20 bg-ios-surface-2 rounded-xl px-2 py-1 text-xs text-ios-text text-right border border-ios-border/30 outline-none tabular-nums" />
                            <motion.button whileTap={{ scale: 0.8 }} onClick={() => deleteTaxEntry(entry.id)}
                              className="w-7 h-7 rounded-lg bg-ios-red/15 flex items-center justify-center text-ios-red">
                              <Trash2 size={12} />
                            </motion.button>
                          </>
                        )}
                      </div>
                    );
                  })}
                  {currentYear.taxShieldEntries.length === 0 && (
                    <div className="py-4 text-center text-[11px] text-ios-text-secondary">No tax instruments yet — tap + to add PPF, ELSS, NPS etc.</div>
                  )}
                </div>
                <motion.button whileTap={{ scale: 0.95 }} onClick={() => setEditSection(editSection === 'tax' ? null : 'tax')}
                  className={`w-full mt-3 py-2.5 rounded-xl text-xs font-bold transition-all ${editSection === 'tax' ? 'bg-ios-blue/15 text-ios-blue' : 'bg-ios-surface-2 text-ios-text-secondary'}`}>
                  {editSection === 'tax' ? 'Done Editing' : 'Edit Entries'}
                </motion.button>
              </div>
            </motion.div>
          )}

          {activeTab === 'war' && (
            <motion.div key="war" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }} className="space-y-3 stagger-children">
              {yearComparison.map((yc, i) => (
                <div key={yc.year} className="glass-card rounded-2xl p-4 ios-shadow card-hover">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-bold text-ios-text tracking-tight">{yc.year}</span>
                    {i > 0 && yc.incomeGrowthPct !== 0 && (
                      <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${yc.incomeGrowthPct > 0 ? 'bg-ios-green/15 text-ios-green' : 'bg-ios-red/15 text-ios-red'}`}>
                        {yc.incomeGrowthPct > 0 ? '+' : ''}{yc.incomeGrowthPct}% income
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="p-2.5 rounded-xl bg-ios-surface-2">
                      <div className="text-[10px] text-ios-text-secondary font-medium">Income</div>
                      <div className="text-xs font-bold text-ios-text tabular-nums">{formatCurrency(yc.totalIncome)}</div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-ios-surface-2">
                      <div className="text-[10px] text-ios-text-secondary font-medium">Household</div>
                      <div className="text-xs font-bold text-ios-text tabular-nums">{formatCurrency(yc.totalHousehold)}</div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-ios-surface-2">
                      <div className="text-[10px] text-ios-text-secondary font-medium">Savings</div>
                      <div className="text-xs font-bold text-ios-green tabular-nums">{formatCurrency(yc.totalSavings)}</div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-ios-surface-2">
                      <div className="text-[10px] text-ios-text-secondary font-medium">Debt Paid</div>
                      <div className="text-xs font-bold text-ios-blue tabular-nums">{formatCurrency(yc.totalDebtPaid)}</div>
                    </div>
                  </div>
                  {i > 0 && yc.expenseCreepPct > 10 && (
                    <div className="p-2.5 rounded-xl bg-ios-red/10 border border-ios-red/20">
                      <div className="text-[10px] text-ios-red font-bold uppercase tracking-wide">Expense Creep Alert</div>
                      <div className="text-[10px] text-ios-text-secondary">
                        Household up {yc.expenseCreepPct}% vs {yearComparison[i-1].year}. Inflation was ~6%.
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <div className="glass-card rounded-2xl p-4 ios-shadow card-hover">
                <span className="text-sm font-bold text-ios-text block mb-3 tracking-tight">Income Growth</span>
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={yearComparison}>
                      <XAxis dataKey="year" tick={{fill:'#8e8e93',fontSize:10}} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: '#1c1c1e', border: '1px solid #38383a', borderRadius: '12px', fontSize: '12px', color: '#fff' }} formatter={(val: unknown) => formatCurrency(val as number)} />
                      <Bar dataKey="totalIncome" fill="#30d158" radius={[6,6,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="glass-card rounded-2xl p-4 ios-shadow card-hover">
                <span className="text-sm font-bold text-ios-text block mb-3 tracking-tight">Debt Reduction Velocity</span>
                <div className="space-y-2">
                  {state.availableYears.map(year => {
                    const velocity = getDebtReductionVelocity(year);
                    return (
                      <div key={year} className="flex items-center justify-between py-1.5 border-b border-ios-border/15 last:border-0">
                        <span className="text-xs text-ios-text-secondary font-medium">{year}</span>
                        <span className="text-xs font-bold text-ios-blue tabular-nums">{formatCurrency(velocity)}/mo</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="glass-card rounded-2xl p-4 ios-shadow card-hover">
                <span className="text-sm font-bold text-ios-text block mb-3 tracking-tight">Savings Curve</span>
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={yearComparison.map(yc => ({ year: yc.year, savings: yc.totalSavings }))}>
                      <XAxis dataKey="year" tick={{fill:'#8e8e93',fontSize:10}} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: '#1c1c1e', border: '1px solid #38383a', borderRadius: '12px', fontSize: '12px', color: '#fff' }} formatter={(val: unknown) => formatCurrency(val as number)} />
                      <Line type="monotone" dataKey="savings" stroke="#bf5af2" strokeWidth={2.5} dot={{fill:'#bf5af2'}} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              {recoveryStreak > 0 && (
                <div className="glass-card rounded-2xl p-4 border border-ios-green/20">
                  <div className="flex items-center gap-2 mb-1">
                    <Zap size={14} className="text-ios-green" />
                    <span className="text-xs font-bold text-ios-green">Recovery Streak: {recoveryStreak} months</span>
                  </div>
                  <div className="text-[10px] text-ios-text-secondary">Keep it up! You're back in control.</div>
                </div>
              )}
              {disasterStreak > 0 && (
                <div className="glass-card rounded-2xl p-4 border border-ios-red/20">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertOctagon size={14} className="text-ios-red" />
                    <span className="text-xs font-bold text-ios-red">Disaster Streak: {disasterStreak} months</span>
                  </div>
                  <div className="text-[10px] text-ios-text-secondary">Action required. Review your budget.</div>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'sync' && (
            <motion.div key="sync" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }} className="space-y-3 stagger-children">
              <StatementImportSection store={store} selectedMonth={selectedMonth} />
              <NoSpendChallengeCard status={noSpendStatus} onCheckIn={() => { updateNoSpendStreak(); }} />
              {currentYear.familySync.enabled && (
                <SharedDashboard expenses={currentYear.familySync.sharedExpenses} />
              )}
              <div className="glass-card rounded-2xl p-4 ios-shadow card-hover">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-xl bg-ios-purple/20 flex items-center justify-center text-ios-purple"><Users size={16} /></div>
                  <span className="text-sm font-bold text-ios-text tracking-tight">Family Sync</span>
                </div>
                {!currentYear.familySync.enabled ? (
                  <div className="space-y-3">
                    <p className="text-xs text-ios-text-secondary leading-relaxed">Sync household expenses with your partner. Both devices stay updated.</p>
                    <input value={partnerNameInput} onChange={e => setPartnerNameInput(e.target.value)} placeholder="Partner name"
                      className="w-full bg-ios-surface-2 rounded-xl px-3 py-2.5 text-sm text-ios-text border border-ios-border/30 focus:border-ios-blue outline-none" />
                    <motion.button whileTap={{ scale: 0.95 }} onClick={() => { if (partnerNameInput.trim()) { enableFamilySync(partnerNameInput.trim()); setPartnerNameInput(''); } }}
                      className="w-full py-2.5 rounded-xl bg-ios-purple/15 text-xs font-bold text-ios-purple">Enable Family Sync</motion.button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-ios-text-secondary font-medium">Partner</span>
                      <span className="text-xs font-bold text-ios-text">{currentYear.familySync.partnerName}</span>
                    </div>
                    <div className="flex gap-2">
                      <motion.button whileTap={{ scale: 0.95 }} onClick={() => { setSyncPayload(generateSyncPayload()); setSyncMode('show'); setShowSyncModal(true); }}
                        className="flex-1 py-2.5 rounded-xl bg-ios-blue/15 text-xs font-bold text-ios-blue flex items-center justify-center gap-1.5"><QrCode size={12} /> Show QR</motion.button>
                      <motion.button whileTap={{ scale: 0.95 }} onClick={() => { setSyncMode('scan'); setShowSyncModal(true); }}
                        className="flex-1 py-2.5 rounded-xl bg-ios-green/15 text-xs font-bold text-ios-green flex items-center justify-center gap-1.5"><ScanLine size={12} /> Scan QR</motion.button>
                    </div>
                    <motion.button whileTap={{ scale: 0.95 }} onClick={() => disableFamilySync()}
                      className="w-full py-2 rounded-xl bg-ios-red/10 text-xs font-bold text-ios-red">Disable Sync</motion.button>
                  </div>
                )}
              </div>
              <div className="glass-card rounded-2xl p-4 ios-shadow card-hover">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-xl bg-ios-teal/20 flex items-center justify-center text-ios-teal"><Download size={16} /></div>
                  <span className="text-sm font-bold text-ios-text tracking-tight">Export & Backup</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <motion.button whileTap={{ scale: 0.95 }} onClick={handleDownloadCSV}
                    className="py-3 rounded-xl bg-ios-surface-2 flex flex-col items-center gap-1.5 export-grid-item">
                    <FileSpreadsheet size={18} className="text-ios-green" />
                    <span className="text-[10px] font-bold text-ios-text">CSV Export</span>
                  </motion.button>
                  <motion.button whileTap={{ scale: 0.95 }} onClick={handleOpenPDF}
                    className="py-3 rounded-xl bg-ios-surface-2 flex flex-col items-center gap-1.5 export-grid-item">
                    <FileText size={18} className="text-ios-blue" />
                    <span className="text-[10px] font-bold text-ios-text">PDF Report</span>
                  </motion.button>                  <motion.button whileTap={{ scale: 0.95 }} onClick={handleOpenAnnualPDF}                    className="py-3 rounded-xl bg-ios-surface-2 flex flex-col items-center gap-1.5 export-grid-item">                    <FileText size={18} className="text-ios-purple" />                    <span className="text-[10px] font-bold text-ios-text">Annual PDF</span>                  </motion.button>
                  <motion.button whileTap={{ scale: 0.95 }} onClick={handleDownloadJSON}
                    className="py-3 rounded-xl bg-ios-surface-2 flex flex-col items-center gap-1.5 export-grid-item">
                    <Share2 size={18} className="text-ios-purple" />
                    <span className="text-[10px] font-bold text-ios-text">JSON Backup</span>
                  </motion.button>
                  <label className="py-3 rounded-xl bg-ios-surface-2 flex flex-col items-center gap-1.5 cursor-pointer export-grid-item">
                    <ScanLine size={18} className="text-ios-orange" />
                    <span className="text-[10px] font-bold text-ios-text">Restore JSON</span>
                    <input type="file" accept=".json" onChange={handleFileImport} className="hidden" />
                  </label>
                </div>
              </div>
              <div className="glass-card rounded-2xl p-4 ios-shadow card-hover">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-xl bg-ios-yellow/20 flex items-center justify-center text-ios-yellow"><QrCode size={16} /></div>
                  <span className="text-sm font-bold text-ios-text tracking-tight">Migration Tool</span>
                </div>
                <p className="text-xs text-ios-text-secondary mb-3 leading-relaxed">Transfer full data to a new device via encrypted QR payload.</p>
                <motion.button whileTap={{ scale: 0.95 }} onClick={() => { setSyncPayload(btoa(exportToJSON())); setSyncMode('show'); setShowSyncModal(true); }}
                  className="w-full py-2.5 rounded-xl bg-ios-yellow/15 text-xs font-bold text-ios-yellow">Generate Migration QR</motion.button>
              </div>
            </motion.div>
          )}

{activeTab === 'coach' && (
  <motion.div key="coach" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }} className="space-y-3 stagger-children">
    {/* Coach feed */}
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-sm font-bold text-ios-text tracking-tight">Your Financial Coach</h2>      <div className="flex gap-1.5 mt-2 mb-1">        {(['monthly', 'annual'] as const).map(s => (          <button key={s} onClick={() => setCoachScope(s)} className={`px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase ${coachScope === s ? 'bg-ios-blue text-white' : 'bg-ios-surface-2 text-ios-text-secondary'}`}>{s}</button>        ))}      </div>
      <div className="flex gap-2">
        <select
          value={coachFilter}
          onChange={(e) => setCoachFilter(e.target.value as any)}
          className="bg-ios-surface-2 rounded-xl px-3 py-1.5 text-xs text-ios-text border border-ios-border/30 focus:border-ios-blue outline-none"
        >
          <option value="all">All</option>
          <option value="alert">Alerts</option>
          <option value="warning">Warnings</option>
          <option value="suggestion">Suggestions</option>
          <option value="reminder">Reminders</option>
          <option value="positive">Positive</option>
        </select>
        <button
          onClick={() => generateCoachInsights(selectedMonth)}
          className="w-8 h-8 rounded-xl bg-ios-surface-2 flex items-center justify-center text-ios-text-secondary"
        >
          <RotateCcw size={14} />
        </button>
      </div>
    </div>
    {coachScope === 'annual' && (
      <>
        <div className='grid grid-cols-4 gap-1.5'>
          {months.map((m, i) => {
            const inc = getIncomeTotal(i); const out = getOutgoingTotal(i);
            return (
              <button key={m} onClick={() => { setSelectedMonth(i); setCoachScope('monthly'); }} className={`p-2 rounded-xl text-left ${selectedMonth === i ? 'bg-ios-blue/15' : 'bg-ios-surface-2'}`}>
                <div className='text-[8px] text-ios-text-secondary font-bold uppercase truncate'>{m.slice(0, 3)}</div>
                <div className='text-[9px] text-ios-green font-bold tabular-nums'>{inc > 0 ? formatCurrency(inc) : '—'}</div>
                <div className='text-[9px] text-ios-red font-bold tabular-nums'>{out > 0 ? formatCurrency(out) : '—'}</div>
              </button>
            );
          })}
        </div>
        <div className='space-y-3'>
          {annualInsights.map(ins => (
            <div key={ins.id} className={`glass-card rounded-2xl p-4 ios-shadow border-l-4 ${ins.type === 'positive' ? 'border-ios-green/30 bg-ios-green/10' : ins.type === 'warning' ? 'border-ios-orange/30 bg-ios-orange/10' : ins.type === 'alert' ? 'border-ios-red/30 bg-ios-red/10' : 'border-ios-blue/30 bg-ios-blue/10'}`}>
              <h4 className='text-sm font-bold text-ios-text'>{ins.title}</h4>
              <p className='text-xs text-ios-text-secondary mt-1 leading-relaxed'>{ins.description}</p>
            </div>
          ))}
        </div>
      </>
    )}
    {coachScope === 'monthly' && currentYear?.coachInsights.filter(ins => !ins.isDismissed && (coachFilter === 'all' || ins.type === coachFilter)).length === 0 ? (
      <div className="glass-card rounded-2xl p-8 ios-shadow text-center">
        <Lightbulb size={32} className="text-ios-text-secondary mx-auto mb-3 opacity-50" />
        <p className="text-xs text-ios-text-secondary leading-relaxed">No insights right now. Keep up the good work!</p>
      </div>
    ) : (
      <div className="space-y-3">
        {currentYear?.coachInsights
          .filter(ins => !ins.isDismissed && (coachFilter === 'all' || ins.type === coachFilter))
          .map(ins => {
            const colors = {
              alert: 'border-ios-red/30 bg-ios-red/10',
              warning: 'border-ios-orange/30 bg-ios-orange/10',
              suggestion: 'border-ios-blue/30 bg-ios-blue/10',
              reminder: 'border-ios-purple/30 bg-ios-purple/10',
              positive: 'border-ios-green/30 bg-ios-green/10',
            };
            const icons = {
              alert: <AlertOctagon size={16} className="text-ios-red" />,
              warning: <AlertTriangle size={16} className="text-ios-orange" />,
              suggestion: <Lightbulb size={16} className="text-ios-blue" />,
              reminder: <Clock size={16} className="text-ios-purple" />,
              positive: <Zap size={16} className="text-ios-green" />,
            };
            return (
              <motion.div
                key={ins.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`glass-card rounded-2xl p-4 ios-shadow border-l-4 ${colors[ins.type]}`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-ios-surface-2">
                    {icons[ins.type]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between">
                      <h4 className="text-sm font-bold text-ios-text">{ins.title}</h4>
                      <button
                        onClick={() => dismissCoachInsight(ins.id)}
                        className="w-6 h-6 rounded-full hover:bg-ios-surface-2 flex items-center justify-center text-ios-text-secondary"
                      >
                        <X size={12} />
                      </button>
                    </div>
                    <p className="text-xs text-ios-text-secondary mt-1 leading-relaxed">{ins.description}</p>
                    {ins.action && (
                      <button
                        onClick={() => {
                          if (ins.action?.target) {
                            setActiveTab(ins.action.target);
                          }
                          // Optionally handle payload
                          if (ins.action?.payload) {
                            // e.g., focus on a specific entry
                          }
                        }}
                        className="mt-2 text-xs font-bold text-ios-blue"
                      >
                        {ins.action.label} →
                      </button>
                    )}
                    <div className="text-[10px] text-ios-text-secondary mt-2">
                      {new Date(ins.generatedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
      </div>
    )}
  </motion.div>
)}
          
        </AnimatePresence>
      </div>

      {/* Bottom Tab Bar */}
      <div className="shrink-0 absolute bottom-0 left-0 right-0 z-40 px-4 pt-2 bg-gradient-to-t from-black via-black/95 to-transparent"
        style={{ paddingBottom: 'calc(var(--sab) + 8px)', paddingLeft: 'var(--sal)', paddingRight: 'var(--sar)' }}>
        <div className="glass-card rounded-2xl flex items-center justify-around py-2 px-1 ios-shadow relative">
          {tabs.map(tab => (
            <motion.button key={tab.id} whileTap={{ scale: 0.9 }} onClick={() => setActiveTab(tab.id)} className="relative flex-1 flex flex-col items-center gap-1 py-2 z-10">
              {activeTab === tab.id && (
                <motion.div
                  layoutId="activeTabBg"
                  className="absolute inset-1 bg-white/8 rounded-xl -z-10"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <div className={activeTab === tab.id ? 'text-ios-blue' : 'text-ios-text-secondary'}>{tab.icon}</div>
              <span className={`text-[9px] font-bold ${activeTab === tab.id ? 'text-ios-text' : 'text-ios-text-secondary'}`}>{tab.label}</span>
            </motion.button>
          ))}
        </div>
      </div>

      {/* ─── Modals ───────────────────────────────────────────── */}

      {/* Add Entry Bottom Sheet */}
      <BottomSheet isOpen={addSheetOpen} onClose={() => setAddSheetOpen(false)} title="Add New Entry">
        <div className="space-y-4">
          <input value={newEntryName} onChange={e => setNewEntryName(e.target.value)} placeholder="Entry name (e.g. GYM MEMBERSHIP)"
            className="w-full bg-ios-surface-2 rounded-xl px-4 py-3 text-sm text-ios-text border border-ios-border/30 focus:border-ios-blue outline-none" />
          <motion.button whileTap={{ scale: 0.95 }} onClick={confirmAddFromSheet}
            className="w-full py-3 rounded-xl bg-ios-green/15 text-sm font-bold text-ios-green">Add Entry</motion.button>
        </div>
      </BottomSheet>

      {/* Add Year Modal */}
      <AnimatePresence>
        {showAddYear && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-6">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
              className="glass-card rounded-2xl p-5 w-full max-w-xs ios-shadow">
              <h3 className="text-sm font-bold text-ios-text mb-2 tracking-tight">Add New Year</h3>
              <input value={newYearVal} onChange={e => setNewYearVal(e.target.value)} placeholder="2028"
                className="w-full bg-ios-surface-2 rounded-xl px-3 py-2.5 text-sm text-ios-text border border-ios-border/30 focus:border-ios-blue outline-none mb-3" />
              <div className="flex gap-2">
                <button onClick={() => setShowAddYear(false)}
                  className="flex-1 py-2.5 rounded-xl bg-ios-surface-2 text-xs font-bold text-ios-text-secondary">Cancel</button>
                <button onClick={handleAddYear}
                  className="flex-1 py-2.5 rounded-xl bg-ios-blue/15 text-xs font-bold text-ios-blue">Add</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Debt Sheet */}
      <BottomSheet isOpen={showAddDebt} onClose={() => setShowAddDebt(false)} title="Add Debt">
        <div className="space-y-2">
          <input value={adName} onChange={e => setAdName(e.target.value)} placeholder="Debt name (e.g., VEHICLE)" className="w-full bg-ios-surface-2 rounded-xl px-3 py-2 text-xs text-ios-text border border-ios-border/30 outline-none" />
          <input type="number" value={adBalance} onChange={e => setAdBalance(e.target.value)} placeholder="Current outstanding balance" className="w-full bg-ios-surface-2 rounded-xl px-3 py-2 text-xs text-ios-text border border-ios-border/30 outline-none" />
          <input type="number" value={adPrincipal} onChange={e => setAdPrincipal(e.target.value)} placeholder="Original principal (optional)" className="w-full bg-ios-surface-2 rounded-xl px-3 py-2 text-xs text-ios-text border border-ios-border/30 outline-none" />
          <div className="grid grid-cols-2 gap-2">
            <input type="number" value={adRate} onChange={e => setAdRate(e.target.value)} placeholder="Interest rate %" className="w-full bg-ios-surface-2 rounded-xl px-3 py-2 text-xs text-ios-text border border-ios-border/30 outline-none" />
            <input type="number" value={adEmi} onChange={e => setAdEmi(e.target.value)} placeholder="Monthly EMI" className="w-full bg-ios-surface-2 rounded-xl px-3 py-2 text-xs text-ios-text border border-ios-border/30 outline-none" />
          </div>
          <label className="flex items-center gap-2 text-[11px] text-ios-text-secondary pt-1">
            <input type="checkbox" checked={adEmiOutflows} onChange={e => setAdEmiOutflows(e.target.checked)} />
            Add EMI to monthly outflows (Debt Repayment) from this month
          </label>
        </div>
        <button onClick={handleAddDebt} className="w-full mt-3 py-2.5 rounded-xl bg-ios-blue text-xs font-bold text-white ios-shadow-sm">Add Debt</button>
      </BottomSheet>

      {/* First-run Setup Choice Modal */}
      <AnimatePresence>
        {state.setupChoiceDone === false && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm px-6">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }}
              className="glass-card rounded-2xl p-5 w-full max-w-xs ios-shadow">
              <div className="w-12 h-12 rounded-2xl bg-ios-blue/20 flex items-center justify-center mx-auto mb-3 text-2xl">🪶</div>
              <h3 className="text-sm font-bold text-ios-text mb-2 tracking-tight text-center">Welcome to Heron</h3>
              <p className="text-xs text-ios-text-secondary mb-4 leading-relaxed text-center">
                Data from a previous version was found on this device. Keep it, or start with a clean slate and add everything yourself?
              </p>
              <div className="space-y-2">
                <button onClick={() => completeSetup(false)}
                  className="w-full py-2.5 rounded-xl bg-ios-blue text-xs font-bold text-white ios-shadow-sm">Start Afresh (recommended)</button>
                <button onClick={() => completeSetup(true)}
                  className="w-full py-2.5 rounded-xl bg-ios-surface-2 text-xs font-bold text-ios-text-secondary">Keep Existing Data</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reset Confirm Modal */}
      <AnimatePresence>
        {showResetConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-6">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
              className="glass-card rounded-2xl p-5 w-full max-w-xs ios-shadow">
              <h3 className="text-sm font-bold text-ios-text mb-2 tracking-tight">Reset All Data?</h3>
              <p className="text-xs text-ios-text-secondary mb-4 leading-relaxed">This will erase all your entries and start with empty years. Export a backup first if needed.</p>
              <div className="flex gap-2">
                <button onClick={() => setShowResetConfirm(false)}
                  className="flex-1 py-2.5 rounded-xl bg-ios-surface-2 text-xs font-bold text-ios-text-secondary">Cancel</button>
                <button onClick={() => { resetToDefaults(); setShowResetConfirm(false); setEditSection(null); }}
                  className="flex-1 py-2.5 rounded-xl bg-ios-red/15 text-xs font-bold text-ios-red">Reset</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

{/* Settings Modal */}
<AnimatePresence>
  {showSettings && (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-6"
      onClick={() => setShowSettings(false)}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        className="glass-card rounded-2xl p-5 w-full max-w-xs ios-shadow max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold text-ios-text mb-3 tracking-tight">Settings</h3>

        {/* Passcode */}
        <button
          onClick={() => { setPasscodeMode('set'); setShowSettings(false); }}
          className="w-full text-left px-3 py-2.5 rounded-xl bg-ios-surface-2 text-xs text-ios-text mb-2 flex items-center justify-between font-medium"
        >
          <span>{state.passcode ? 'Change Passcode' : 'Set Passcode'}</span>
          <ChevronRight size={14} className="text-ios-text-secondary" />
        </button>
        {state.passcode && (
          <div className="text-[10px] text-ios-text-secondary px-1 mb-3">
            Passcode is set. Used to override 70% household cap lock.
          </div>
        )}

        {/* ─── Coach Settings ─────────────────────────────── */}
        <div className="pt-3 border-t border-ios-border/15">
          <h4 className="text-xs font-bold text-ios-text-secondary uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Lightbulb size={12} /> Coach Settings
          </h4>

          {currentYear ? (
            <>
              {/* Rule toggles */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {[
                  { id: 'capAlert', label: 'Cap Alert' },
                  { id: 'spikeDetection', label: 'Spike' },
                  { id: 'recurringReminder', label: 'Recurring' },
                  { id: 'savingsCheck', label: 'Savings' },
                  { id: 'debtAcceleration', label: 'Debt' },
                  { id: 'windfall', label: 'Windfall' },
                  { id: 'emergencyFund', label: 'Emergency' },
                  { id: 'disasterStreak', label: 'Disaster' },
                  { id: 'recoveryStreak', label: 'Recovery' },
                  { id: 'predictiveAlert', label: 'Predict' },
                ].map(rule => {
                  const enabled = currentYear.coachSettings?.enabledRules?.includes(rule.id) ?? false;
                  return (
                    <button
                      key={rule.id}
                      onClick={() => {
                        const current = currentYear.coachSettings?.enabledRules || [];
                        const newRules = enabled ? current.filter(r => r !== rule.id) : [...current, rule.id];
                        updateCoachSettings({ enabledRules: newRules });
                      }}
                      className={`px-2.5 py-1 rounded-full text-[9px] font-bold transition-all ${
                        enabled ? 'bg-ios-blue text-white' : 'bg-ios-surface-2 text-ios-text-secondary'
                      }`}
                    >
                      {rule.label}
                    </button>
                  );
                })}
              </div>

              {/* Threshold inputs */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] text-ios-text-secondary font-medium">Cap Warning %</label>
                  <input
                    type="number"
                    value={Math.round((currentYear.coachSettings?.thresholds?.capWarning || 0.7) * 100)}
                    onChange={(e) => {
                      const val = Number(e.target.value) / 100;
                      if (val >= 0 && val <= 1) {
                        updateCoachSettings({
                          thresholds: { ...currentYear.coachSettings?.thresholds, capWarning: val }
                        });
                      }
                    }}
                    className="w-full bg-ios-surface-2 rounded-xl px-2 py-1 text-xs text-ios-text border border-ios-border/30 focus:border-ios-blue outline-none"
                  />
                </div>
                <div>
                  <label className="text-[9px] text-ios-text-secondary font-medium">Spike Factor</label>
                  <input
                    type="number"
                    step="0.1"
                    value={currentYear.coachSettings?.thresholds?.spikeFactor || 1.5}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (val >= 1) {
                        updateCoachSettings({
                          thresholds: { ...currentYear.coachSettings?.thresholds, spikeFactor: val }
                        });
                      }
                    }}
                    className="w-full bg-ios-surface-2 rounded-xl px-2 py-1 text-xs text-ios-text border border-ios-border/30 focus:border-ios-blue outline-none"
                  />
                </div>
                <div>
                  <label className="text-[9px] text-ios-text-secondary font-medium">Predictive %</label>
                  <input
                    type="number"
                    value={Math.round((currentYear.coachSettings?.thresholds?.predictiveWarning || 0.9) * 100)}
                    onChange={(e) => {
                      const val = Number(e.target.value) / 100;
                      if (val >= 0 && val <= 1) {
                        updateCoachSettings({
                          thresholds: { ...currentYear.coachSettings?.thresholds, predictiveWarning: val }
                        });
                      }
                    }}
                    className="w-full bg-ios-surface-2 rounded-xl px-2 py-1 text-xs text-ios-text border border-ios-border/30 focus:border-ios-blue outline-none"
                  />
                </div>
                <div>
                  <label className="text-[9px] text-ios-text-secondary font-medium">Emergency Months</label>
                  <input
                    type="number"
                    value={currentYear.coachSettings?.thresholds?.emergencyMonths || 3}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (val >= 1) {
                        updateCoachSettings({
                          thresholds: { ...currentYear.coachSettings?.thresholds, emergencyMonths: val }
                        });
                      }
                    }}
                    className="w-full bg-ios-surface-2 rounded-xl px-2 py-1 text-xs text-ios-text border border-ios-border/30 focus:border-ios-blue outline-none"
                  />
                </div>
              </div>
              <div className="text-[9px] text-ios-text-secondary mt-1">Rules active: {currentYear.coachSettings?.enabledRules?.length || 0}</div>
            </>
          ) : (
            <div className="text-xs text-ios-text-secondary">Loading...</div>
          )}
        </div>

        {/* Close button */}
        <button
          onClick={() => setShowSettings(false)}
          className="w-full py-2.5 rounded-xl bg-ios-blue/15 text-xs font-bold text-ios-blue mt-4"
        >
          Done
        </button>
      </motion.div>
    </motion.div>
  )}
</AnimatePresence>

      {/* Sync Modal */}
      <AnimatePresence>
        {showSyncModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-6">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
              className="glass-card rounded-2xl p-5 w-full max-w-xs ios-shadow">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-ios-text tracking-tight">
                  {syncMode === 'show' ? 'Scan to Sync' : 'Scan QR Code'}
                </h3>
                <button onClick={() => setShowSyncModal(false)} className="w-8 h-8 rounded-full bg-ios-surface-2 flex items-center justify-center text-ios-text-secondary"><X size={14} /></button>
              </div>
              {syncMode === 'show' && syncPayload && (
                <div className="flex flex-col items-center gap-4">
                  <div className="relative">
                    <div className="qr-pulse-ring absolute inset-0 rounded-2xl" />
                    <SyncQRCode payload={syncPayload} />
                  </div>
                  <div className="flex items-center gap-2 w-full">
                    <input value={syncPayload} readOnly className="flex-1 bg-ios-surface-2 rounded-xl px-3 py-2 text-[10px] text-ios-text border border-ios-border/30 truncate" />
                    <motion.button whileTap={{ scale: 0.9 }} onClick={handleCopyPayload}
                      className="w-9 h-9 rounded-xl bg-ios-blue/15 flex items-center justify-center text-ios-blue">
                      {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                    </motion.button>
                  </div>
                  <p className="text-[10px] text-ios-text-secondary text-center">Show this QR to your partner's device</p>
                </div>
              )}
              {syncMode === 'scan' && (
                <div className="space-y-3">
                  <textarea value={scanInput} onChange={e => setScanInput(e.target.value)} placeholder="Paste scanned payload here..."
                    className="w-full h-24 bg-ios-surface-2 rounded-xl px-3 py-2 text-xs text-ios-text border border-ios-border/30 focus:border-ios-blue outline-none resize-none" />
                  <motion.button whileTap={{ scale: 0.95 }} onClick={() => { applySyncPayload(scanInput); setScanInput(''); setShowSyncModal(false); }}
                    className="w-full py-2.5 rounded-xl bg-ios-green/15 text-xs font-bold text-ios-green">Apply Sync</motion.button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Passcode Modal */}
      <AnimatePresence>
        {passcodeMode && (
          <PasscodeModal
            mode={passcodeMode}
            onVerify={(code) => {
              const ok = verifyPasscode(code);
              if (ok) setCapOverride(true);
              return ok;
            }}
            onSet={(code) => setPasscode(code)}
            onClose={() => setPasscodeMode(null)}
          />
        )}
      </AnimatePresence>

      {/* Windfall Modal */}
      <AnimatePresence>
        {showWindfall && windfallData && (
          <WindfallModal
            data={windfallData}
            activeYear={state.activeYear}
            onApply={() => applyWindfall(windfallData)}
            onClose={() => setShowWindfall(false)}
          />
        )}
      </AnimatePresence>

      {/* Interceptor Modal */}
      <AnimatePresence>
        {showInterceptor && (
          <InterceptorModal
            status={interceptorStatus}
            onReview={() => { setActiveTab('details'); setInterceptorBypass(false); }}
            onOverride={() => { setInterceptorBypass(true); }}
            onClose={() => setShowInterceptor(false)}
          />
        )}
      </AnimatePresence>

      {/* Tax Add Modal */}
      <AnimatePresence>
        {showTaxAdd && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-6">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
              className="glass-card rounded-2xl p-5 w-full max-w-xs ios-shadow">
              <h3 className="text-sm font-bold text-ios-text mb-3 tracking-tight">Add Tax Investment</h3>
              <input value={newTaxName} onChange={e => setNewTaxName(e.target.value)} placeholder="Name (e.g. PPF Account 2)"
                className="w-full bg-ios-surface-2 rounded-xl px-3 py-2.5 text-sm text-ios-text border border-ios-border/30 focus:border-ios-blue outline-none mb-2" />
              <select value={newTaxCategory} onChange={e => setNewTaxCategory(e.target.value as TaxEntry['category'])}
                className="w-full bg-ios-surface-2 rounded-xl px-3 py-2.5 text-sm text-ios-text border border-ios-border/30 focus:border-ios-blue outline-none mb-2">
                <option value="ppf">PPF</option>
                <option value="elss">ELSS</option>
                <option value="nps">NPS</option>
                <option value="sukanya">Sukanya</option>
                <option value="insurance">Insurance</option>
                <option value="fd">Tax Saver FD</option>
                <option value="other">Other</option>
              </select>
              <input type="number" value={newTaxLimit} onChange={e => setNewTaxLimit(e.target.value)} placeholder="Annual Limit"
                className="w-full bg-ios-surface-2 rounded-xl px-3 py-2.5 text-sm text-ios-text border border-ios-border/30 focus:border-ios-blue outline-none mb-3" />
              <div className="flex gap-2">
                <button onClick={() => setShowTaxAdd(false)}
                  className="flex-1 py-2.5 rounded-xl bg-ios-surface-2 text-xs font-bold text-ios-text-secondary">Cancel</button>
                <button onClick={() => { if (newTaxName.trim()) { addTaxEntry(newTaxName.trim(), newTaxCategory, Number(newTaxLimit) || 150000); setNewTaxName(''); setNewTaxLimit('150000'); setShowTaxAdd(false); } }}
                  className="flex-1 py-2.5 rounded-xl bg-ios-green/15 text-xs font-bold text-ios-green">Add</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cap Block Toast */}
      <div className={`cap-toast ${showCapToast ? 'active' : ''}`}>
        <Lock size={14} className="inline mr-1" /> 70% Cap Reached — Passcode Required
      </div>
    </div>
  );
}
