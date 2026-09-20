import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ftthcopilot.app',
  appName: 'FTTH-Copilot',
  // Use the standalone Next.js build output. The webDir path is relative
  // to apps/web/. Capacitor copies this into android/app/src/main/assets/public.
  webDir: '.next',
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: true,
  },
  server: {
    // Allow navigation to the configured backend. Defaults to demo if unset.
    // Override at build time via NEXT_PUBLIC_API_URL env var.
    url: process.env['NEXT_PUBLIC_API_URL'] || 'https://demo.ftth-copilot.com',
    cleartext: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: '#1a1218',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    StatusBar: {
      backgroundColor: '#1a1218',
      style: 'DARK',
      overlaysWebView: false,
    },
  },
};

export default config;
