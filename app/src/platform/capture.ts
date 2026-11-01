import { Capacitor, registerPlugin } from '@capacitor/core';
import { Ocr } from '@capacitor-community/image-to-text';
import { toB64 } from '../vault/crypto';

interface TextRecognizerPlugin {
  recognize(options: { base64: string }): Promise<{ lines: { text: string; x: number; y: number; width: number; height: number; confidence: number }[] }>;
}

/** App-local Swift plugin in ios/App/App/TextRecognizerPlugin.swift (Apple Vision). */
const TextRecognizer = registerPlugin<TextRecognizerPlugin>('TextRecognizer');

/**
 * On-device text recognition: Apple Vision on iOS, ML Kit on Android. The image never leaves the
 * phone. Returns lines top-to-bottom, left-to-right, so "Paid to" sits above the payee name.
 */
export async function recognizeText(image: Uint8Array): Promise<string> {
  const platform = Capacitor.getPlatform();
  if (platform === 'ios') {
    const res = await TextRecognizer.recognize({ base64: toB64(image) });
    return res.lines.map(l => l.text).join('\n');
  }
  if (platform === 'android') {
    const res = await Ocr.detectText({ base64: toB64(image) });
    return res.textDetections
      .slice()
      .sort((a, b) => a.topLeft[1] - b.topLeft[1] || a.topLeft[0] - b.topLeft[0])
      .map(d => d.text)
      .join('\n');
  }
  throw new Error('Screenshot scanning needs the Android or iOS app');
}

export interface SmsMessage {
  id: string;
  address: string;
  body: string;
  date: number;
}

interface SmsReaderPlugin {
  checkPermission(): Promise<{ granted: boolean }>;
  requestPermission(): Promise<{ granted: boolean }>;
  /** Inbox messages received after `since` (epoch ms), newest first, at most `limit`. */
  read(options: { since: number; limit: number }): Promise<{ messages: SmsMessage[] }>;
}

/** Custom Android plugin in android/app/src/main/java/app/finora/mobile/SmsReaderPlugin.java. iOS has no SMS access. */
const SmsReader = registerPlugin<SmsReaderPlugin>('SmsReader');

export function smsSupported(): boolean {
  return Capacitor.getPlatform() === 'android';
}

export async function requestSmsPermission(): Promise<boolean> {
  if (!smsSupported()) return false;
  const current = await SmsReader.checkPermission();
  if (current.granted) return true;
  return (await SmsReader.requestPermission()).granted;
}

export async function readSms(since: number, limit = 500): Promise<SmsMessage[]> {
  if (!smsSupported()) return [];
  const res = await SmsReader.read({ since, limit });
  return res.messages;
}
