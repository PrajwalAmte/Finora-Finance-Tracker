import React, { useEffect, useState } from 'react';
import { Check, Copy, FileUp, Fingerprint, KeyRound, Lock, ShieldCheck, Sparkles, WifiOff } from 'lucide-react';
import { Button } from '../components/Button';
import { TextField } from '../components/kit';
import { session } from '../../vault/session';
import { biometryAvailable } from '../../platform/secure';
import { pickFile } from '../../platform/device';
import { newId } from '../../domain/records';
import type { VaultData } from '../../domain/types';
import { useVault } from '../vault';
import { toast } from '../toast';
import { cx } from '../format';
import { WrongSecretError } from '../../vault/crypto';
import { patchSettings } from '../actions';
import { strength } from '../labels';

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-full flex flex-col px-6 max-w-md mx-auto" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 32px)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}>
    {children}
  </div>
);

type Step = 'welcome' | 'passphrase' | 'recovery' | 'biometric' | 'import';

export const Onboarding: React.FC = () => {
  const { open } = useVault();
  const [step, setStep] = useState<Step>('welcome');
  const [name, setName] = useState('');
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState('');
  const [confirmTail, setConfirmTail] = useState('');
  const [data, setData] = useState<VaultData | null>(null);
  const [initial, setInitial] = useState<VaultData | undefined>();
  const [bio, setBio] = useState<{ available: boolean; label: string }>({ available: false, label: '' });
  const [importFile, setImportFile] = useState<Uint8Array<ArrayBuffer> | null>(null);
  const [importPass, setImportPass] = useState('');

  useEffect(() => { biometryAvailable().then(setBio); }, []);

  const st = strength(pass);
  const canCreate = pass.length >= 8 && pass === confirm && !busy;

  const create = async () => {
    setBusy(true);
    try {
      const res = await session.create(pass, name.trim() || 'Me', initial);
      setData(res.data);
      setRecovery(res.recoveryCode);
      setStep('recovery');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const finish = async (enableBio: boolean) => {
    if (!data) return;
    const on = enableBio && (await session.enableBiometric());
    open({ ...data, settings: patchSettings(data.settings, { biometricEnabled: on }) });
  };

  const readImport = async () => {
    if (!importFile) return;
    setBusy(true);
    try {
      const res = await session.readImport(importFile, importPass, newId());
      setInitial(res.data);
      setName(res.data.owners.find(o => o.relation === 'SELF')?.name ?? '');
      toast.success(res.format === 'v1' ? 'Old Finora file opened and upgraded' : 'Backup opened');
      setStep('passphrase');
    } catch (e) {
      toast.error(e instanceof WrongSecretError ? 'Wrong passphrase for this file' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (step === 'welcome') {
    return (
      <Shell>
        <div className="flex-1 flex flex-col justify-center">
          <div className="h-16 w-16 rounded-2xl bg-primary-600 text-white flex items-center justify-center mb-6"><Sparkles size={32} /></div>
          <h1 className="text-3xl font-bold leading-tight">Your whole financial life.<br />Only on your phone.</h1>
          <ul className="mt-8 space-y-4 text-[15px]">
            {[
              [ShieldCheck, 'No account, no server', 'Everything is encrypted on this device. Nobody else can see it, including us.'],
              [WifiOff, 'Works offline', 'The internet is used only to fetch fund NAVs and stock prices.'],
              [FileUp, 'Import in seconds', 'CAMS / KFintech / CDSL / NSDL statements, broker exports and bank statements.'],
            ].map(([Icon, title, body]) => {
              const I = Icon as typeof ShieldCheck;
              return (
                <li key={title as string} className="flex gap-3">
                  <I className="shrink-0 text-primary-600 mt-0.5" size={22} />
                  <div><div className="font-semibold">{title as string}</div><div className="text-neutral-500 dark:text-neutral-400 text-sm">{body as string}</div></div>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="space-y-3">
          <Button size="lg" fullWidth onClick={() => setStep('passphrase')}>Create my vault</Button>
          <Button size="lg" variant="ghost" fullWidth onClick={() => setStep('import')}>I have a Finora backup</Button>
        </div>
      </Shell>
    );
  }

  if (step === 'import') {
    return (
      <Shell>
        <h1 className="text-2xl font-bold">Restore from a backup</h1>
        <p className="text-neutral-500 mt-2 text-sm">Pick a <b>.finora</b> export from your other phone, or an <b>.enc</b> file from the old Finora web app.</p>
        <div className="mt-6 space-y-4 flex-1">
          <Button variant="outline" fullWidth iconLeft={<FileUp size={18} />} onClick={async () => {
            const f = await pickFile(['*/*']);
            if (f) { setImportFile(f.bytes); toast.info(`Selected ${f.name}`); }
          }}>{importFile ? 'Choose a different file' : 'Choose file'}</Button>
          <TextField label="Passphrase used for that file" type="password" value={importPass} onChange={setImportPass} autoComplete="off" />
        </div>
        <div className="space-y-3">
          <Button size="lg" fullWidth disabled={!importFile || !importPass} isLoading={busy} onClick={readImport}>Open backup</Button>
          <Button variant="ghost" fullWidth onClick={() => setStep('welcome')}>Back</Button>
        </div>
      </Shell>
    );
  }

  if (step === 'passphrase') {
    return (
      <Shell>
        <h1 className="text-2xl font-bold">{initial ? 'Protect this phone’s copy' : 'Set your vault passphrase'}</h1>
        <p className="text-neutral-500 mt-2 text-sm">It encrypts your data. A short sentence is easier to remember and harder to guess than a password.</p>
        <div className="mt-6 space-y-4 flex-1">
          {!initial && <TextField label="Your name" value={name} onChange={setName} placeholder="Shown on your portfolio" autoComplete="given-name" />}
          <TextField label="Passphrase" type="password" value={pass} onChange={setPass} autoComplete="new-password" placeholder="e.g. my dosa is always crispy" />
          {pass && (
            <div>
              <div className="flex gap-1">{[0, 1, 2].map(i => <span key={i} className={cx('h-1.5 flex-1 rounded-full', i < st.score ? ['bg-error-500', 'bg-warning-500', 'bg-success-500'][st.score - 1] : 'bg-neutral-200 dark:bg-neutral-800')} />)}</div>
              <p className="text-xs mt-1 text-neutral-500">{pass.length < 8 ? 'At least 8 characters' : st.label}</p>
            </div>
          )}
          <TextField label="Type it again" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" error={confirm && confirm !== pass ? 'Does not match' : undefined} />
        </div>
        <Button size="lg" fullWidth disabled={!canCreate} isLoading={busy} onClick={create}>Continue</Button>
      </Shell>
    );
  }

  if (step === 'recovery') {
    const groups = recovery.split('-');
    const tail = groups[groups.length - 1];
    return (
      <Shell>
        <div className="h-12 w-12 rounded-xl bg-warning-100 text-warning-700 dark:bg-warning-900 dark:text-warning-300 flex items-center justify-center mb-4"><KeyRound /></div>
        <h1 className="text-2xl font-bold">Write down your recovery code</h1>
        <p className="text-neutral-500 mt-2 text-sm">If you forget your passphrase, this code is the only way back in. It is shown once and never stored. Keep it on paper, not in a screenshot.</p>
        <div className="mt-5 grid grid-cols-3 gap-2 font-mono text-[15px] text-center select-all">
          {groups.map((g, i) => <span key={i} className="py-2 rounded-lg bg-neutral-100 dark:bg-neutral-900">{g}</span>)}
        </div>
        <button className="mt-3 text-sm text-primary-600 inline-flex items-center gap-1" onClick={() => navigator.clipboard?.writeText(recovery).then(() => toast.info('Copied. Paste it somewhere safe, then clear your clipboard.'))}>
          <Copy size={14} /> Copy
        </button>
        <div className="mt-6 flex-1">
          <TextField label={`To confirm, type the last group (${groups.length})`} value={confirmTail} onChange={v => setConfirmTail(v.toUpperCase())} autoCapitalize="characters" autoComplete="off" />
        </div>
        <Button size="lg" fullWidth disabled={confirmTail.replace(/\s/g, '') !== tail} onClick={() => (bio.available ? setStep('biometric') : finish(false))}>I’ve saved it</Button>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex-1 flex flex-col justify-center items-center text-center">
        <div className="h-20 w-20 rounded-full bg-primary-50 dark:bg-primary-950 text-primary-600 flex items-center justify-center mb-6"><Fingerprint size={40} /></div>
        <h1 className="text-2xl font-bold">Unlock with {bio.label}?</h1>
        <p className="text-neutral-500 mt-2 text-sm max-w-xs">Your vault key is kept in this phone’s secure hardware and released only after {bio.label}. You can still use your passphrase.</p>
      </div>
      <div className="space-y-3">
        <Button size="lg" fullWidth iconLeft={<Check size={18} />} onClick={() => finish(true)}>Turn on {bio.label}</Button>
        <Button size="lg" variant="ghost" fullWidth iconLeft={<Lock size={18} />} onClick={() => finish(false)}>Use passphrase only</Button>
      </div>
    </Shell>
  );
};
