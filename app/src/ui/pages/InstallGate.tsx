import React from 'react';
import { PlusSquare, Share, ShieldCheck } from 'lucide-react';

/**
 * Safari deletes a website's storage after 7 days without a visit, but web apps added to the Home
 * Screen are exempt and get their own storage. A vault created in a Safari tab could vanish, so on
 * iPhone/iPad the PWA only creates vaults once it has been installed.
 */
export const InstallGate: React.FC = () => (
  <div className="min-h-full flex flex-col px-6 max-w-md mx-auto" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 48px)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}>
    <img src="icons/icon-192.png" alt="" className="h-16 w-16 rounded-2xl mb-6" />
    <h1 className="text-2xl font-bold">Add Finora to your Home Screen</h1>
    <p className="text-neutral-500 dark:text-neutral-400 mt-2 text-sm">
      Your data stays encrypted on this iPhone. Safari can clear websites’ storage, so Finora only keeps a vault once it is installed as an app.
    </p>
    <ol className="mt-8 space-y-5 text-[15px]">
      <li className="flex gap-3 items-start">
        <span className="h-8 w-8 shrink-0 rounded-full bg-primary-600 text-white flex items-center justify-center font-semibold">1</span>
        <span>Tap <Share size={18} className="inline -mt-1 text-primary-600" aria-label="Share" /> <b>Share</b> in Safari’s toolbar.</span>
      </li>
      <li className="flex gap-3 items-start">
        <span className="h-8 w-8 shrink-0 rounded-full bg-primary-600 text-white flex items-center justify-center font-semibold">2</span>
        <span>Scroll and choose <PlusSquare size={18} className="inline -mt-1 text-primary-600" aria-hidden /> <b>Add to Home Screen</b>, then <b>Add</b>.</span>
      </li>
      <li className="flex gap-3 items-start">
        <span className="h-8 w-8 shrink-0 rounded-full bg-primary-600 text-white flex items-center justify-center font-semibold">3</span>
        <span>Open <b>Finora</b> from your Home Screen and create your vault there.</span>
      </li>
    </ol>
    <div className="mt-auto pt-8 flex gap-2 text-xs text-neutral-500">
      <ShieldCheck size={16} className="shrink-0 text-primary-600" />
      <span>Deleting the Home Screen app deletes its data, so export an encrypted backup from Settings regularly.</span>
    </div>
  </div>
);
