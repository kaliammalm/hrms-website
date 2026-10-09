/* ==========================================================================
   Save a downloaded file (report, payslip) in the browser AND in the Android app.
   • Browser: normal download.
   • Android app (Capacitor): browsers' download links do nothing inside the app, so the
     file is written to the app's cache and Android's share sheet opens — the user can
     save it to Files/Drive or send it on WhatsApp/email.
   Needs (one time, in frontend/):  npm install @capacitor/filesystem@^8 @capacitor/share@^8
   ========================================================================== */
import { Capacitor } from '@capacitor/core';

const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

const safeName = (name) => String(name || 'download').replace(/[\\/:*?"<>|]+/g, '_');

export async function saveFile(blob, filename) {
  const name = safeName(filename);

  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);
    const data = await blobToBase64(blob);
    const written = await Filesystem.writeFile({ path: name, data, directory: Directory.Cache, recursive: true });
    await Share.share({ title: name, url: written.uri, dialogTitle: 'Save or share' });
    return;
  }

  const href = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => window.URL.revokeObjectURL(href), 1000);
}
