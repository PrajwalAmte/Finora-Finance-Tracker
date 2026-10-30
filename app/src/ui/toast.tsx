import React, { useEffect, useState } from 'react';
import { cx } from './format';

interface ToastItem {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'error';
  action?: { label: string; onClick: () => void };
  /** Stays until its action is tapped (used for "new version available"). */
  sticky?: boolean;
}

type Listener = (t: ToastItem) => void;
const listeners = new Set<Listener>();
let seq = 0;

function emit(message: string, tone: ToastItem['tone'], action?: ToastItem['action'], sticky = false) {
  const t = { id: ++seq, message, tone, action, sticky };
  listeners.forEach(l => l(t));
}

export const toast = {
  info: (m: string, action?: ToastItem['action']) => emit(m, 'info', action),
  sticky: (m: string, action: NonNullable<ToastItem['action']>) => emit(m, 'info', action, true),
  success: (m: string, action?: ToastItem['action']) => emit(m, 'success', action),
  error: (m: string) => emit(m, 'error'),
};

/** Snackbar above the tab bar. Undo lives here instead of "Are you sure?" dialogs. */
export const Toaster: React.FC = () => {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    const l: Listener = t => {
      setItems(prev => [...prev.filter(x => x.sticky).slice(-1), ...prev.filter(x => !x.sticky).slice(-2), t]);
      if (!t.sticky) setTimeout(() => setItems(prev => prev.filter(x => x.id !== t.id)), t.action ? 6000 : 3500);
    };
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return (
    <div className="fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4 pointer-events-none" style={{ bottom: 'calc(env(safe-area-inset-bottom) + 76px)' }}>
      {items.map(t => (
        <div
          key={t.id}
          role="status"
          className={cx(
            'pointer-events-auto w-full max-w-md flex items-center gap-3 rounded-xl px-4 py-3 shadow-lg text-sm animate-slide-up',
            t.tone === 'error' ? 'bg-error-600 text-white' : 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900',
          )}
        >
          <span className="flex-1">{t.message}</span>
          {t.action && (
            <button
              className="font-semibold text-primary-300 dark:text-primary-700 uppercase text-xs tracking-wide"
              onClick={() => {
                t.action!.onClick();
                setItems(prev => prev.filter(x => x.id !== t.id));
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
};
