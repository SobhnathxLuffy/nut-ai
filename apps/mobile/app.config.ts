import type { ExpoConfig } from 'expo/config'

/**
 * App configuration.
 *
 * Every identity string lives in ONE place so the eventual rename is a one-file
 * change rather than a grep across the codebase. `Nut AI` was chosen over the
 * research documents' working codename `Tally`.
 */
const NAME = 'Nut AI'
const SLUG = 'nut-ai'
const BUNDLE_ID = 'com.nutai.app'
const SCHEME = 'nutai'

/**
 * Apple will not issue a HealthKit-capable provisioning profile to a free
 * personal-team Apple ID — full stop, no signing setting routes around it.
 * ("Trying to Sign the app but it doesn't work" reproduced: with a free team
 * selected and Automatic signing on, the real Xcode error is "Provisioning
 * profile ... doesn't include the HealthKit capability / entitlement" — a
 * platform restriction, not a bug in this project's signing config.) HealthKit
 * is additive (README: "Health reconnect"), and src/health/healthkit.ts is
 * already written to degrade gracefully when it is unavailable, so a free-team
 * builder can opt out of the entitlement entirely and get everything else:
 *
 *   SKIP_HEALTHKIT=1 npm run prebuild
 */
const SKIP_HEALTHKIT = process.env.SKIP_HEALTHKIT === '1'

const config: ExpoConfig = {
  name: NAME,
  slug: SLUG,
  version: '0.3.0',
  // The mark: a white peanut silhouette inside four scan-frame corners on
  // near-black. Source of truth is assets/icon.svg; the PNGs are rendered
  // from it (rsvg-convert), never hand-edited.
  icon: './assets/icon.png',
  orientation: 'portrait',
  // Deep links carry widget taps and notification actions straight to a screen.
  scheme: SCHEME,
  userInterfaceStyle: 'automatic',
  // No `newArchEnabled` flag: the New Architecture is the default in SDK 57 and
  // the option was removed from ExpoConfig entirely. Setting it is now a
  // typecheck error, which is how this was caught.

  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: false,
    infoPlist: {
      // Required by App Store review, and true: there is no server we operate,
      // so there is no non-exempt encryption to declare.
      ITSAppUsesNonExemptEncryption: false,
      NSCameraUsageDescription:
        'Nut AI uses your camera to photograph meals and scan barcodes. Photos stay on your device unless you choose a cloud provider during setup.',
      NSPhotoLibraryUsageDescription:
        'Nut AI can read a meal photo you already took. Photos stay on your device unless you choose a cloud provider during setup.',
      NSFaceIDUsageDescription:
        'Nut AI uses Face ID only when you reveal or edit a stored API key — never to log a meal.',
    },
  },

  android: {
    package: BUNDLE_ID,
    // First release build baseline; EAS production profile uses autoIncrement
    // so store/update builds never collide. v0.3.0 = versionCode 4: installs
    // as an upgrade over the released versionCode 3 (apk-v0.2.0) APK — same
    // stable CI upload key on both, so Android allows the in-place update.
    versionCode: 4,
    // Native static config: one fixed colour baked into the APK at build time —
    // the runtime theme system cannot apply here. Must stay a literal (QA P2-20
    // exemption), and matches palette.ink900 in src/theme/tokens.ts.
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0B0B0F',
      // Android 13 themed (monochrome) icon + layered background — both assets
      // existed on disk but were unreferenced until this round (APK-readiness
      // QA 2026-10).
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: [
      'android.permission.CAMERA',
      // Android 13+ runtime permission for posting notifications. Requested
      // CONTEXTUALLY (first reminder enable / first rest-timer start), never
      // at startup — see src/notifications/permissions.ts. Local
      // notifications only — no FCM, no push token; see the note below.
      'android.permission.POST_NOTIFICATIONS',
    ],
    // No Google Play Services dependency: all notifications are local, there is
    // no push token and no FCM. Preserving that keeps F-Droid viable, which
    // matters for an AGPL project.
    blockedPermissions: ['android.permission.RECORD_AUDIO'],
  },

  plugins: [
    'expo-router',
    ['expo-camera', { cameraPermission: 'Nut AI uses your camera to photograph meals and scan barcodes.' }],
    'expo-secure-store',
    'expo-sqlite',
    // Local notifications (Task 3-b): scheduled reminders + rest-timer
    // completion, all device-local. The plugin registers the boot-persistent
    // receiver/service wiring at prebuild. It pulls in NO Google services
    // dependency — expo-notifications schedules local notifications via
    // AlarmManager, so the no-FCM/F-Droid policy above still holds. No
    // custom icon/color/sounds: defaults keep the bundle minimal.
    'expo-notifications',
    ...(SKIP_HEALTHKIT
      ? []
      : ([
          [
            '@kingstinct/react-native-healthkit',
            {
              // Both strings are required by App Review, and they must describe what we
              // actually do rather than what HealthKit could theoretically allow.
              NSHealthShareUsageDescription:
                'Nut AI reads your steps, workouts and weight so your calorie target reflects what you actually did, instead of a fixed guess.',
              NSHealthUpdateUsageDescription:
                'Nut AI writes the meals you log to Health so your nutrition data lives alongside the rest of your health record.',
              // Background delivery is deliberately off. It is an extra entitlement, it
              // is a battery cost, and nothing here needs to react to a step count
              // while the app is closed.
              background: false,
            },
          ],
        ] as [string, Record<string, unknown>][])),
    // Every builder signs with their own free Apple ID — see the plugin doc
    // comment for why this can only ever set the MODE (automatic), never a team.
    './plugins/withAutomaticSigning',
    // Android: sign release builds with the builder's own upload keystore when
    // ~/.gradle/gradle.properties provides NUTAI_UPLOAD_* credentials; fall
    // back to the debug keystore otherwise so a fresh clone still builds.
    './plugins/withAndroidReleaseSigning',
    './plugins/withAndroidWidgets',
  ],

  // GitHub Pages project sites host the app under /<repo>/ — scripts/
  // build-ghpages.sh exports with EXPO_PUBLIC_WEB_BASE=/nut-ai, which drives
  // both this baseUrl and the inlined asset prefix in the web DB adapter.
  // Unset (default) keeps root-anchored hosting byte-identical to before.
  experiments: {
    typedRoutes: true,
    ...(process.env.EXPO_PUBLIC_WEB_BASE
      ? { baseUrl: process.env.EXPO_PUBLIC_WEB_BASE }
      : {}),
  },

  web: {
    // The app bootstraps SQLite-WASM, its own web DB adapter and expo-router
    // entirely on the client; prerendered static pages cannot run that boot
    // sequence. 'single' ships the SPA bundle with one index.html so every
    // route works from a static file server (see serve-coop.py).
    output: 'single',
    bundler: 'metro',
    favicon: './assets/favicon.png',
  },

  extra: {
    // NEVER put an API key here. Keys are written only from runtime user input
    // into expo-secure-store — never from EXPO_PUBLIC_*, app config, .env, or EAS
    // secrets. Anything in `extra` ships in the bundle and is readable by anyone.
    bundleId: BUNDLE_ID,
  },
}

export default config
