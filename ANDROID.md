# RRD Group HRMS: Android app (APK)

## One-time setup (Windows)
1. Install **Android Studio** (developer.android.com/studio). On first launch let it install the Android SDK.
2. In `frontend/`:
   ```
   npm install
   npm install @capacitor/filesystem@8 @capacitor/share@8
   npm run android:setup
   ```
   (creates the `android/` project, adds location permission, generates the app icon and splash from `assets/`)

## Every time you want a new APK
```
cd frontend
npm run android:build      # builds the web app with .env.production and copies it into android/
npm run android:open       # opens Android Studio
```
In Android Studio: **Build → Build App Bundle(s) / APK(s) → Build APK(s)**.
The APK is saved in `frontend/android/app/build/outputs/apk/debug/app-debug.apk`.

Copy it to a phone (WhatsApp/Drive/USB), open it and allow "Install unknown apps".

## Notes
- The app uses the backend in `.env.production` (`https://hrms-backend-v3.onrender.com`). It must be live
  and connected to the cloud database, since phones cannot reach `localhost`.
- To share with staff long-term, build a **signed release** APK: Build → Generate Signed App Bundle / APK → APK,
  create a keystore and keep it safe (every future update must be signed with the same key).
- Bump `versionCode` / `versionName` in `android/app/build.gradle` for each release you share.
