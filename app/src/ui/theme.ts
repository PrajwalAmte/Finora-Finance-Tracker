import { useEffect, useState } from 'react';
import { applyStatusBar } from '../platform/device';

export type ThemeSetting = 'system' | 'light' | 'dark';

function systemDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

/** Apply the theme to <html>; Tailwind's `dark:` variants key off the class. */
export function applyTheme(setting: ThemeSetting): boolean {
  const dark = setting === 'dark' || (setting === 'system' && systemDark());
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0b12' : '#f6f6fa');
  // Light status-bar text on dark screens and the reverse; otherwise the clock vanishes on iOS.
  applyStatusBar(dark);
  return dark;
}

/** Follows the class on <html>, so components re-render when the theme changes. */
export function useTheme(): { theme: 'light' | 'dark' } {
  const read = () => (document.documentElement.classList.contains('dark') ? 'dark' : 'light') as 'light' | 'dark';
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return { theme };
}
