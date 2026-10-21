import type { CapacitorConfig } from '@capacitor/cli';

// The app shows the live website, so every website deploy (Vercel) reaches phones at once:
// no new APK is needed for screen or feature changes. A new APK is only needed when
// native parts change (app icon, permissions, Capacitor plugins).
// To go back to the bundled build, delete the `server` block and rebuild the APK.
const LIVE_URL = 'https://hrms.ramreddydevelopers.com';ss

const config: CapacitorConfig = {
  appId: 'com.rrdgroup.hrms',
  appName: 'RRD Group HRMS',
  webDir: 'build',
  server: {
    url: LIVE_URL,
    cleartext: false,
    // Shown when the phone is offline or the site cannot be reached (file is in public/)
    errorPath: 'offline.html',
  },
  android: {
    // The app talks only to HTTPS (Vercel website, Render backend)
    allowMixedContent: false,
  },
};

export default config;
