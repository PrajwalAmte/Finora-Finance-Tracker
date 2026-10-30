import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, FileSpreadsheet, HardDriveDownload, HeartHandshake, KeyRound, Lock, Moon, ShieldCheck, Trash2, Users, X } from 'lucide-react';
import { Button } from '../components/Button';
import { List, Panel, Row, Screen, Section, SelectField, Sheet, TextField, Toggle } from '../components/kit';
import { useData, usePositions, useStore, useVault } from '../vault';
import { create, live, touch } from '../../domain/records';
import type { Owner } from '../../domain/types';
import { session } from '../../vault/session';
import { biometryAvailable } from '../../platform/secure';
import { requestReminderPermission, shareFile } from '../../platform/device';
import { smsSupported } from '../../platform/capture';
import { capabilities, isNative, platform, storageStatus } from '../../platform/device';
import { useInstallPrompt } from '../install';
import { SmsShortcutGuide } from '../components/ForwardedSms';
import { CloudVaultSection } from '../components/CloudVault';
import { emergencyPdf, excelReport } from '../../reports/reports';
import { removeWithUndo, setSettings } from '../actions';
import { applyTheme } from '../theme';
import { toast } from '../toast';
import { strength } from '../labels';
import { stampDate, today } from '../../domain/dates';
import { day } from '../format';
import { SELF_OWNER_ID } from '../../vault/schema';

const RELATIONS: { value: Owner['relation']; label: string }[] = [
  { value: 'SPOUSE', label: 'Spouse' }, { value: 'PARENT', label: 'Parent' }, { value: 'CHILD', label: 'Child' }, { value: 'OTHER', label: 'Other' }, { value: 'SELF', label: 'Me' },
];

const OwnerSheet: React.FC<{ open: boolean; onClose: () => void; owner?: Owner }> = ({ open, onClose, owner }) => {
  const store = useStore();
  const data = useData();
  const [name, setName] = useState('');
  const [relation, setRelation] = useState<Owner['relation']>('SPOUSE');
  useEffect(() => { if (open) { setName(owner?.name ?? ''); setRelation(owner?.relation ?? 'SPOUSE'); } }, [open, owner]);
  const inUse = owner && (live(data.holdings).some(h => h.ownerId === owner.id) || live(data.loans).some(l => l.ownerId === owner.id));
  const submit = () => {
    store.update(d => ({ ...d, owners: owner ? d.owners.map(o => (o.id === owner.id ? touch(o, { name: name.trim(), relation }) : o)) : [...d.owners, create<Owner>({ name: name.trim(), relation })] }));
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title={owner ? 'Edit member' : 'Add family member'} footer={<div className="flex gap-2">
      {owner && owner.id !== SELF_OWNER_ID && <Button variant="ghost" className="text-error-600" disabled={!!inUse} onClick={() => { removeWithUndo(store, 'owners', owner.id, `${owner.name} removed`); onClose(); }}>Remove</Button>}
      <Button size="lg" className="flex-1" disabled={!name.trim()} onClick={submit}>Save</Button>
    </div>}>
      <TextField label="Name" value={name} onChange={setName} autoFocus />
      {owner?.id !== SELF_OWNER_ID && <SelectField label="Relation" value={relation} onChange={v => setRelation(v as Owner['relation'])} options={RELATIONS.filter(r => r.value !== 'SELF')} />}
      {inUse && <p className="text-xs text-neutral-500">Move or delete their holdings and loans before removing them.</p>}
      <p className="text-xs text-neutral-500">Import each member’s own CAS and pick their name when importing. Their holdings stay separate and add up in the Family view.</p>
    </Sheet>
  );
};

const ListEditor: React.FC<{ open: boolean; onClose: () => void; title: string; items: string[]; onSave: (items: string[]) => void }> = ({ open, onClose, title, items, onSave }) => {
  const [list, setList] = useState(items);
  const [value, setValue] = useState('');
  useEffect(() => { if (open) setList(items); }, [open, items]);
  return (
    <Sheet open={open} onClose={onClose} title={title} footer={<Button size="lg" fullWidth onClick={() => { onSave(list); onClose(); }}>Save</Button>}>
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); const v = value.trim(); if (v && !list.includes(v)) setList([...list, v]); setValue(''); }}>
        <input value={value} onChange={e => setValue(e.target.value)} placeholder="Add new" className="flex-1 h-11 px-3 rounded-xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-700 text-[16px]" />
        <Button type="submit">Add</Button>
      </form>
      <div className="flex flex-wrap gap-2">
        {list.map(c => (
          <span key={c} className="inline-flex items-center gap-1 h-8 pl-3 pr-1 rounded-full bg-neutral-100 dark:bg-neutral-800 text-sm">
            {c}<button aria-label={`Remove ${c}`} className="p-1" onClick={() => setList(list.filter(x => x !== c))}><X size={14} /></button>
          </span>
        ))}
      </div>
    </Sheet>
  );
};

export default function SettingsPage() {
  const data = useData();
  const store = useStore();
  const positions = usePositions();
  const { lock, reset } = useVault();
  const navigate = useNavigate();
  const s = data.settings;
  const [owner, setOwner] = useState<{ owner?: Owner } | null>(null);
  const [bio, setBio] = useState<{ available: boolean; label: string }>({ available: false, label: 'Biometrics' });
  const [passSheet, setPassSheet] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [newCode, setNewCode] = useState<string | null>(null);
  const [editor, setEditor] = useState<'categories' | 'income' | 'methods' | null>(null);
  const [emergency, setEmergency] = useState(false);
  const [notes, setNotes] = useState(s.emergencyNotes ?? '');
  const [pdfPass, setPdfPass] = useState('');
  const [erase, setErase] = useState(false);
  const [eraseText, setEraseText] = useState('');
  const [smsGuide, setSmsGuide] = useState(false);
  const [storage, setStorage] = useState<{ persisted: boolean; usage?: number } | null>(null);
  const install = useInstallPrompt();
  useEffect(() => { if (!isNative()) storageStatus().then(setStorage); }, []);

  useEffect(() => { biometryAvailable().then(setBio); }, []);

  const toggleBio = async (on: boolean) => {
    if (on) {
      if (await session.enableBiometric()) setSettings(store, { biometricEnabled: true });
    } else {
      await session.disableBiometric();
      setSettings(store, { biometricEnabled: false });
    }
  };

  const changePass = async () => {
    try {
      await session.changePassphrase(current, next);
      toast.success('Passphrase changed');
      setPassSheet(false); setCurrent(''); setNext('');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const exportExcel = async () => {
    await shareFile(`finora-${today()}.xlsx`, excelReport(data, positions), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Finora report');
  };

  const exportEmergency = async () => {
    setSettings(store, { emergencyNotes: notes });
    const pdf = await emergencyPdf({ ...data, settings: { ...data.settings, emergencyNotes: notes } }, positions, pdfPass || undefined);
    await shareFile(`family-emergency-file-${today()}.pdf`, pdf, 'application/pdf', 'Family emergency file');
  };

  return (
    <Screen title="Settings" back>
      <Section title="Family">
        <List>
          {live(data.owners).map(o => <Row key={o.id} icon={<Users size={18} />} title={o.name} subtitle={RELATIONS.find(r => r.value === o.relation)?.label} onClick={() => setOwner({ owner: o })} chevron />)}
          <Row title={<span className="text-primary-600">Add family member</span>} onClick={() => setOwner({})} />
        </List>
      </Section>

      <Section title="Security">
        <List>
          {bio.available && <Toggle checked={s.biometricEnabled} onChange={toggleBio} label={`Unlock with ${bio.label}`} />}
          <div className="px-4 py-3">
            <SelectField label="Lock automatically" value={String(s.autoLockMinutes)} onChange={v => setSettings(store, { autoLockMinutes: Number(v) })}
              options={[{ value: '0', label: 'Immediately when I leave' }, { value: '1', label: 'After 1 minute' }, { value: '2', label: 'After 2 minutes' }, { value: '5', label: 'After 5 minutes' }, { value: '15', label: 'After 15 minutes' }]} />
          </div>
          <Row icon={<KeyRound size={18} />} title="Change passphrase" onClick={() => setPassSheet(true)} chevron />
          <Row icon={<ShieldCheck size={18} />} title="New recovery code" subtitle="The old code stops working" onClick={async () => setNewCode(await session.regenerateRecoveryCode())} chevron />
          <Row icon={<Lock size={18} />} title="Lock now" onClick={lock} />
        </List>
      </Section>

      <CloudVaultSection />

      <Section title="Your data">
        <List>
          <Row icon={<HardDriveDownload size={18} />} title="Backup and sync" subtitle={s.lastExportAt ? `Last export ${day(stampDate(s.lastExportAt))}` : 'Never exported'} onClick={() => navigate('/settings/backup')} chevron />
          <Row icon={<FileSpreadsheet size={18} />} title="Export Excel report" subtitle="Holdings, transactions, spending, loans" onClick={exportExcel} chevron />
          <Row icon={<HeartHandshake size={18} />} title="Family emergency file" subtitle="Every folio, loan and nominee in one PDF" onClick={() => setEmergency(true)} chevron />
        </List>
      </Section>

      <Section title="Spending">
        <List>
          <Row title="Expense categories" subtitle={`${s.categories.length} categories`} onClick={() => setEditor('categories')} chevron />
          <Row title="Income categories" onClick={() => setEditor('income')} chevron />
          <Row title="Payment methods" onClick={() => setEditor('methods')} chevron />
          <Row title="Learned merchants" subtitle={`${live(data.merchantRules).length} remembered. Forget all?`} onClick={() => {
            store.update(d => ({ ...d, merchantRules: d.merchantRules.map(r => (r.deletedAt ? r : touch(r, { deletedAt: new Date().toISOString() }))) }), 'Forgot merchants');
            toast.info('Merchant learning reset', { label: 'Undo', onClick: () => store.undo() });
          }} />
          {platform() === 'ios' && <Row title="Bank SMS with Shortcuts" subtitle="Forward bank messages to Finora automatically" onClick={() => setSmsGuide(true)} chevron />}
          {smsSupported() && <Toggle checked={s.smsCaptureEnabled} onChange={v => setSettings(store, { smsCaptureEnabled: v })} label="Read bank SMS" description="Finds transactions in bank and UPI messages on this phone when you tap From SMS. Messages are never stored." />}
        </List>
      </Section>

      <Section title="App">
        <List>
          <div className="px-4 py-3">
            <SelectField label="Theme" value={s.theme} onChange={v => { setSettings(store, { theme: v as typeof s.theme }); applyTheme(v as typeof s.theme); }}
              options={[{ value: 'system', label: 'Same as phone' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
          </div>
          {install && <Row icon={<HardDriveDownload size={18} />} title="Install Finora as an app" subtitle="Opens in its own window and works offline" onClick={() => install()} chevron />}
          {storage && (
            <Row title="Storage in this browser" subtitle={storage.persisted ? 'Kept: the browser will not clear it on its own' : 'May be cleared by the browser under storage pressure; export backups often'}
              trailing={storage.usage ? `${(storage.usage / 1e6).toFixed(1)} MB` : undefined} />
          )}
          {capabilities().reminders && <Row icon={<Bell size={18} />} title="EMI and SIP reminders" subtitle="Notifications on the due date, generated on this phone" onClick={async () => toast.info((await requestReminderPermission()) ? 'Reminders are on' : 'Allow notifications in your phone settings')} chevron />}
          <Row icon={<Moon size={18} />} title="Hide amounts" subtitle="Same as the eye button" onClick={() => setSettings(store, { privacyMode: !s.privacyMode })} trailing={s.privacyMode ? 'On' : 'Off'} />
        </List>
      </Section>

      <Panel className="p-4 text-xs text-neutral-500 space-y-1">
        <p className="font-semibold text-neutral-700 dark:text-neutral-300">Privacy</p>
        <p>Finora has no account and no server. Your data is encrypted (AES-256) in this app’s private storage. The only network requests fetch public fund NAVs (AMFI) and stock prices (Yahoo Finance); nothing about you is sent.</p>
      </Panel>

      <Button variant="ghost" className="text-error-600" fullWidth iconLeft={<Trash2 size={18} />} onClick={() => setErase(true)}>Erase vault from this phone</Button>

      <SmsShortcutGuide open={smsGuide} onClose={() => setSmsGuide(false)} />
      <OwnerSheet open={!!owner} onClose={() => setOwner(null)} owner={owner?.owner} />
      <ListEditor open={editor === 'categories'} onClose={() => setEditor(null)} title="Expense categories" items={s.categories} onSave={v => setSettings(store, { categories: v })} />
      <ListEditor open={editor === 'income'} onClose={() => setEditor(null)} title="Income categories" items={s.incomeCategories} onSave={v => setSettings(store, { incomeCategories: v })} />
      <ListEditor open={editor === 'methods'} onClose={() => setEditor(null)} title="Payment methods" items={s.paymentMethods} onSave={v => setSettings(store, { paymentMethods: v })} />

      <Sheet open={passSheet} onClose={() => setPassSheet(false)} title="Change passphrase" footer={<Button size="lg" fullWidth disabled={!current || next.length < 8} onClick={changePass}>Change</Button>}>
        <TextField label="Current passphrase" type="password" value={current} onChange={setCurrent} autoComplete="current-password" />
        <TextField label="New passphrase" type="password" value={next} onChange={setNext} autoComplete="new-password" hint={next ? strength(next).label : 'At least 8 characters'} />
        <p className="text-xs text-neutral-500">Your recovery code and exported backups keep working. Exports use the passphrase you choose at export time.</p>
      </Sheet>

      <Sheet open={!!newCode} onClose={() => setNewCode(null)} title="Your new recovery code">
        <p className="text-sm text-neutral-500">Write it down now. It will not be shown again, and the previous code no longer works.</p>
        <div className="grid grid-cols-3 gap-2 font-mono text-center">{newCode?.split('-').map((g, i) => <span key={i} className="py-2 rounded-lg bg-neutral-100 dark:bg-neutral-800">{g}</span>)}</div>
      </Sheet>

      <Sheet open={emergency} onClose={() => setEmergency(false)} title="Family emergency file" footer={<Button size="lg" fullWidth onClick={exportEmergency}>Create PDF</Button>}>
        <p className="text-sm text-neutral-500">A PDF listing every investment (with folio, fund house and nominee), loan, SIP and regular payment, for the people who would need it. Add nominees on each holding.</p>
        <label className="block text-sm font-medium">Notes for your family
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={5} placeholder="Where documents are kept, who your CA is, insurance policies, locker details…" className="mt-1 block w-full p-3 rounded-xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-700 text-[16px]" />
        </label>
        <TextField label="PDF password (recommended)" type="password" value={pdfPass} onChange={setPdfPass} hint="Tell your family this password separately." />
      </Sheet>

      <Sheet open={erase} onClose={() => setErase(false)} title="Erase vault" footer={<Button variant="danger" size="lg" fullWidth disabled={eraseText !== 'ERASE'} onClick={reset}>Erase everything</Button>}>
        <p className="text-sm">This permanently deletes all Finora data on this phone. Only an exported backup can bring it back.</p>
        <TextField label="Type ERASE to confirm" value={eraseText} onChange={setEraseText} autoCapitalize="characters" />
      </Sheet>
    </Screen>
  );
}
