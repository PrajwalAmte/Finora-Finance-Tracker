import React, { useState } from 'react';
import { FileDown, FileUp, GitMerge, Replace } from 'lucide-react';
import { Button } from '../components/Button';
import { Panel, Screen, Section, TextField } from '../components/kit';
import { session } from '../../vault/session';
import { merge, replaceAll, type MergePreview } from '../../vault/merge';
import type { VaultData } from '../../domain/types';
import { nowStamp, today } from '../../domain/dates';
import { pickFile, shareFile } from '../../platform/device';
import { WrongSecretError } from '../../vault/crypto';
import { useData, useStore } from '../vault';
import { setSettings } from '../actions';
import { toast } from '../toast';
import { strength } from '../labels';

const LABELS: Record<string, string> = {
  owners: 'family members', holdings: 'holdings', txns: 'transactions', sips: 'SIPs', loans: 'loans', loanEvents: 'loan payments',
  entries: 'expenses & income', recurring: 'regular payments', goals: 'goals', merchantRules: 'learned merchants', snapshots: 'net-worth days',
};

/** Sync between phones is export here, import there. Import merges record by record. */
export default function BackupPage() {
  const data = useData();
  const store = useStore();
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array<ArrayBuffer> } | null>(null);
  const [importPass, setImportPass] = useState('');
  const [incoming, setIncoming] = useState<VaultData | null>(null);
  const [preview, setPreview] = useState<MergePreview | null>(null);

  const doExport = async () => {
    setBusy(true);
    try {
      await session.flush();
      const bytes = await session.exportFile(store.get(), pass);
      await shareFile(`finora-${today()}.finora`, bytes, 'application/octet-stream', 'Finora backup');
      setSettings(store, { lastExportAt: nowStamp() });
      toast.success('Backup ready. Save it to Drive, Files or send it to your other phone.');
      setPass(''); setConfirm('');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const open = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await session.readImport(file.bytes, importPass, data.meta.deviceId);
      setIncoming(res.data);
      setPreview(merge(store.get(), res.data));
    } catch (e) {
      toast.error(e instanceof WrongSecretError ? 'Wrong passphrase for this file' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const apply = (mode: 'merge' | 'replace') => {
    if (!incoming || !preview) return;
    const next = mode === 'merge' ? merge(store.get(), incoming).data : replaceAll(store.get(), incoming);
    store.update(() => next, mode === 'merge' ? 'Import' : 'Replace');
    toast.success(mode === 'merge' ? 'Merged' : 'Replaced with the backup', { label: 'Undo', onClick: () => store.undo() });
    setFile(null); setIncoming(null); setPreview(null); setImportPass('');
  };

  const t = preview?.totals;
  return (
    <Screen title="Backup and sync" back>
      <Panel className="p-4 text-sm text-neutral-600 dark:text-neutral-400">
        Your data lives only on this phone. Export an encrypted copy regularly. To use Finora on another phone, export here and import there; edits on both phones merge.
      </Panel>

      <Section title="Export">
        <Panel className="p-4 space-y-3">
          <TextField label="Passphrase for this file" type="password" value={pass} onChange={setPass} autoComplete="new-password" hint={pass ? strength(pass).label : 'Anyone with the file and this passphrase can read your data.'} />
          <TextField label="Type it again" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" error={confirm && confirm !== pass ? 'Does not match' : undefined} />
          <Button fullWidth size="lg" iconLeft={<FileDown size={18} />} disabled={pass.length < 8 || pass !== confirm} isLoading={busy && !file} onClick={doExport}>Export encrypted backup</Button>
        </Panel>
      </Section>

      <Section title="Import">
        <Panel className="p-4 space-y-3">
          {!preview ? (
            <>
              <Button variant="outline" fullWidth iconLeft={<FileUp size={18} />} onClick={async () => { const f = await pickFile(['*/*']); if (f) setFile(f); }}>{file ? file.name : 'Choose .finora or old .enc file'}</Button>
              {file && (
                <>
                  <TextField label="Its passphrase" type="password" value={importPass} onChange={setImportPass} autoComplete="off" />
                  <Button fullWidth isLoading={busy} disabled={!importPass} onClick={open}>Open</Button>
                </>
              )}
            </>
          ) : (
            <>
              <div className="text-sm">
                <div className="font-semibold">Merging will:</div>
                <ul className="mt-1 text-neutral-600 dark:text-neutral-400 space-y-0.5">
                  <li>add {t!.added} new records</li>
                  <li>update {t!.updated} with newer edits from the file</li>
                  <li>delete {t!.deleted} that were deleted on the other phone</li>
                  <li>keep {t!.keptLocal} where this phone has the newer edit</li>
                </ul>
                <div className="mt-2 text-xs text-neutral-500">
                  {Object.entries(preview.stats).filter(([, s]) => s.added + s.updated + s.deleted > 0).map(([k, s]) => `${LABELS[k] ?? k}: +${s.added} ~${s.updated} −${s.deleted}`).join(' · ') || 'Nothing changes.'}
                </div>
              </div>
              <Button fullWidth size="lg" iconLeft={<GitMerge size={18} />} onClick={() => apply('merge')}>Merge</Button>
              <Button fullWidth variant="ghost" className="text-error-600" iconLeft={<Replace size={18} />} onClick={() => apply('replace')}>Replace everything with the file</Button>
              <Button fullWidth variant="ghost" onClick={() => { setPreview(null); setIncoming(null); }}>Cancel</Button>
            </>
          )}
        </Panel>
      </Section>
    </Screen>
  );
}
