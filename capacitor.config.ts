import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.rrdgroup.hrms',
  appName: 'RRD Group HRMS',
  webDir: 'build',
  android: {
    // The app talks only to the HTTPS backend on Render
    allowMixedContent: false,
  },
};

export default config;
