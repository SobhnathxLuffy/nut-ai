# Building the Nut AI APK locally (no EAS account required)

This guide produces `app-release.apk` entirely on your machine. The EAS cloud
path (`eas build -p android --profile preview`) also works and needs only an
Expo account — the repo is already configured for it (`eas.json` `preview`
profile builds an APK; `eas-build-post-install` builds the nutrition corpus).

## What the repo already provides

- `eas.json` — `preview` profile (internal distribution, `buildType: apk`)
- `plugins/withAndroidReleaseSigning.js` — wires a real upload keystore into
  the release buildType on every prebuild, reading credentials from OUTSIDE
  the repo (see below). Without credentials it falls back to the debug
  keystore so a fresh clone still builds.
- `app.config.ts` — `versionCode 1`, full adaptive icon set, `CAMERA`
  permission, no FCM (F-Droid friendly).

## One-time setup

1. JDK 17+ (`javac` must exist), Android SDK with:
   - `platform-tools`, `platforms;android-36`, `build-tools;36.0.0`
   - NDK 27.1.12297006, `cmake;3.22.1`
   (via `sdkmanager` — accept licenses)
2. Generate an upload keystore (back it up — it IS the app's update identity):

   ```
   keytool -genkeypair -v -storetype PKCS12 -keystore nut-ai-release.keystore \
     -alias nut-ai -keyalg RSA -keysize 2048 -validity 10950
   ```

3. Put the credentials in `~/.gradle/gradle.properties` (never in the repo):

   ```
   NUTAI_UPLOAD_STORE_FILE=/absolute/path/to/nut-ai-release.keystore
   NUTAI_UPLOAD_STORE_PASSWORD=...
   NUTAI_UPLOAD_KEY_ALIAS=nut-ai
   NUTAI_UPLOAD_KEY_PASSWORD=...
   ```

## Build

```
cd apps/mobile
npm run prebuild            # expo prebuild --clean (regenerates android/)
cd android
./gradlew assembleRelease
```

Output: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
Install with `adb install -r app-release.apk`.

## ABI note

`reactNativeArchitectures` in `apps/mobile/android/gradle.properties` controls
which ABIs are compiled and packaged. The reference build here used
`arm64-v8a` (every phone since ~2015). Add `armeabi-v7a` (and on a beefier
build machine `x86`, `x86_64` for emulators) and re-run `assembleRelease` for
a fatter universal APK.

## Signing notes

- The release APK is signed with your upload keystore when the `NUTAI_UPLOAD_*`
  properties exist; otherwise it is debug-signed (fine for local testing,
  never for distribution).
- EAS production (`app-bundle`) uses the same keystore via `eas credentials`
  if you later go to the Play Store.
