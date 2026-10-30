import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from './Button';
import { AmountField, DateField, SelectField, Sheet, TextField } from './kit';
import { D, dec, price, units as toUnits } from '../../domain/money';
import { today } from '../../domain/dates';
import { create, live, touch } from '../../domain/records';
import { tradeFields } from '../../domain/portfolio';
import type { AssetType, Holding, TaxClass, Txn } from '../../domain/types';
import { navIndex } from '../../market/prices';
import { searchSchemes, type Scheme } from '../../market/amfi';
import { useData, useStore } from '../vault';
import { toast } from '../toast';
import { SELF_OWNER_ID } from '../../vault/schema';

const TYPES: { value: AssetType; label: string }[] = [
  { value: 'MUTUAL_FUND', label: 'Mutual fund' }, { value: 'STOCK', label: 'Stock' }, { value: 'ETF', label: 'ETF' },
  { value: 'BOND', label: 'Bond' }, { value: 'GOLD', label: 'Gold / SGB' }, { value: 'FD', label: 'Fixed deposit' }, { value: 'OTHER', label: 'Other' },
];

const TAX: { value: TaxClass; label: string }[] = [
  { value: 'EQUITY', label: 'Equity (stocks, equity funds)' }, { value: 'DEBT', label: 'Debt (debt funds, bonds)' }, { value: 'OTHER', label: 'Other (gold, international)' },
];

const defaultTax = (t: AssetType): TaxClass => (t === 'BOND' || t === 'FD' ? 'DEBT' : t === 'GOLD' || t === 'OTHER' ? 'OTHER' : 'EQUITY');

/** Add a holding with its first purchase, or edit an existing holding's details. */
export const HoldingSheet: React.FC<{ open: boolean; onClose: () => void; holding?: Holding }> = ({ open, onClose, holding }) => {
  const data = useData();
  const store = useStore();
  const [type, setType] = useState<AssetType>('MUTUAL_FUND');
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [scheme, setScheme] = useState<Scheme | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Scheme[]>([]);
  const [taxClass, setTaxClass] = useState<TaxClass>('EQUITY');
  const [ownerId, setOwnerId] = useState(SELF_OWNER_ID);
  const [date, setDate] = useState(today());
  const [unitsIn, setUnits] = useState('');
  const [priceIn, setPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [currentPrice, setCurrentPrice] = useState('');
  const [nominee, setNominee] = useState('');
  const [fmv2018, setFmv] = useState('');
  const [folio, setFolio] = useState('');

  useEffect(() => {
    if (!open) return;
    setType(holding?.type ?? 'MUTUAL_FUND');
    setName(holding?.name ?? '');
    setSymbol(holding?.symbol ?? '');
    setTaxClass(holding?.taxClass ?? 'EQUITY');
    setOwnerId(holding?.ownerId ?? SELF_OWNER_ID);
    setCurrentPrice(holding?.currentPrice ?? '');
    setNominee(holding?.nominee ?? '');
    setFmv(holding?.fmv2018 ?? '');
    setFolio(holding?.folio ?? '');
    setScheme(null); setQuery(''); setResults([]); setUnits(''); setPrice(''); setAmount(''); setDate(today());
  }, [open, holding]);

  useEffect(() => {
    if (type !== 'MUTUAL_FUND' || query.trim().length < 3) { setResults([]); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      navIndex().then(l => { if (!cancelled) setResults(searchSchemes(l, query, 12)); }).catch(() => { if (!cancelled) setResults([]); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, type]);

  const pickScheme = (s: Scheme) => {
    setScheme(s);
    setName(s.name);
    setQuery('');
    setResults([]);
    setPrice(s.nav);
    setCurrentPrice(s.nav);
    if (/liquid|overnight|debt|gilt|bond|money market|duration|corporate/i.test(s.name)) setTaxClass('DEBT');
    else if (/gold|silver|international|global|nasdaq|fund of fund|fof/i.test(s.name)) setTaxClass('OTHER');
    else setTaxClass('EQUITY');
  };

  const trade = tradeFields({ units: unitsIn, price: priceIn, amount });
  const valid = name.trim().length > 1 && (holding || (trade.units.gt(0) && trade.price.gt(0)));

  const submit = () => {
    if (!valid) return;
    const fields: Partial<Holding> = {
      name: name.trim(), type, taxClass, ownerId,
      symbol: symbol.trim().toUpperCase() || undefined,
      // A new holding without a quote is valued at its purchase price until prices are refreshed.
      currentPrice: currentPrice ? price(currentPrice) : holding?.currentPrice,
      priceDate: currentPrice && currentPrice !== holding?.currentPrice ? (scheme?.date ?? today()) : holding?.priceDate,
      nominee: nominee.trim() || undefined, fmv2018: fmv2018 ? price(fmv2018) : undefined, folio: folio.trim() || undefined,
      ...(scheme ? { schemeCode: scheme.code, isin: scheme.isins[0], amc: scheme.amc } : {}),
    };
    if (holding) {
      store.update(d => ({ ...d, holdings: d.holdings.map(h => (h.id === holding.id ? touch(h, fields) : h)) }));
      toast.success('Saved');
    } else {
      const h = create<Holding>({ ...(fields as Omit<Holding, 'id' | 'createdAt' | 'updatedAt'>) });
      const t = create<Txn>({ holdingId: h.id, date, kind: 'BUY', units: toUnits(trade.units), price: price(trade.price), amount: dec(trade.amount), source: 'MANUAL' });
      store.update(d => ({ ...d, holdings: [...d.holdings, h], txns: [...d.txns, t] }));
      toast.success(`${h.name} added`);
    }
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={holding ? 'Edit holding' : 'Add investment'} footer={<Button size="lg" fullWidth disabled={!valid} onClick={submit}>Save</Button>}>
      <SelectField label="Type" value={type} onChange={v => { setType(v as AssetType); setTaxClass(defaultTax(v as AssetType)); }} options={TYPES} />
      {type === 'MUTUAL_FUND' && !holding && (
        <div>
          <TextField label="Find the fund" value={query} onChange={setQuery} placeholder="e.g. parag parikh flexi direct" hint={scheme ? `Selected: scheme ${scheme.code}, NAV ₹${scheme.nav} on ${scheme.date}` : 'Search uses AMFI’s daily NAV list (downloaded once a day).'} />
          {results.length > 0 && (
            <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800">
              {results.map(s => (
                <button key={s.code} onClick={() => pickScheme(s)} className="w-full text-left px-3 py-2 text-sm active:bg-neutral-100 dark:active:bg-neutral-800">
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-neutral-500">NAV ₹{s.nav} · {s.amc ?? `code ${s.code}`}</div>
                </button>
              ))}
            </div>
          )}
          {query.length >= 3 && results.length === 0 && <p className="text-xs text-neutral-500 mt-1 flex gap-1 items-center"><Search size={12} /> No match yet (or offline). You can type the name below.</p>}
        </div>
      )}
      <TextField label="Name" value={name} onChange={setName} />
      {(type === 'STOCK' || type === 'ETF' || type === 'BOND' || type === 'GOLD') && (
        <TextField label="NSE/BSE symbol" value={symbol} onChange={setSymbol} placeholder="INFY, NIFTYBEES, 500325.BO" hint="Used to refresh the price. NSE is assumed unless you add .BO." autoCapitalize="characters" />
      )}
      {!holding && (
        <>
          <div className="text-sm font-semibold pt-2">First purchase</div>
          <DateField label="Date" value={date} onChange={setDate} max={today()} />
          <div className="grid grid-cols-2 gap-3">
            <AmountField label={type === 'MUTUAL_FUND' ? 'NAV paid' : 'Price per unit'} value={priceIn} onChange={setPrice} />
            <AmountField label="Units" value={unitsIn} onChange={setUnits} prefix="" />
          </div>
          <AmountField label="…or amount invested" value={amount} onChange={setAmount} hint={trade.units.gt(0) && !unitsIn ? `≈ ${trade.units.toDecimalPlaces(3).toString()} units` : undefined} />
        </>
      )}
      {holding && <AmountField label="Current price / NAV" value={currentPrice} onChange={setCurrentPrice} />}
      <SelectField label="Taxed as" value={taxClass} onChange={v => setTaxClass(v as TaxClass)} options={TAX} />
      {live(data.owners).length > 1 && <SelectField label="Owner" value={ownerId} onChange={setOwnerId} options={live(data.owners).map(o => ({ value: o.id, label: o.name }))} />}
      <details className="text-sm">
        <summary className="text-primary-600 cursor-pointer">More details</summary>
        <div className="space-y-4 mt-3">
          <TextField label="Folio / demat account" value={folio} onChange={setFolio} />
          <TextField label="Nominee" value={nominee} onChange={setNominee} hint="Appears in your family emergency file." />
          {taxClass === 'EQUITY' && <AmountField label="Price on 31 Jan 2018 (for older purchases)" value={fmv2018} onChange={setFmv} hint="Grandfathering: gains before Feb 2018 are not taxed. Leave empty if bought later." />}
        </div>
      </details>
      {D(currentPrice).lt(0) && <p className="text-xs text-error-600">Price cannot be negative</p>}
    </Sheet>
  );
};
