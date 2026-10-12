#!/usr/bin/env node
/* Adds the Android permissions the HRMS app needs (run after `npx cap add android`; safe to re-run).
   • Location: attendance check-in uses GPS to confirm you are at the site.
   • Camera: the live photo of an ad-hoc field visit. */
const fs = require('fs');
const path = require('path');

const manifest = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (!fs.existsSync(manifest)) {
  console.error('✖ android/ not found. Run "npx cap add android" first.');
  process.exit(1);
}
const NEEDED = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.CAMERA',
];
const FEATURES = ['android.hardware.location.gps', 'android.hardware.camera'];
let xml = fs.readFileSync(manifest, 'utf8');
const missing = NEEDED.filter((p) => !xml.includes(`"${p}"`));
if (missing.length) {
  const lines = missing.map((p) => `    <uses-permission android:name="${p}" />`).join('\n');
  const features = FEATURES.filter((f) => !xml.includes(`"${f}"`))
    .map((f) => `    <uses-feature android:name="${f}" android:required="false" />`).join('\n');
  xml = xml.replace(/<\/manifest>\s*$/, `${lines}\n${features ? `${features}\n` : ''}</manifest>\n`);
  fs.writeFileSync(manifest, xml);
  console.log(`✔ Added: ${missing.join(', ')}`);
} else {
  console.log('✔ Permissions already present.');
}
