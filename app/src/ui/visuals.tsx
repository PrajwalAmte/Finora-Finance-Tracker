import React from 'react';
import {
  BadgeIndianRupee, Banknote, BookOpen, Briefcase, Bus, Car, Coins, Fuel, Gem, Gift, HeartPulse, Home, Landmark, LineChart,
  PiggyBank, Plane, Popcorn, Receipt, RefreshCcw, Repeat, Scissors, ShoppingBag, ShoppingCart, Sparkles, TrendingUp, Utensils, Wallet, Zap,
} from 'lucide-react';
import type { AssetType } from '../domain/types';

interface Visual {
  icon: React.ElementType;
  /** Tile classes: soft tint in light mode, glowing tint in dark mode. */
  tile: string;
}

const tint = (light: string, dark: string) => `${light} ${dark}`;

const TINTS = {
  amber: tint('bg-amber-100 text-amber-700', 'dark:bg-amber-400/15 dark:text-amber-300'),
  emerald: tint('bg-emerald-100 text-emerald-700', 'dark:bg-emerald-400/15 dark:text-emerald-300'),
  sky: tint('bg-sky-100 text-sky-700', 'dark:bg-sky-400/15 dark:text-sky-300'),
  violet: tint('bg-violet-100 text-violet-700', 'dark:bg-violet-400/15 dark:text-violet-300'),
  rose: tint('bg-rose-100 text-rose-700', 'dark:bg-rose-400/15 dark:text-rose-300'),
  orange: tint('bg-orange-100 text-orange-700', 'dark:bg-orange-400/15 dark:text-orange-300'),
  teal: tint('bg-teal-100 text-teal-700', 'dark:bg-teal-400/15 dark:text-teal-300'),
  indigo: tint('bg-indigo-100 text-indigo-700', 'dark:bg-indigo-400/15 dark:text-indigo-300'),
  pink: tint('bg-pink-100 text-pink-700', 'dark:bg-pink-400/15 dark:text-pink-300'),
  iris: tint('bg-primary-100 text-primary-700', 'dark:bg-primary-400/15 dark:text-primary-200'),
  slate: tint('bg-neutral-100 text-neutral-600', 'dark:bg-white/[0.07] dark:text-neutral-300'),
};

const CATEGORY: Record<string, Visual> = {
  Food: { icon: Utensils, tile: TINTS.orange },
  Groceries: { icon: ShoppingCart, tile: TINTS.emerald },
  Transport: { icon: Bus, tile: TINTS.sky },
  Fuel: { icon: Fuel, tile: TINTS.amber },
  Shopping: { icon: ShoppingBag, tile: TINTS.pink },
  'Bills & Utilities': { icon: Zap, tile: TINTS.indigo },
  Rent: { icon: Home, tile: TINTS.violet },
  Health: { icon: HeartPulse, tile: TINTS.rose },
  Entertainment: { icon: Popcorn, tile: TINTS.violet },
  Travel: { icon: Plane, tile: TINTS.sky },
  Education: { icon: BookOpen, tile: TINTS.teal },
  'Personal Care': { icon: Scissors, tile: TINTS.pink },
  Gifts: { icon: Gift, tile: TINTS.rose },
  Salary: { icon: Briefcase, tile: TINTS.emerald },
  Business: { icon: Briefcase, tile: TINTS.teal },
  Interest: { icon: PiggyBank, tile: TINTS.emerald },
  Dividend: { icon: Coins, tile: TINTS.iris },
  Refund: { icon: RefreshCcw, tile: TINTS.sky },
  Gift: { icon: Gift, tile: TINTS.rose },
};

export function categoryVisual(category: string, income = false): Visual {
  return CATEGORY[category] ?? { icon: income ? Banknote : Wallet, tile: income ? TINTS.emerald : TINTS.slate };
}

const ASSET: Record<AssetType, Visual> = {
  MUTUAL_FUND: { icon: PiggyBank, tile: TINTS.iris },
  STOCK: { icon: TrendingUp, tile: TINTS.emerald },
  ETF: { icon: LineChart, tile: TINTS.sky },
  BOND: { icon: Landmark, tile: TINTS.indigo },
  GOLD: { icon: Gem, tile: TINTS.amber },
  FD: { icon: BadgeIndianRupee, tile: TINTS.teal },
  OTHER: { icon: Sparkles, tile: TINTS.slate },
};

export function assetVisual(type: AssetType): Visual {
  return ASSET[type];
}

const CALENDAR: Record<'EMI' | 'SIP' | 'BILL' | 'INCOME', Visual> = {
  EMI: { icon: Car, tile: TINTS.indigo },
  SIP: { icon: Repeat, tile: TINTS.iris },
  BILL: { icon: Receipt, tile: TINTS.rose },
  INCOME: { icon: Banknote, tile: TINTS.emerald },
};

export function calendarVisual(kind: 'EMI' | 'SIP' | 'BILL' | 'INCOME'): Visual {
  return CALENDAR[kind];
}

/** Row icon helper: `<Row {...rowIcon(v)} />` fills the icon and its tile. */
export function rowIcon(v: Visual, size = 19): { icon: React.ReactNode; iconClassName: string } {
  const Icon = v.icon;
  return { icon: <Icon size={size} strokeWidth={2.1} />, iconClassName: v.tile };
}
