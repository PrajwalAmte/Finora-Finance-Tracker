import React, { createContext, useContext, useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Eye, EyeOff, X } from 'lucide-react';
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

/** An amount that respects privacy mode. */
export const Money: React.FC<{ value: DecInput; short?: boolean; paise?: boolean; className?: string; signed?: boolean }> = ({ value, short, paise, className, signed }) => {
  const [hidden] = usePrivacy();
  if (hidden) return <span className={cx('tracking-widest', className)}>₹••••</span>;
  const v = D(value);
  const text = short ? inrShort(v) : inr(v, paise);
  return <span className={cx('tabular-nums', className)}>{signed && v.gt(0) ? '+' : ''}{text}</span>;
};

export const PrivacyToggle: React.FC = () => {
  const [hidden, toggle] = usePrivacy();
  return (
    <IconButton label={hidden ? 'Show amounts' : 'Hide amounts'} onClick={toggle}>
      {hidden ? <EyeOff size={20} /> : <Eye size={20} />}
    </IconButton>
  );
};

// ── Layout ──────────────────────────────────────────────────────────────────

export const IconButton: React.FC<{ label: string; onClick?: () => void; children: React.ReactNode; className?: string }> = ({ label, onClick, children, className }) => (
  <button aria-label={label} title={label} onClick={onClick} className={cx('h-10 w-10 inline-flex items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 active:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-800', className)}>
    {children}
  </button>
);

/** Screen with a sticky header. `back` shows a back arrow; the tab bar sits below every tab screen. */
export const Screen: React.FC<{ title: string; back?: boolean | string; actions?: React.ReactNode; children: React.ReactNode; subtitle?: string }> = ({ title, back, actions, children, subtitle }) => {
  const navigate = useNavigate();
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 bg-neutral-50/90 dark:bg-neutral-950/90 backdrop-blur border-b border-neutral-200/70 dark:border-neutral-800" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="h-14 flex items-center gap-1 px-2">
          {back && (
            <IconButton label="Back" onClick={() => (typeof back === 'string' ? navigate(back) : navigate(-1))}>
              <ChevronLeft size={24} />
            </IconButton>
          )}
          <div className={cx('flex-1 min-w-0', !back && 'pl-2')}>
            <h1 className="text-lg font-semibold truncate">{title}</h1>
            {subtitle && <p className="text-xs text-neutral-500 truncate -mt-0.5">{subtitle}</p>}
          </div>
          {actions}
        </div>
      </header>
      <main className="px-4 pt-4 pb-28 max-w-2xl mx-auto space-y-4">{children}</main>
    </div>
  );
};

export const Section: React.FC<{ title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ title, action, children, className }) => (
  <section className={className}>
    {(title || action) && (
      <div className="flex items-center justify-between mb-2 px-1">
        {title && <h2 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">{title}</h2>}
        {action}
      </div>
    )}
    {children}
  </section>
);

export const Panel: React.FC<{ children: React.ReactNode; className?: string; onClick?: () => void }> = ({ children, className, onClick }) => (
  <div onClick={onClick} className={cx('rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200/80 dark:border-neutral-800', onClick && 'cursor-pointer active:scale-[0.99] transition-transform', className)}>
    {children}
  </div>
);

/** Tappable list row: icon, title/subtitle, trailing value. */
export const Row: React.FC<{
  icon?: React.ReactNode; title: React.ReactNode; subtitle?: React.ReactNode; trailing?: React.ReactNode; trailingSub?: React.ReactNode;
  onClick?: () => void; chevron?: boolean; className?: string;
}> = ({ icon, title, subtitle, trailing, trailingSub, onClick, chevron, className }) => {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={cx('w-full flex items-center gap-3 px-4 py-3 text-left', onClick && 'active:bg-neutral-100 dark:active:bg-neutral-800', className)}>
      {icon && <div className="shrink-0 h-10 w-10 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-600 dark:text-neutral-300">{icon}</div>}
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-medium truncate">{title}</div>
        {subtitle && <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate mt-0.5">{subtitle}</div>}
      </div>
      {(trailing || trailingSub) && (
        <div className="text-right shrink-0">
          {trailing && <div className="text-[15px] font-medium">{trailing}</div>}
          {trailingSub && <div className="text-xs mt-0.5">{trailingSub}</div>}
        </div>
      )}
      {chevron && <ChevronRight size={18} className="text-neutral-400 shrink-0" />}
    </Tag>
  );
};

export const List: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <Panel className={cx('divide-y divide-neutral-100 dark:divide-neutral-800 overflow-hidden', className)}>{children}</Panel>
);

export const Stat: React.FC<{ label: string; value: React.ReactNode; sub?: React.ReactNode; className?: string }> = ({ label, value, sub, className }) => (
  <div className={className}>
    <div className="text-xs text-neutral-500 dark:text-neutral-400">{label}</div>
    <div className="text-base font-semibold mt-0.5">{value}</div>
    {sub && <div className="text-xs mt-0.5">{sub}</div>}
  </div>
);

export const Empty: React.FC<{ icon: React.ReactNode; title: string; body?: string; action?: React.ReactNode }> = ({ icon, title, body, action }) => (
  <Panel className="px-6 py-10 text-center">
    <div className="mx-auto h-14 w-14 rounded-full bg-primary-50 dark:bg-primary-950 text-primary-600 dark:text-primary-400 flex items-center justify-center mb-3">{icon}</div>
    <h3 className="font-semibold">{title}</h3>
    {body && <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1 max-w-xs mx-auto">{body}</p>}
    {action && <div className="mt-4 flex justify-center gap-2 flex-wrap">{action}</div>}
  </Panel>
);

export const Chip: React.FC<{ active?: boolean; onClick?: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button onClick={onClick} className={cx('shrink-0 h-8 px-3 rounded-full text-sm border whitespace-nowrap', active ? 'bg-primary-600 text-white border-primary-600' : 'bg-white dark:bg-neutral-900 border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300')}>
    {children}
  </button>
);

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex p-1 rounded-xl bg-neutral-200/70 dark:bg-neutral-800">
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)} className={cx('flex-1 h-8 rounded-lg text-sm font-medium', value === o.value ? 'bg-white dark:bg-neutral-950 shadow-sm' : 'text-neutral-600 dark:text-neutral-400')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }> = ({ checked, onChange, label, description }) => (
  <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
    <div className="flex-1">
      <div className="text-[15px] font-medium">{label}</div>
      {description && <div className="text-xs text-neutral-500 mt-0.5">{description}</div>}
    </div>
    <span className={cx('relative h-6 w-11 rounded-full transition-colors', checked ? 'bg-primary-600' : 'bg-neutral-300 dark:bg-neutral-700')}>
      <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')} />
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
        <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onClose} />
        <div role="dialog" aria-label={title} className="relative w-full sm:max-w-lg max-h-[92vh] flex flex-col bg-white dark:bg-neutral-900 rounded-t-3xl sm:rounded-3xl shadow-xl animate-slide-up">
          <div className="pt-2 flex justify-center sm:hidden"><span className="h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-700" /></div>
          <div className="flex items-center justify-between px-5 pt-2 pb-3">
            <h2 className="text-lg font-semibold">{title}</h2>
            <IconButton label="Close" onClick={onClose}><X size={20} /></IconButton>
          </div>
          <div className="overflow-y-auto px-5 pb-4 space-y-4">{children}</div>
          {footer && <div className="px-5 pt-3 border-t border-neutral-100 dark:border-neutral-800" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>{footer}</div>}
        </div>
      </div>
    </SheetDepth.Provider>
  );
};

// ── Form fields ─────────────────────────────────────────────────────────────

const fieldClass = 'block w-full h-12 px-3 rounded-xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-700 text-[16px] focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

export const Field: React.FC<{ label: string; hint?: string; error?: string; children: (id: string) => React.ReactNode }> = ({ label, hint, error, children }) => {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">{label}</label>
      {children(id)}
      {error ? <p className="mt-1 text-xs text-error-600">{error}</p> : hint ? <p className="mt-1 text-xs text-neutral-500">{hint}</p> : null}
    </div>
  );
};

export const TextField: React.FC<{ label: string; value: string; onChange: (v: string) => void; hint?: string; error?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>> = ({ label, value, onChange, hint, error, className, ...rest }) => (
  <Field label={label} hint={hint} error={error}>
    {id => <input id={id} value={value} onChange={e => onChange(e.target.value)} className={cx(fieldClass, className)} {...rest} />}
  </Field>
);

/** Amount input with the decimal keypad on phones. */
export const AmountField: React.FC<{ label: string; value: string; onChange: (v: string) => void; hint?: string; autoFocus?: boolean; prefix?: string }> = ({ label, value, onChange, hint, autoFocus, prefix = '₹' }) => (
  <Field label={label} hint={hint}>
    {id => (
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500">{prefix}</span>}
        <input
          id={id} inputMode="decimal" autoFocus={autoFocus} value={value}
          onChange={e => onChange(e.target.value.replace(/[^\d.]/g, ''))}
          className={cx(fieldClass, prefix && 'pl-7', 'tabular-nums')}
        />
      </div>
    )}
  </Field>
);

export const SelectField: React.FC<{ label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; hint?: string }> = ({ label, value, onChange, options, hint }) => (
  <Field label={label} hint={hint}>
    {id => (
      <select id={id} value={value} onChange={e => onChange(e.target.value)} className={cx(fieldClass, 'dark:[color-scheme:dark]')}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )}
  </Field>
);

export const DateField: React.FC<{ label: string; value: string; onChange: (v: string) => void; max?: string; hint?: string }> = ({ label, value, onChange, max, hint }) => (
  <Field label={label} hint={hint}>
    {id => <input id={id} type="date" value={value} max={max} onChange={e => onChange(e.target.value)} className={cx(fieldClass, 'dark:[color-scheme:dark]')} />}
  </Field>
);

export function useDisclosure(initial = false): [boolean, () => void, () => void] {
  const [open, setOpen] = useState(initial);
  return [open, () => setOpen(true), () => setOpen(false)];
}
