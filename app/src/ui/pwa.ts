import { registerSW } from 'virtual:pwa-register';
import { session } from '../vault/session';
import { toast } from './toast';

/**
 * Service worker for the PWA build. A new version waits until the user taps Update, so a reload
 * never interrupts typing; pending changes are flushed to storage before it reloads.
 */
export function registerPwa(): void {
  let prompted = false;
  const update = registerSW({
    onNeedRefresh() {
      // Fires again on every update check while the new worker waits; one prompt is enough.
      if (prompted) return;
      prompted = true;
      toast.sticky('A new version of Finora is ready', {
        label: 'Update',
        onClick: async () => {
          await session.flush().catch(() => {});
          await update(true);
        },
      });
    },
    onOfflineReady() {
      toast.success('Finora now works offline');
    },
  });
}
