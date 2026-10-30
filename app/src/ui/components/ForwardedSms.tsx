import React, { useCallback, useEffect, useState } from 'react';
import { Copy, MessageSquareText } from 'lucide-react';
import { Sheet } from './kit';
import { EntrySheet, type EntryDraft } from './EntrySheet';
import { nextCapture, onCapture, parseForwardedSms } from '../../capture/inbox';
import { live } from '../../domain/records';
import { useData } from '../vault';
import { toast } from '../toast';

/**
 * Shows each bank SMS forwarded by the iOS Shortcuts automation as a pre-filled expense. The user
 * saves it with one tap, so a message from anywhere else can never add an entry on its own.
 */
export const ForwardedSms: React.FC = () => {
  const data = useData();
  const [draft, setDraft] = useState<EntryDraft | null>(null);

  const showNext = useCallback(() => {
    for (let text = nextCapture(); text !== undefined; text = nextCapture()) {
      const t = parseForwardedSms(text);
      if (!t) {
        toast.info('That message did not look like a bank transaction');
        continue;
      }
      if (live(data.entries).some(e => e.sourceRef === t.sourceRef)) {
        toast.info('This transaction is already in your expenses');
        continue;
      }
      setDraft({ kind: t.kind, amount: t.amount, date: t.date, description: t.merchant, merchant: t.merchant, paymentMethod: t.paymentMethod, source: 'SMS', sourceRef: t.sourceRef });
      return;
    }
  }, [data.entries]);

  useEffect(() => {
    if (!draft) showNext();
    return onCapture(() => { if (!draft) showNext(); });
  }, [draft, showNext]);

  return <EntrySheet open={!!draft} onClose={() => setDraft(null)} draft={draft ?? undefined} />;
};

const STEPS = [
  'Open the Shortcuts app, go to Automation and tap + (New Automation).',
  'Choose Message. Under Message Contains type “debited”. Optionally pick your bank under Sender.',
  'Choose Run Immediately, tap Next, then New Blank Automation.',
  'Add the action URL Encode and set its input to Shortcut Input (the message).',
  'Add the action Open URLs. Paste the link below, then insert the URL Encoded Text variable right after “text=”.',
  'Tap Done. Repeat with “credited” and “spent” if your bank uses those words.',
];

/** iOS has no SMS access for apps; this walks the user through a Shortcuts automation instead. */
export const SmsShortcutGuide: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => (
  <Sheet open={open} onClose={onClose} title="Bank SMS on iPhone">
    <div className="flex gap-3 items-start text-sm text-neutral-600 dark:text-neutral-400">
      <MessageSquareText className="text-primary-600 shrink-0" size={22} />
      <p>iOS does not let apps read your messages. A Shortcuts automation can forward just your bank’s messages to Finora on this iPhone; you confirm each one before it is saved. Needs iOS 17 or later.</p>
    </div>
    <ol className="space-y-3 text-sm list-decimal pl-5">
      {STEPS.map(s => <li key={s}>{s}</li>)}
    </ol>
    <button
      className="w-full flex items-center justify-between gap-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 px-4 py-3 font-mono text-sm"
      onClick={() => navigator.clipboard?.writeText('finora://capture?text=').then(() => toast.success('Link copied'))}
    >
      finora://capture?text=
      <Copy size={16} className="text-primary-600" />
    </button>
    <p className="text-xs text-neutral-500">The message travels from Shortcuts straight into Finora on this phone. Nothing is sent anywhere else.</p>
  </Sheet>
);
