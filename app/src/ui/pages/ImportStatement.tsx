import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckSquare, FileUp, Lock, Square } from 'lucide-react';
import { Button } from '../components/Button';
import { List, Money, Panel, Row, Screen, Section, SelectField, TextField } from '../components/kit';
import { pickFile } from '../../platform/device';
import { parseInvestmentStatement, ImportError, type ParsedHolding, type StatementPreview } from '../../importers';
import { applyStatement } from '../../importers/apply';
import { navIndex } from '../../market/prices';
import { D } from '../../domain/money';
import { live } from '../../domain/records';
import { useData, useStore } from '../vault';
import { toast } from '../toast';
import { day, qty } from '../format';
import { TYPE_LABEL } from '../labels';
import { SELF_OWNER_ID } from '../../vault/schema';

const TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv', 'text/comma-separated-values'];

export default function ImportStatementPage() {
  const data = useData();
  const store = useStore();
  const navigate = useNavigate();
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array<ArrayBuffer> } | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [ownerId, setOwnerId] = useState(SELF_OWNER_ID);

  const parse = async (bytes: Uint8Array, pass?: string) => {
    setBusy(true);
    try {
      const p = await parseInvestmentStatement(bytes, pass);
      setPreview(p);
      setSelected(new Set(p.holdings.map((_, i) => i)));
      setNeedsPassword(false);
    } catch (e) {
      if (e instanceof ImportError && (e.code === 'PASSWORD_NEEDED' || e.code === 'PASSWORD_WRONG')) {
        setNeedsPassword(true);
        if (e.code === 'PASSWORD_WRONG') toast.error('That password did not open the file');
      } else {
        toast.error((e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  const choose = async () => {
    const f = await pickFile(TYPES);
    if (!f) return;
    setFile(f);
    setPreview(null);
    setPassword('');
    await parse(f.bytes);
  };

  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      // Best effort: AMFI lookup gives scheme codes (for daily NAVs) and fund house names.
      const nav = await navIndex().catch(() => undefined);
      const chosen: ParsedHolding[] = preview.holdings.filter((_, i) => selected.has(i));
      const res = applyStatement(store.get(), preview, chosen, { ownerId, nav });
      store.update(() => res.data, 'Statement import');
      const parts = [`${res.holdingsAdded} new`, `${res.holdingsUpdated} updated`, `${res.txnsAdded} transactions`];
      if (res.estimatesReplaced) parts.push(`${res.estimatesReplaced} estimates corrected`);
      if (res.sipsCreated) parts.push(`${res.sipsCreated} SIPs found`);
      toast.success(`Imported: ${parts.join(', ')}`, { label: 'Undo', onClick: () => store.undo() });
      navigate('/invest', { replace: true });
    } finally {
      setBusy(false);
    }
  };

  const toggle = (i: number) => setSelected(s => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  return (
    <Screen title="Import investments" back>
      {!preview && (
        <>
          <Panel className="p-4 text-sm space-y-3">
            <p className="font-semibold">Supported files, read entirely on this phone</p>
            <ul className="space-y-2 text-neutral-600 dark:text-neutral-400">
              <li><b>CAMS / KFintech consolidated statement (PDF)</b>: every mutual fund with full transaction history, for exact XIRR and tax. Request it from camsonline.com or kfintech.com (“detailed” statement). Password is what you set while requesting.</li>
              <li><b>CDSL / NSDL CAS (PDF)</b>: stocks, ETFs, bonds and demat MFs. The password is based on your PAN (sometimes with date of birth); the email that brought the statement says the exact format.</li>
              <li><b>Broker holdings export (Excel/CSV)</b>: Zerodha, Groww, Upstox, ICICI Direct, HDFC Sec, Angel One, 5paisa, Kotak and similar.</li>
            </ul>
          </Panel>
          <Button size="lg" fullWidth iconLeft={<FileUp size={18} />} isLoading={busy && !needsPassword} onClick={choose}>{file ? 'Choose a different file' : 'Choose file'}</Button>
          {needsPassword && file && (
            <Panel className="p-4 space-y-3">
              <div className="flex gap-2 items-center text-sm font-semibold"><Lock size={16} /> {file.name} is password protected</div>
              <form onSubmit={e => { e.preventDefault(); parse(file.bytes, password); }} className="space-y-3">
                <TextField label="PDF password" type="password" value={password} onChange={setPassword} autoFocus autoComplete="off" hint="Used only to open the file on this phone. It is not saved." />
                <Button type="submit" fullWidth isLoading={busy} disabled={!password}>Open</Button>
              </form>
            </Panel>
          )}
        </>
      )}

      {preview && (
        <>
          <Panel className="p-4 text-sm">
            <div className="font-semibold">{preview.source === 'CAS_MF' ? 'Mutual fund statement' : preview.source === 'CAS_DEMAT' ? 'Depository statement' : 'Broker holdings'}</div>
            <div className="text-neutral-500">{preview.holdings.length} holdings found{preview.statementDate ? ` · as of ${day(preview.statementDate)}` : ''}</div>
          </Panel>
          {live(data.owners).length > 1 && (
            <SelectField label="Whose statement is this?" value={ownerId} onChange={setOwnerId} options={live(data.owners).map(o => ({ value: o.id, label: o.name }))} hint="Family members’ holdings stay separate and add up in the Family view." />
          )}
          {preview.warnings.length > 0 && (
            <Panel className="p-4 text-xs text-warning-800 dark:text-warning-300 bg-warning-50 dark:bg-warning-950 border-warning-200 dark:border-warning-900 space-y-1">
              {preview.warnings.slice(0, 8).map((w, i) => <div key={i} className="flex gap-2"><AlertTriangle size={14} className="shrink-0 mt-0.5" />{w}</div>)}
            </Panel>
          )}
          <Section title="Choose what to import" action={<button className="text-sm text-primary-600" onClick={() => setSelected(selected.size === preview.holdings.length ? new Set() : new Set(preview.holdings.map((_, i) => i)))}>{selected.size === preview.holdings.length ? 'None' : 'All'}</button>}>
            <List>
              {preview.holdings.map((h, i) => (
                <Row
                  key={i} onClick={() => toggle(i)}
                  icon={selected.has(i) ? <CheckSquare className="text-primary-600" size={20} /> : <Square size={20} />}
                  title={h.name}
                  subtitle={[TYPE_LABEL[h.type], h.folio && `Folio ${h.folio}`, `${qty(h.units)} units`, h.transactions.length ? `${h.transactions.length} transactions` : null].filter(Boolean).join(' · ')}
                  trailing={h.price ? <Money value={D(h.units).times(D(h.price))} short /> : undefined}
                />
              ))}
            </List>
          </Section>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setPreview(null); setFile(null); }}>Cancel</Button>
            <Button className="flex-1" size="lg" disabled={selected.size === 0} isLoading={busy} onClick={confirm}>Import {selected.size}</Button>
          </div>
          <p className="text-xs text-neutral-500 px-1">Importing the same statement again is safe: matching transactions are skipped.</p>
        </>
      )}
    </Screen>
  );
}
