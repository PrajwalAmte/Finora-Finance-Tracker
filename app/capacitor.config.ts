import type { CapacitorConfig } from '@capacitor/cli';
import type { KeyboardResize } from '@capacitor/keyboard';

/** Plugins used on both platforms. */
const shared = [
  '@aparajita/capacitor-biometric-auth',
  '@aparajita/capacitor-secure-storage',
  '@capacitor-community/privacy-screen',
  '@capacitor/app',
  '@capacitor/filesystem',
  '@capacitor/haptics',
  '@capacitor/keyboard',
  '@capacitor/local-notifications',
  '@capacitor/preferences',
  '@capacitor/share',
  '@capacitor/status-bar',
  '@capawesome/capacitor-file-picker',
];

const config: CapacitorConfig = {
  appId: 'app.finora.mobile',
  appName: 'Finora',
  webDir: 'dist',
  android: {
    // No http:// content; the WebView only loads the bundled app.
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
    // Text recognition on Android is ML Kit via image-to-text.
    includePlugins: [...shared, '@capacitor-community/image-to-text'],
  },
  ios: {
    contentInset: 'never',
    // Text recognition on iOS is Apple Vision in ios/App/App/TextRecognizerPlugin.swift, so the
    // image-to-text package (CocoaPods-only) is left out and the project stays on Swift Package Manager.
    includePlugins: shared,
  },
  plugins: {
    Keyboard: {
      // Shrink the web view when the keyboard opens, so bottom-sheet Save buttons stay visible.
      resize: 'native' as KeyboardResize,
      resizeOnFullScreen: true,
    },
    LocalNotifications: {
      iconColor: '#2563EB',
    },
  },
};

export default config;
