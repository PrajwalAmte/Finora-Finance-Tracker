import React, { useCallback, useEffect, useState } from 'react';
import { Fingerprint, Lock as LockIcon } from 'lucide-react';
import { Button } from '../components/Button';
import { TextField } from '../components/kit';
import { session } from '../../vault/session';
import { loadDataKey } from '../../platform/secure';
import { WrongSecretError } from '../../vault/crypto';
import { useVault } from '../vault';
import { Logo } from './Onboarding';
import { toast } from '../toast';

export const LockScreen: React.FC = () => {
  const { open, reset } = useVault();
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'passphrase' | 'recovery'>('passphrase');
  const [hasBio, setHasBio] = useState(false);
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);

  const tryBio = useCallback(async () => {
    try {
      const data = await session.unlockWithBiometric();
      if (data) open(data);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [open]);

  useEffect(() => {
    loadDataKey().then(k => {
      setHasBio(!!k);
      if (k) tryBio();
    }).catch(() => {});
  }, [tryBio]);

  const unlock = async () => {
    setBusy(true);
    setError('');
    try {
      const data = mode === 'passphrase' ? await session.unlockWithPassphrase(pass) : await session.unlockWithRecovery(pass);
      open(data);
    } catch (e) {
      setAttempts(a => a + 1);
      setError(e instanceof WrongSecretError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full flex flex-col px-6 max-w-md mx-auto animate-rise" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 72px)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}>
      <div className="flex-1">
        <div className="flex flex-col items-center text-center">
          <Logo size={76} />
          <div className="mt-7 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-primary-600 dark:text-primary-300"><LockIcon size={12} /> Vault locked</div>
          <h1 className="font-display text-[30px] font-extrabold tracking-[-0.02em] mt-1.5">Welcome back</h1>
          <p className="text-neutral-500 dark:text-neutral-400 text-sm mt-1">{mode === 'passphrase' ? 'Enter your passphrase to open your vault.' : 'Enter the 52-character recovery code you wrote down.'}</p>
        </div>
        {hasBio && mode === 'passphrase' && (
          <button onClick={tryBio} className="pressable mt-8 mx-auto flex flex-col items-center gap-2 text-[13px] font-semibold text-neutral-600 dark:text-neutral-300">
            <span className="h-[68px] w-[68px] rounded-[24px] bg-primary-50 text-primary-600 dark:bg-primary-500/15 dark:text-primary-300 flex items-center justify-center"><Fingerprint size={34} /></span>
            Use biometrics
          </button>
        )}
        <form className="mt-8 space-y-4" onSubmit={e => { e.preventDefault(); unlock(); }}>
          <TextField
            label={mode === 'passphrase' ? 'Passphrase' : 'Recovery code'}
            type={mode === 'passphrase' ? 'password' : 'text'}
            value={pass} onChange={setPass} autoFocus autoComplete="off" error={error}
            autoCapitalize={mode === 'recovery' ? 'characters' : 'off'}
          />
          <Button type="submit" size="lg" fullWidth disabled={!pass} isLoading={busy}>Unlock</Button>
        </form>
      </div>
      <div className="space-y-2 text-center">
        <button className="text-[13px] font-semibold text-primary-600" onClick={() => { setMode(m => (m === 'passphrase' ? 'recovery' : 'passphrase')); setPass(''); setError(''); }}>
          {mode === 'passphrase' ? 'Forgot passphrase? Use recovery code' : 'Use passphrase instead'}
        </button>
        {attempts >= 5 && (
          <button className="block mx-auto text-xs text-error-600" onClick={async () => {
            if (window.confirm('Erase the vault on this phone and start over? This cannot be undone unless you have an exported backup.')) await reset();
          }}>Erase this vault and start over</button>
        )}
      </div>
    </div>
  );
};
