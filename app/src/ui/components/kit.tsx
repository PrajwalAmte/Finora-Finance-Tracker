import React, { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Eye, EyeOff, X } from 'lucide-react';
import { twMerge } from 'tailwind-merge';
import { D, type DecInput } from '../../domain/money';
import { cx, inr, inrShort } from '../format';
import { useData, useStore } from '../vault';
import { patchSettings as touchSettings } from '../actions';

// ── Privacy mode ────────────────────────────────────────────────────────────

export function usePrivacy(): [boolean, () => void] {
  const data = useData();
  const store = useStore();
  return [data.settings.privacyMode, () => store.update(d => ({ ...d, settings: touchSettings(d.settings, { privacyMode: !d.settings.privacyMode }) }))];
}

/** Counts from the previous value to the new one, so totals feel alive when they change. */
function useCountUp(target: number, enabled: boolean): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (!enabled || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setValue(target);
      from.current = target;
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 700);
      const eased = 1 - Math.pow(1 - k, 3);
      setValue(a + (target - a) * eased);
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled]);
  return value;
}

/** An amount that respects privacy mode. `animate` counts up to new values (hero numbers). */
export const Money: React.FC<{ value: DecInput; short?: boolean; paise?: boolean; className?: string; signed?: boolean; animate?: boolean }> = ({ value, short, paise, className, signed, animate }) => {
  const [hidden] = usePrivacy();
  const v = D(value);
  const shown = useCountUp(v.toNumber(), !!animate && !hidden);
  if (hidden) return <span className={cx('tracking-[0.2em]', className)}>₹ ••••</span>;
  const n = animate ? shown : v.toNumber();
  const text = short ? inrShort(n) : inr(n, paise);
  return <span className={cx('num', className)}>{signed && v.gt(0) ? '+' : ''}{text}</span>;
};

export const PrivacyToggle: React.FC = () => {
  const [hidden, toggle] = usePrivacy();
  return (
    <IconButton label={hidden ? 'Show amounts' : 'Hide amounts'} onClick={toggle}>
      {hidden ? <EyeOff size={19} /> : <Eye size={19} />}
    </IconButton>
  );
};

// ── Layout ──────────────────────────────────────────────────────────────────

export const IconButton: React.FC<{ label: string; onClick?: () => void; children: React.ReactNode; className?: string }> = ({ label, onClick, children, className }) => (
  <button
    aria-label={label} title={label} onClick={onClick}
    className={cx('pressable h-10 w-10 inline-flex items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-white/[0.07]', className)}
  >
    {children}
  </button>
);

/**
 * Screen with a large display title that hands over to a compact sticky bar once it scrolls
 * away (iOS-style). `back` shows a back arrow; the floating tab bar sits below every screen.
 */
export const Screen: React.FC<{ title: string; back?: boolean | string; actions?: React.ReactNode; children: React.ReactNode; subtitle?: string; eyebrow?: string }> = ({ title, back, actions, children, subtitle, eyebrow }) => {
  const navigate = useNavigate();
  const sentinel = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setCompact(!e.isIntersecting), { rootMargin: '-56px 0px 0px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div className="min-h-full">
      <header
        className={cx('sticky top-0 z-30 transition-colors duration-300', compact ? 'bg-neutral-50/80 dark:bg-neutral-950/75 backdrop-blur-xl border-b hairline' : 'bg-transparent border-b border-transparent')}
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="h-14 flex items-center gap-1 px-2 max-w-2xl mx-auto">
          {back && (
            <IconButton label="Back" onClick={() => (typeof back === 'string' ? navigate(back) : navigate(-1))}>
              <ChevronLeft size={24} />
            </IconButton>
          )}
          <div className={cx('flex-1 min-w-0 transition-all duration-300', !back && 'pl-2', compact ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1')}>
            <div className="font-display text-[17px] font-bold truncate">{title}</div>
          </div>
          <div className="flex items-center">{actions}</div>
        </div>
      </header>
      <main className="px-4 pb-32 max-w-2xl mx-auto">
        <div className="pt-1 pb-5 animate-rise">
          {eyebrow && <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary-600 dark:text-primary-300 mb-1">{eyebrow}</div>}
          <h1 className="font-display text-[32px] leading-[1.1] font-extrabold tracking-[-0.02em]">{title}</h1>
          {subtitle && <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">{subtitle}</p>}
          <div ref={sentinel} className="h-px" />
        </div>
        <div className="space-y-5">{children}</div>
      </main>
    </div>
  );
};

export const Section: React.FC<{ title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ title, action, children, className }) => (
  <section className={cx('animate-rise', className)}>
    {(title || action) && (
      <div className="flex items-center justify-between mb-2.5 px-1">
        {title && <h2 className="font-sans text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-[0.18em]">{title}</h2>}
        {action}
      </div>
    )}
    {children}
  </section>
);

export const Panel: React.FC<{ children: React.ReactNode; className?: string; onClick?: () => void }> = ({ children, className, onClick }) => (
  <div onClick={onClick} className={cx('surface rounded-3xl', onClick && 'cursor-pointer pressable', className)}>
    {children}
  </div>
);

/** The card for headline numbers: a plain card with more padding. */
export const HeroCard: React.FC<{ children: React.ReactNode; className?: string; onClick?: () => void }> = ({ children, className, onClick }) => (
  <div onClick={onClick} className={cx('surface rounded-[28px] p-5 animate-rise', onClick && 'cursor-pointer pressable', className)}>
    {children}
  </div>
);

/** Tappable list row: icon, title/subtitle, trailing value. */
export const Row: React.FC<{
  icon?: React.ReactNode; title: React.ReactNode; subtitle?: React.ReactNode; trailing?: React.ReactNode; trailingSub?: React.ReactNode;
  onClick?: () => void; chevron?: boolean; className?: string; iconClassName?: string;
}> = ({ icon, title, subtitle, trailing, trailingSub, onClick, chevron, className, iconClassName }) => {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={cx('w-full flex items-center gap-3.5 px-4 py-3.5 text-left', onClick && 'pressable active:bg-neutral-100 dark:active:bg-white/[0.04]', className)}>
      {icon && (
        <div className={twMerge('shrink-0 h-11 w-11 rounded-2xl flex items-center justify-center bg-neutral-100 text-neutral-600 dark:bg-white/[0.06] dark:text-neutral-300', iconClassName)}>
          {icon}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-semibold truncate tracking-[-0.005em]">{title}</div>
        {subtitle && <div className="text-[12.5px] text-neutral-500 dark:text-neutral-400 truncate mt-0.5">{subtitle}</div>}
      </div>
      {(trailing || trailingSub) && (
        <div className="text-right shrink-0">
          {trailing && <div className="text-[15px] font-semibold num">{trailing}</div>}
          {trailingSub && <div className="text-[12px] mt-0.5 num">{trailingSub}</div>}
        </div>
      )}
      {chevron && <ChevronRight size={18} className="text-neutral-400 dark:text-neutral-600 shrink-0" />}
    </Tag>
  );
};

export const List: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <Panel className={cx('divide-y divide-neutral-100 dark:divide-white/[0.05] overflow-hidden', className)}>{children}</Panel>
);

export const Stat: React.FC<{ label: string; value: React.ReactNode; sub?: React.ReactNode; className?: string }> = ({ label, value, sub, className }) => (
  <div className={className}>
    <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400">{label}</div>
    <div className="font-display text-[17px] font-bold mt-1 num">{value}</div>
    {sub && <div className="text-xs mt-0.5">{sub}</div>}
  </div>
);

export const Empty: React.FC<{ icon: React.ReactNode; title: string; body?: string; action?: React.ReactNode }> = ({ icon, title, body, action }) => (
  <Panel className="px-6 py-12 text-center animate-rise">
    <div className="mx-auto h-16 w-16 rounded-3xl bg-primary-50 text-primary-600 dark:bg-primary-500/15 dark:text-primary-300 flex items-center justify-center mb-4">{icon}</div>
    <h3 className="font-display text-lg font-bold">{title}</h3>
    {body && <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1.5 max-w-xs mx-auto leading-relaxed">{body}</p>}
    {action && <div className="mt-5 flex justify-center gap-2 flex-wrap">{action}</div>}
  </Panel>
);

export const Chip: React.FC<{ active?: boolean; onClick?: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className={cx(
      'pressable shrink-0 h-9 px-4 rounded-full text-[13px] font-semibold whitespace-nowrap transition-colors',
      active
        ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-950'
        : 'bg-white text-neutral-700 ring-1 ring-inset ring-neutral-200 dark:bg-white/[0.05] dark:text-neutral-300 dark:ring-white/[0.08]',
    )}
  >
    {children}
  </button>
);

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex p-1 rounded-2xl bg-neutral-200/60 dark:bg-white/[0.05] dark:ring-1 dark:ring-inset dark:ring-white/[0.06]">
      {options.map(o => (
        <button
          key={o.value} onClick={() => onChange(o.value)}
          className={cx('flex-1 h-9 rounded-xl text-[13px] font-semibold transition-all duration-200',
            value === o.value ? 'bg-white text-neutral-900 shadow-sm dark:bg-white/[0.12] dark:text-white' : 'text-neutral-500 dark:text-neutral-400')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }> = ({ checked, onChange, label, description }) => (
  <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="w-full flex items-center gap-3 px-4 py-3.5 text-left">
    <div className="flex-1">
      <div className="text-[15px] font-semibold">{label}</div>
      {description && <div className="text-[12.5px] text-neutral-500 dark:text-neutral-400 mt-0.5">{description}</div>}
    </div>
    <span className={cx('relative h-7 w-12 rounded-full transition-colors duration-300', checked ? 'bg-primary-600 dark:bg-primary-500' : 'bg-neutral-300 dark:bg-white/15')}>
      <span className={cx('absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-md transition-transform duration-300', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
    </span>
  </button>
);

// ── Bottom sheet (forms) ────────────────────────────────────────────────────

const SheetDepth = createContext(0);

export const Sheet: React.FC<{ open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode }> = ({ open, onClose, title, children, footer }) => {
  const depth = useContext(SheetDepth);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <SheetDepth.Provider value={depth + 1}>
      <div className="fixed inset-0 flex items-end sm:items-center justify-center" style={{ zIndex: 50 + depth * 2 }}>
        <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
        <div
          role="dialog" aria-label={title}
          className="relative w-full sm:max-w-lg max-h-[92vh] flex flex-col bg-white dark:bg-[#14141d] rounded-t-[32px] sm:rounded-[32px] animate-slide-up dark:ring-1 dark:ring-white/[0.08]"
        >
          <div className="pt-2.5 flex justify-center sm:hidden"><span className="h-1.5 w-11 rounded-full bg-neutral-300 dark:bg-white/20" /></div>
          <div className="flex items-center justify-between px-6 pt-3 pb-3">
            <h2 className="font-display text-xl font-extrabold">{title}</h2>
            <IconButton label="Close" onClick={onClose} className="bg-neutral-100 dark:bg-white/[0.07] h-9 w-9"><X size={18} /></IconButton>
          </div>
          <div className="overflow-y-auto px-6 pb-5 space-y-4">{children}</div>
          {footer && <div className="px-6 pt-3 border-t hairline" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 14px)' }}>{footer}</div>}
        </div>
      </div>
    </SheetDepth.Provider>
  );
};

// ── Form fields ─────────────────────────────────────────────────────────────

const fieldClass = cx(
  'block w-full h-[52px] px-4 rounded-2xl text-[16px] transition-shadow',
  'bg-neutral-100/80 ring-1 ring-inset ring-transparent placeholder:text-neutral-400',
  'dark:bg-white/[0.05] dark:ring-white/[0.08] dark:placeholder:text-neutral-500',
  'focus:outline-none focus:ring-2 focus:ring-primary-400/70 focus:bg-white dark:focus:bg-white/[0.07]',
);

export const Field: React.FC<{ label: string; hint?: string; error?: string; children: (id: string) => React.ReactNode }> = ({ label, hint, error, children }) => {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-[12px] font-semibold uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400 mb-1.5 ml-1">{label}</label>
      {children(id)}
      {error ? <p className="mt-1.5 ml-1 text-xs text-error-500">{error}</p> : hint ? <p className="mt-1.5 ml-1 text-xs text-neutral-500 dark:text-neutral-400">{hint}</p> : null}
    </div>
  );
};

export const TextField: React.FC<{ label: string; value: string; onChange: (v: string) => void; hint?: string; error?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>> = ({ label, value, onChange, hint, error, className, ...rest }) => (
  <Field label={label} hint={hint} error={error}>
    {id => <input id={id} value={value} onChange={e => onChange(e.target.value)} className={cx(fieldClass, error && 'ring-error-400/70', className)} {...rest} />}
  </Field>
);

/** Amount input with the decimal keypad on phones. */
export const AmountField: React.FC<{ label: string; value: string; onChange: (v: string) => void; hint?: string; autoFocus?: boolean; prefix?: string }> = ({ label, value, onChange, hint, autoFocus, prefix = '₹' }) => (
  <Field label={label} hint={hint}>
    {id => (
      <div className="relative">
        {prefix && <span className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400 font-semibold">{prefix}</span>}
        <input
          id={id} inputMode="decimal" autoFocus={autoFocus} value={value}
          onChange={e => onChange(e.target.value.replace(/[^\d.]/g, ''))}
          className={cx(fieldClass, prefix && 'pl-8', 'num font-semibold')}
        />
      </div>
    )}
  </Field>
);

const CHEVRON = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="#71717c" stroke-width="2"><path d="M4 6l4 4 4-4"/></svg>')}")`;

export const SelectField: React.FC<{ label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; hint?: string }> = ({ label, value, onChange, options, hint }) => (
  <Field label={label} hint={hint}>
    {id => (
      <select
        id={id} value={value} onChange={e => onChange(e.target.value)}
        className={cx(fieldClass, 'appearance-none pr-10 bg-no-repeat dark:[color-scheme:dark]')}
        style={{ backgroundImage: CHEVRON, backgroundPosition: 'right 1rem center' }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )}
  </Field>
);

export const DateField: React.FC<{ label: string; value: string; onChange: (v: string) => void; min?: string; max?: string; hint?: string }> = ({ label, value, onChange, min, max, hint }) => (
  <Field label={label} hint={hint}>
    {id => <input id={id} type="date" value={value} min={min} max={max} onChange={e => onChange(e.target.value)} className={cx(fieldClass, 'min-w-0 max-w-full appearance-none text-left [&::-webkit-date-and-time-value]:text-left [&::-webkit-date-and-time-value]:min-h-[1.5em] dark:[color-scheme:dark]')} />}
  </Field>
);

export function useDisclosure(initial = false): [boolean, () => void, () => void] {
  const [open, setOpen] = useState(initial);
  return [open, () => setOpen(true), () => setOpen(false)];
}
