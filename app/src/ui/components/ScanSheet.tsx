import React, { useState } from 'react';
import { ImageUp, ScanText } from 'lucide-react';
import { Button } from './Button';
import { Sheet } from './kit';
import { EntrySheet, type EntryDraft } from './EntrySheet';
import { pickImage } from '../../platform/device';
import { recognizeText } from '../../platform/capture';
import { parsePaymentScreenshot } from '../../capture/textParsers';
import { live } from '../../domain/records';
import { useData } from '../vault';
import { toast } from '../toast';

/** Payment screenshot → expense. Text recognition runs on the phone (ML Kit / Apple Vision). */
export const ScanSheet: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const data = useData();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<EntryDraft | null>(null);

  const scan = async () => {
    setBusy(true);
    try {
      const img = await pickImage();
      if (!img) return;
      const text = await recognizeText(img.bytes);
      const t = parsePaymentScreenshot(text);
      if (!t) {
        toast.error('Could not find a completed payment in that image');
        return;
      }
      if (live(data.entries).some(e => e.sourceRef === t.sourceRef)) {
        toast.info('This payment is already in your expenses');
        return;
      }
      setDraft({ kind: t.kind, amount: t.amount, date: t.date, description: t.merchant, merchant: t.merchant, paymentMethod: t.paymentMethod, source: 'OCR', sourceRef: t.sourceRef });
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet open={open} onClose={onClose} title="Scan a payment">
        <div className="text-center py-4">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-primary-50 dark:bg-primary-950 text-primary-600 flex items-center justify-center mb-3"><ScanText size={30} /></div>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 max-w-xs mx-auto">
            Pick a screenshot of a GPay, PhonePe, Paytm or bank payment. Finora reads the amount, payee and date on this phone; the image is never uploaded.
          </p>
        </div>
        <Button size="lg" fullWidth iconLeft={<ImageUp size={18} />} isLoading={busy} onClick={scan}>Choose screenshot</Button>
      </Sheet>
      <EntrySheet open={!!draft} onClose={() => setDraft(null)} draft={draft ?? undefined} />
    </>
  );
};
