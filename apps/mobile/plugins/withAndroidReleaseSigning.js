const { withAppBuildGradle } = require('@expo/config-plugins')

/**
 * Wires a real upload keystore into the release buildType — if, and only if,
 * the builder has provided keystore credentials OUTSIDE this repo.
 *
 * WHY THIS EXISTS: `expo prebuild` (and therefore `npm run prebuild`, which is
 * `prebuild --clean`) always emits `signingConfig signingConfigs.debug` for the
 * release buildType, with a comment telling you to "generate your own keystore
 * file". Hand-editing android/app/build.gradle cannot be the answer — that file
 * is generated, gitignored (root .gitignore: apps/mobile/android/) and wiped on
 * the next prebuild. This plugin makes the fix survive regeneration, the same
 * way withAutomaticSigning does for iOS.
 *
 * The credentials live in the builder's GLOBAL Gradle properties file
 * (~/.gradle/gradle.properties) — never in this repo, never in the generated
 * project, never in env vars committed anywhere. Gradle automatically exposes
 * that file's entries as project properties, so `project.hasProperty(...)` sees
 * them at configuration time:
 *
 *   NUTAI_UPLOAD_STORE_FILE=/absolute/path/to/nut-ai-release.keystore
 *   NUTAI_UPLOAD_STORE_PASSWORD=...
 *   NUTAI_UPLOAD_KEY_ALIAS=...
 *   NUTAI_UPLOAD_KEY_PASSWORD=...
 *
 * Behaviour:
 *  - Properties present  -> release APK/AAB is signed with the upload keystore.
 *  - Properties absent   -> falls back to the generated debug keystore, exactly
 *    like stock prebuild, so a fresh clone still builds an installable APK
 *    instead of failing configuration. (A debug-signed release APK installs
 *    fine for local testing; it must never be published.)
 *
 * Generate a keystore with:
 *   keytool -genkeypair -v -storetype PKCS12 -keystore nut-ai-release.keystore \
 *     -alias nut-ai -keyalg RSA -keysize 2048 -validity 10950
 *
 * The keystore IS the app's update identity: back it up, never commit it.
 */
const PROP = 'NUTAI_UPLOAD_STORE_FILE'

module.exports = function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let contents = cfg.modResults.contents

    // 1. Conditional release signingConfig, appended to the existing
    //    signingConfigs block. Groovy evaluates `project.hasProperty` at
    //    configuration time, so the block simply does not exist when the
    //    builder has not provided credentials.
    const signingConfigsAnchor = /signingConfigs\s*\{/
    if (!signingConfigsAnchor.test(contents)) {
      throw new Error(
        'withAndroidReleaseSigning: no `signingConfigs {` block found in the generated app/build.gradle. ' +
          'The Expo/React-Native template changed; this plugin must be updated to match.'
      )
    }
    if (!contents.includes('NUTAI_UPLOAD_STORE_FILE')) {
      contents = contents.replace(
        signingConfigsAnchor,
        [
          'signingConfigs {',
          "        if (project.hasProperty('" + PROP + "')) {",
          '            release {',
          '                storeFile file(NUTAI_UPLOAD_STORE_FILE)',
          '                storePassword NUTAI_UPLOAD_STORE_PASSWORD',
          '                keyAlias NUTAI_UPLOAD_KEY_ALIAS',
          '                keyPassword NUTAI_UPLOAD_KEY_PASSWORD',
          '            }',
          '        }',
        ].join('\n')
      )
    }

    // 2. Point the release buildType at it when present. Stock prebuild emits
    //    exactly one `signingConfig signingConfigs.debug` inside buildTypes —
    //    the release one, directly under the "Caution!" comment. Anchor on
    //    that comment so we can never accidentally retarget the debug
    //    buildType's own signingConfig line.
    const releaseAnchor =
      /(release\s*\{\s*\n[^\n]*Caution![^\n]*\n[^\n]*signed-apk-android[^\n]*\n)(\s*)signingConfig signingConfigs\.debug/
    if (releaseAnchor.test(contents)) {
      contents = contents.replace(
        releaseAnchor,
        "$1$2signingConfig project.hasProperty('" +
          PROP +
          "') ? signingConfigs.release : signingConfigs.debug"
      )
    } else if (!contents.includes("signingConfigs.release : signingConfigs.debug")) {
      throw new Error(
        'withAndroidReleaseSigning: release buildType anchor (the "Caution!" comment + ' +
          'signingConfig signingConfigs.debug pair) not found in the generated app/build.gradle. ' +
          'The Expo/React-Native template changed; this plugin must be updated to match.'
      )
    }

    cfg.modResults.contents = contents
    return cfg
  })
}
