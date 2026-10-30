import React, { useState } from 'react';
import { AlertTriangle, Check, Cloud, CloudOff, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from './Button';
import { IconButton, List, Panel, Row, Sheet } from './kit';
import { providers } from '../../cloud/providers';
import type { ProviderId } from '../../cloud/types';
import { cloudSupported, connectCloud, describeCloud, disconnectCloud, replaceCloudWithLocal, syncNow, useCloud } from '../cloud';
import { stampDate } from '../../domain/dates';
import { cx, day } from '../format';
import { toast } from '../toast';

const BRAND: Record<ProviderId, string> = {
  gdrive: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300',
  dropbox: 'bg-blue-50 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300',
};

function since(stamp?: string): string {
  if (!stamp) return 'not yet';
  const mins = Math.round((Date.now() - new Date(stamp).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return day(stampDate(stamp), 'dd MMM');
}

/** Settings → Cloud vault (PWA only). */
export const CloudVaultSection: React.FC = () => {
  const cloud = useCloud();
  const [busy, setBusy] = useState(false);
  if (!cloudSupported()) return null;
  const available = providers().filter(p => p.available);
  const c = cloud.connection;

  return (
    <Panel className="p-5">
      <div className="flex items-start gap-3.5">
        <div className="h-11 w-11 shrink-0 rounded-2xl bg-primary-50 text-primary-600 dark:bg-primary-500/15 dark:text-primary-300 flex items-center justify-center"><Cloud size={20} /></div>
        <div className="flex-1 min-w-0">
          <div className="font-display text-[17px] font-extrabold">Cloud vault</div>
          <p className="text-[12.5px] text-neutral-500 dark:text-neutral-400 mt-0.5 leading-relaxed">
            Keep an encrypted copy in your own Google Drive or Dropbox. It survives a deleted app and keeps your devices in sync. The provider only ever sees scrambled data.
          </p>
        </div>
      </div>

      {c ? (
        <div className="mt-4 space-y-3">
          <div className="rounded-2xl bg-neutral-100 dark:bg-white/[0.05] p-3.5 flex items-center gap-3">
            <div className={cx('h-9 w-9 rounded-xl flex items-center justify-center', BRAND[c.provider])}><Cloud size={17} /></div>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-semibold truncate">{describeCloud(c)}</div>
              <div className="text-[12px] text-neutral-500 dark:text-neutral-400">
                {cloud.status === 'syncing' ? 'Syncing…' : cloud.status === 'error' || cloud.status === 'auth' ? cloud.error : `Synced ${since(c.lastSyncAt)}`}
              </div>
            </div>
            <SyncBadge />
          </div>
          {cloud.status === 'auth' && (
            <Button fullWidth onClick={() => connectCloud(c.provider)}>Sign in again</Button>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="sm" iconLeft={<RefreshCw size={15} />} isLoading={cloud.status === 'syncing'} onClick={() => syncNow()}>Sync now</Button>
            <Button variant="ghost" size="sm" className="text-error-500" isLoading={busy} onClick={async () => {
              setBusy(true);
              await disconnectCloud();
              setBusy(false);
              toast.info('Unlinked. The copy stays in your cloud until you delete it there.');
            }}>Unlink</Button>
          </div>
        </div>
      ) : available.length === 0 ? (
        <p className="mt-4 text-[12.5px] text-neutral-500 dark:text-neutral-400">Not set up on this site yet (see docs/PWA.md → Cloud vault).</p>
      ) : (
        <div className="mt-4 grid gap-2">
          {available.map(p => (
            <button key={p.id} onClick={() => connectCloud(p.id)} className="pressable w-full flex items-center gap-3 rounded-2xl p-3 ring-1 ring-inset ring-neutral-200 dark:ring-white/10 hover:bg-neutral-50 dark:hover:bg-white/[0.04]">
              <span className={cx('h-9 w-9 rounded-xl flex items-center justify-center', BRAND[p.id])}><Cloud size={17} /></span>
              <span className="flex-1 text-left text-[14px] font-semibold">Link {p.label}</span>
              <span className="text-[12px] text-neutral-500">Sign in</span>
            </button>
          ))}
          <div className="flex gap-2 text-[11.5px] text-neutral-500 dark:text-neutral-400 mt-1"><ShieldCheck size={14} className="shrink-0 mt-px" />Finora only gets access to its own file, not the rest of your files.</div>
        </div>
      )}
    </Panel>
  );
};

/** Small status mark for the header and the settings card. */
export const SyncBadge: React.FC<{ onClick?: () => void }> = ({ onClick }) => {
  const cloud = useCloud();
  if (!cloud.connection) return null;
  const icon = cloud.status === 'syncing' ? <Loader2 size={18} className="animate-spin" />
    : cloud.status === 'idle' ? <span className="relative"><Cloud size={19} /><Check size={10} strokeWidth={3.5} className="absolute -right-1 -bottom-0.5 text-success-500" /></span>
    : cloud.status === 'foreign' || cloud.status === 'auth' ? <AlertTriangle size={18} className="text-warning-500" />
    : <CloudOff size={18} className="text-error-400" />;
  const label = cloud.status === 'syncing' ? 'Syncing' : cloud.status === 'idle' ? 'Synced to cloud' : 'Cloud sync needs attention';
  return onClick ? <IconButton label={label} onClick={onClick}>{icon}</IconButton> : <span title={label} className="text-neutral-500 dark:text-neutral-300">{icon}</span>;
};

/** Blocking questions the sync engine cannot answer alone. Rendered once inside the unlocked app. */
export const CloudPrompts: React.FC = () => {
  const cloud = useCloud();
  const [dismissed, setDismissed] = useState(false);
  if (cloud.status !== 'foreign' || dismissed) return null;
  return (
    <Sheet open onClose={() => setDismissed(true)} title="A different vault is in your cloud" footer={
      <div className="grid gap-2">
        <Button size="lg" fullWidth onClick={() => replaceCloudWithLocal()}>Replace it with this device’s vault</Button>
        <Button variant="ghost" fullWidth onClick={async () => { await disconnectCloud(); setDismissed(true); }}>Keep it, unlink this device</Button>
      </div>
    }>
      <p className="text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed">
        {describeCloud(cloud.connection)} already has a Finora vault that was created with a different passphrase on another device, so it cannot be merged with this one.
      </p>
      <List>
        <Row title="Replace" subtitle="The cloud copy becomes this device’s vault. The other vault’s data in the cloud is overwritten." />
        <Row title="Keep" subtitle="To use that vault here instead, erase this one and choose “Open my vault from the cloud” when setting up." />
      </List>
    </Sheet>
  );
};
