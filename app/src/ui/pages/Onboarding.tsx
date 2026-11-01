import React, { useEffect, useState } from 'react';
import { Check, Cloud, Copy, FileUp, Fingerprint, KeyRound, Lock, ShieldCheck, WifiOff } from 'lucide-react';
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
import { adoptFromCloud, cancelRestore, cloudSupported, connectCloud, useCloud } from '../cloud';
import { providerLabel, providers } from '../../cloud/providers';
import { stampDate } from '../../domain/dates';
import { day } from '../format';

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-full flex flex-col px-6 max-w-md mx-auto animate-rise" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 32px)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}>
    {children}
  </div>
);

/** App mark. */
export const Logo: React.FC<{ size?: number }> = ({ size = 64 }) => (
  <div className="relative" style={{ width: size, height: size }}>
    <img src="icons/icon-192.png" alt="" className="relative rounded-[22%]" style={{ width: size, height: size }} />
  </div>
);

const StepTitle: React.FC<{ eyebrow: string; title: string; body?: React.ReactNode }> = ({ eyebrow, title, body }) => (
  <>
    <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary-600 dark:text-primary-300">{eyebrow}</div>
    <h1 className="font-display text-[28px] leading-tight font-extrabold tracking-[-0.02em] mt-1.5">{title}</h1>
    {body && <p className="text-neutral-500 dark:text-neutral-400 mt-2 text-sm leading-relaxed">{body}</p>}
  </>
);

type Step = 'welcome' | 'passphrase' | 'recovery' | 'biometric' | 'import';

/** Setting up a new device from the encrypted copy in Google Drive or Dropbox. */
const CloudRestore: React.FC<{ onCreateNew: () => void }> = ({ onCreateNew }) => {
  const { open } = useVault();
  const cloud = useCloud();
  const r = cloud.restore!;
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const where = `${providerLabel(r.provider)} (${r.account})`;

  const unlock = async () => {
    setBusy(true);
    setError('');
    try {
      open(await adoptFromCloud(pass, newId()));
    } catch (e) {
      setError(e instanceof WrongSecretError ? 'That passphrase does not open this vault' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <div className="flex-1">
        <div className="h-14 w-14 rounded-2xl bg-primary-50 text-primary-600 dark:bg-primary-500/15 dark:text-primary-300 flex items-center justify-center mb-6"><Cloud size={26} /></div>
        {r.checking ? (
          <StepTitle eyebrow="Cloud vault" title="Looking for your vault…" body={`Checking ${where}.`} />
        ) : r.error ? (
          <StepTitle eyebrow="Cloud vault" title="Could not reach your cloud" body={r.error} />
        ) : r.file ? (
          <>
            <StepTitle eyebrow="Cloud vault" title="Found your vault" body={<>In {where}, last saved {day(stampDate(r.file.updatedAt))}. Enter its passphrase to open it on this device.</>} />
            <form className="mt-6 space-y-4" onSubmit={e => { e.preventDefault(); unlock(); }}>
              <TextField label="Passphrase" type="password" value={pass} onChange={setPass} autoFocus autoComplete="current-password" error={error} />
              <Button type="submit" size="lg" fullWidth disabled={!pass} isLoading={busy}>Open vault</Button>
            </form>
          </>
        ) : (
          <StepTitle eyebrow="Cloud vault" title="No vault there yet" body={`${where} has no Finora vault. Create one now and it will be saved there automatically.`} />
        )}
      </div>
      {!r.checking && (
        <div className="space-y-2">
          {!r.file && <Button size="lg" fullWidth onClick={onCreateNew}>Create a new vault</Button>}
          <Button variant="ghost" fullWidth onClick={() => cancelRestore()}>Back</Button>
        </div>
      )}
    </Shell>
  );
};

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
  const cloud = useCloud();
  const cloudProviders = cloudSupported() ? providers().filter(p => p.available) : [];

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

  if (cloud.restore && step === 'welcome') {
    return <CloudRestore onCreateNew={() => setStep('passphrase')} />;
  }

  if (step === 'welcome') {
    return (
      <Shell>
        <div className="flex-1 flex flex-col justify-center">
          <Logo />
          <h1 className="font-display text-[40px] leading-[1.05] font-extrabold tracking-[-0.035em] mt-8">
            Your money.<br /><span className="text-primary-600">Only on your phone.</span>
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400 mt-3 text-[15px] leading-relaxed">Investments, SIPs, loans, spending and tax in one encrypted vault. No account, no server.</p>
          <ul className="mt-9 space-y-3">
            {[
              [ShieldCheck, 'Private by design', 'AES-256 encrypted on this device. Nobody else can read it, not even us.'],
              [WifiOff, 'Works offline', 'The internet is only used to fetch fund NAVs and stock prices.'],
              [FileUp, 'Import in seconds', 'CAMS, KFintech, CDSL, NSDL, broker and bank statements.'],
            ].map(([Icon, title, body], i) => {
              const I = Icon as typeof ShieldCheck;
              return (
                <li key={title as string} className="surface rounded-2xl p-3.5 flex gap-3.5 items-start animate-rise" style={{ animationDelay: `${120 + i * 80}ms` }}>
                  <span className="h-10 w-10 shrink-0 rounded-xl bg-primary-100 text-primary-700 dark:bg-primary-400/15 dark:text-primary-200 flex items-center justify-center"><I size={19} /></span>
                  <div><div className="font-semibold text-[15px]">{title as string}</div><div className="text-neutral-500 dark:text-neutral-400 text-[13px] leading-snug mt-0.5">{body as string}</div></div>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="space-y-3">
          <Button size="lg" fullWidth onClick={() => setStep('passphrase')}>Create my vault</Button>
          {cloudProviders.map(p => (
            <Button key={p.id} size="lg" variant="secondary" fullWidth iconLeft={<Cloud size={18} />} onClick={() => connectCloud(p.id, 'restore')}>Open my vault from {p.label}</Button>
          ))}
          <Button size="lg" variant="ghost" fullWidth onClick={() => setStep('import')}>I have a backup file</Button>
        </div>
      </Shell>
    );
  }

  if (step === 'import') {
    return (
      <Shell>
        <StepTitle eyebrow="Restore" title="Open a backup" body={<>Pick a <b>.finora</b> export from your other phone, or an <b>.enc</b> file from the old Finora web app.</>} />
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
        <StepTitle eyebrow="Step 1 of 2" title={initial ? 'Protect this phone’s copy' : 'Choose a passphrase'} body="It encrypts everything. A short sentence is easier to remember and harder to guess than a password." />
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
        <div className="h-12 w-12 rounded-2xl bg-primary-100 text-primary-700 dark:bg-primary-400/15 dark:text-primary-200 flex items-center justify-center mb-5"><KeyRound /></div>
        <StepTitle eyebrow="Step 2 of 2" title="Your recovery code" body="If you forget your passphrase, this code is the only way back in. It is shown once and never stored. Keep it on paper, not in a screenshot." />
        <div className="mt-6 grid grid-cols-3 gap-2 font-mono text-[15px] font-semibold text-center select-all">
          {groups.map((g, i) => <span key={i} className="surface py-2.5 rounded-xl tracking-[0.08em] animate-rise" style={{ animationDelay: `${i * 25}ms` }}>{g}</span>)}
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
        <div className="h-24 w-24 rounded-[30px] bg-primary-50 text-primary-600 dark:bg-primary-500/15 dark:text-primary-300 flex items-center justify-center mb-7 animate-pop-in"><Fingerprint size={46} /></div>
        <h1 className="font-display text-[28px] font-extrabold tracking-[-0.02em]">Unlock with {bio.label}?</h1>
        <p className="text-neutral-500 mt-2 text-sm max-w-xs">Your vault key is kept in this phone’s secure hardware and released only after {bio.label}. You can still use your passphrase.</p>
      </div>
      <div className="space-y-3">
        <Button size="lg" fullWidth iconLeft={<Check size={18} />} onClick={() => finish(true)}>Turn on {bio.label}</Button>
        <Button size="lg" variant="ghost" fullWidth iconLeft={<Lock size={18} />} onClick={() => finish(false)}>Use passphrase only</Button>
      </div>
    </Shell>
  );
};
