import { useEffect, useState } from 'react';

/** Chrome/Edge/Android offer `beforeinstallprompt`; we hold on to it so Settings can show "Install". */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    listeners.forEach(l => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach(l => l());
  });
}

export function useInstallPrompt(): (() => Promise<boolean>) | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick(t => t + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  if (!deferred) return null;
  return async () => {
    const e = deferred;
    if (!e) return false;
    await e.prompt();
    const choice = await e.userChoice;
    deferred = null;
    return choice.outcome === 'accepted';
  };
}
