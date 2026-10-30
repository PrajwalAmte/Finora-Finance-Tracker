import { BiometricAuth, BiometryType } from '@aparajita/capacitor-biometric-auth';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { Capacitor } from '@capacitor/core';

/**
 * Biometric unlock. The vault's data key is copied into the Keychain (iOS) / Keystore-backed
 * storage (Android) and only read after a successful biometric prompt.
 */
const KEY_NAME = 'finora.dataKey';

export async function biometryAvailable(): Promise<{ available: boolean; label: string }> {
  if (!Capacitor.isNativePlatform()) return { available: false, label: 'Biometrics' };
  try {
    const res = await BiometricAuth.checkBiometry();
    const labels: Record<number, string> = {
      [BiometryType.touchId]: 'Touch ID',
      [BiometryType.faceId]: 'Face ID',
      [BiometryType.fingerprintAuthentication]: 'Fingerprint',
      [BiometryType.faceAuthentication]: 'Face unlock',
      [BiometryType.irisAuthentication]: 'Iris unlock',
    };
    return { available: res.isAvailable, label: labels[res.biometryType] ?? 'Biometrics' };
  } catch {
    return { available: false, label: 'Biometrics' };
  }
}

export async function promptBiometric(reason: string): Promise<boolean> {
  try {
    await BiometricAuth.authenticate({ reason, cancelTitle: 'Use passphrase', allowDeviceCredential: false, androidTitle: 'Unlock Finora', androidSubtitle: reason });
    return true;
  } catch {
    return false;
  }
}

export async function storeDataKey(b64: string): Promise<void> {
  await SecureStorage.set(KEY_NAME, b64, false, false);
}

export async function loadDataKey(): Promise<string | null> {
  const v = await SecureStorage.get(KEY_NAME, false, false);
  return typeof v === 'string' ? v : null;
}

export async function clearDataKey(): Promise<void> {
  try {
    await SecureStorage.remove(KEY_NAME, false);
  } catch {
    // Nothing stored.
  }
}
