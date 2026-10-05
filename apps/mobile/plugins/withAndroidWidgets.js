const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins')
const fs = require('fs')
const path = require('path')

/**
 * Registers the three Nut AI home-screen widgets on Android — the native
 * half of the widget feature (task 3-c-native).
 *
 * WHY A PLUGIN: `npm run prebuild` runs `expo prebuild --clean`, so android/
 * is regenerated from scratch and gitignored (same reasoning as
 * withAndroidReleaseSigning). Everything below is re-emitted on every
 * prebuild; a missing anchor means the Expo/React-Native template drifted
 * and this plugin MUST hard-fail instead of silently producing an APK
 * without widgets.
 *
 * WHAT IT WRITES (all content embedded in THIS file — no path resolution
 * against template files, so there is nothing to drift except the anchors):
 *
 *   Manifest (object mod — receiver entries inside <application>):
 *     - 3 <receiver> entries for com.nutai.app.widget.NutaiWidgetsProvider
 *       {$Today, $QuickAction, $Training}, android:exported="false".
 *       exported="false" is deliberate: APPWIDGET_UPDATE is delivered by the
 *       system, which can address non-exported components, and the current
 *       official AppWidget manifest sample uses exported="false". No other
 *       app has any reason to poke our providers — least exposure wins.
 *
 *   Files under android/app/src/main/res/:
 *     - xml/today_info.xml          (@xml/today_info)
 *     - xml/quick_action_info.xml   (@xml/quick_action_info)
 *     - xml/training_info.xml       (@xml/training_info)
 *     - layout/widget_today.xml
 *     - layout/widget_quick_action.xml
 *     - layout/widget_training.xml
 *     - drawable/nutai_widget_bg.xml      (rounded white card background)
 *     - drawable/nutai_widget_button.xml  (outlined quick-action button)
 *
 * The layouts pair 1:1 with the Kotlin in
 * apps/mobile/modules/nutai-widgets/android/.../NutaiWidgetsProvider.kt
 * (WidgetViews resolves the ids by name at runtime and hard-fails if one is
 * missing, so a prebuild that somehow skipped this plugin cannot ship a
 * blank widget — it fails at the source).
 *
 * NO gradle dependency is added anywhere; org.json, SharedPreferences,
 * AppWidgetManager and RemoteViews are all android.platform, and CI prebuild
 * runs with --no-install.
 */

const PROVIDER_CLASS = 'com.nutai.app.widget.NutaiWidgetsProvider'

const RECEIVERS = [
  { className: PROVIDER_CLASS + '$Today', label: 'Nut AI — Today', info: '@xml/today_info' },
  { className: PROVIDER_CLASS + '$QuickAction', label: 'Nut AI — Quick actions', info: '@xml/quick_action_info' },
  { className: PROVIDER_CLASS + '$Training', label: 'Nut AI — Training', info: '@xml/training_info' },
]

const APPWIDGET_UPDATE_ACTION = 'android.appwidget.action.APPWIDGET_UPDATE'
const APPWIDGET_PROVIDER_META = 'android.appwidget.provider'

function appwidgetInfoXml(initialLayout) {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"',
    '    android:initialLayout="@layout/' + initialLayout + '"',
    '    android:resizeMode="horizontal|vertical"',
    '    android:updatePeriodMillis="1800000"',
    '    android:widgetCategory="home_screen" />',
    '',
  ].join('\n')
}

const XML_BACKGROUND_DRAWABLE = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">',
  '  <solid android:color="@android:color/white" />',
  '  <corners android:radius="14dp" />',
  '</shape>',
  '',
].join('\n')

const XML_BUTTON_DRAWABLE = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">',
  '  <solid android:color="@android:color/white" />',
  '  <corners android:radius="10dp" />',
  '  <stroke android:width="1dp" android:color="@android:color/darker_gray" />',
  '</shape>',
  '',
].join('\n')

const XML_LAYOUT_TODAY = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<!-- Nut AI "Today" widget. Initial text is the honest empty state; the',
  '     provider/module replace every field from the JS-published snapshot. -->',
  '<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"',
  '    android:id="@+id/widget_root"',
  '    android:layout_width="match_parent"',
  '    android:layout_height="match_parent"',
  '    android:background="@drawable/nutai_widget_bg">',
  '',
  '  <LinearLayout',
  '      android:layout_width="match_parent"',
  '      android:layout_height="wrap_content"',
  '      android:layout_gravity="center_vertical"',
  '      android:orientation="vertical"',
  '      android:padding="12dp">',
  '',
  '    <TextView',
  '        android:id="@+id/widget_today_remaining"',
  '        android:layout_width="match_parent"',
  '        android:layout_height="wrap_content"',
  '        android:contentDescription="Calories remaining"',
  '        android:text="Open Nut AI to refresh"',
  '        android:textColor="@android:color/black"',
  '        android:textSize="26sp"',
  '        android:textStyle="bold" />',
  '',
  '    <TextView',
  '        android:id="@+id/widget_today_eaten"',
  '        android:layout_width="match_parent"',
  '        android:layout_height="wrap_content"',
  '        android:layout_marginTop="2dp"',
  '        android:alpha="0.55"',
  '        android:text=""',
  '        android:textColor="@android:color/black"',
  '        android:textSize="12sp" />',
  '',
  '    <LinearLayout',
  '        android:layout_width="match_parent"',
  '        android:layout_height="wrap_content"',
  '        android:layout_marginTop="8dp"',
  '        android:gravity="center_vertical"',
  '        android:orientation="horizontal">',
  '',
  '      <ProgressBar',
  '          android:id="@+id/widget_today_protein_bar"',
  '          style="@android:style/Widget.ProgressBar.Horizontal"',
  '          android:layout_width="0dp"',
  '          android:layout_height="wrap_content"',
  '          android:layout_weight="1"',
  '          android:max="100"',
  '          android:progress="0" />',
  '',
  '      <TextView',
  '          android:id="@+id/widget_today_protein_text"',
  '          android:layout_width="wrap_content"',
  '          android:layout_height="wrap_content"',
  '          android:layout_marginLeft="8dp"',
  '          android:alpha="0.55"',
  '          android:text=""',
  '          android:textColor="@android:color/black"',
  '          android:textSize="12sp" />',
  '    </LinearLayout>',
  '',
  '    <TextView',
  '        android:id="@+id/widget_today_status"',
  '        android:layout_width="match_parent"',
  '        android:layout_height="wrap_content"',
  '        android:layout_marginTop="6dp"',
  '        android:alpha="0.55"',
  '        android:text=""',
  '        android:textColor="@android:color/black"',
  '        android:textSize="12sp" />',
  '  </LinearLayout>',
  '</FrameLayout>',
  '',
].join('\n')

const XML_LAYOUT_QUICK_ACTION = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<!-- Nut AI quick-action widget: four 48dp text buttons, each deep-linking',
  '     through the app\'s nutai:// alias map. Snapshot-independent. -->',
  '<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"',
  '    android:id="@+id/widget_root"',
  '    android:layout_width="match_parent"',
  '    android:layout_height="match_parent"',
  '    android:background="@drawable/nutai_widget_bg">',
  '',
  '  <LinearLayout',
  '      android:layout_width="match_parent"',
  '      android:layout_height="wrap_content"',
  '      android:layout_gravity="center_vertical"',
  '      android:orientation="vertical"',
  '      android:padding="8dp">',
  '',
  '    <LinearLayout',
  '        android:layout_width="match_parent"',
  '        android:layout_height="wrap_content"',
  '        android:orientation="horizontal">',
  '',
  '      <Button',
  '          android:id="@+id/widget_btn_home"',
  '          android:layout_width="0dp"',
  '          android:layout_height="48dp"',
  '          android:layout_margin="4dp"',
  '          android:layout_weight="1"',
  '          android:background="@drawable/nutai_widget_button"',
  '          android:contentDescription="Open Nut AI home"',
  '          android:text="Home"',
  '          android:textColor="@android:color/black"',
  '          android:textSize="13sp" />',
  '',
  '      <Button',
  '          android:id="@+id/widget_btn_log"',
  '          android:layout_width="0dp"',
  '          android:layout_height="48dp"',
  '          android:layout_margin="4dp"',
  '          android:layout_weight="1"',
  '          android:background="@drawable/nutai_widget_button"',
  '          android:contentDescription="Open Nut AI food log"',
  '          android:text="Log"',
  '          android:textColor="@android:color/black"',
  '          android:textSize="13sp" />',
  '    </LinearLayout>',
  '',
  '    <LinearLayout',
  '        android:layout_width="match_parent"',
  '        android:layout_height="wrap_content"',
  '        android:layout_marginTop="2dp"',
  '        android:orientation="horizontal">',
  '',
  '      <Button',
  '          android:id="@+id/widget_btn_scan"',
  '          android:layout_width="0dp"',
  '          android:layout_height="48dp"',
  '          android:layout_margin="4dp"',
  '          android:layout_weight="1"',
  '          android:background="@drawable/nutai_widget_button"',
  '          android:contentDescription="Open Nut AI meal scan"',
  '          android:text="Scan"',
  '          android:textColor="@android:color/black"',
  '          android:textSize="13sp" />',
  '',
  '      <Button',
  '          android:id="@+id/widget_btn_train"',
  '          android:layout_width="0dp"',
  '          android:layout_height="48dp"',
  '          android:layout_margin="4dp"',
  '          android:layout_weight="1"',
  '          android:background="@drawable/nutai_widget_button"',
  '          android:contentDescription="Open Nut AI training"',
  '          android:text="Train"',
  '          android:textColor="@android:color/black"',
  '          android:textSize="13sp" />',
  '    </LinearLayout>',
  '  </LinearLayout>',
  '</FrameLayout>',
  '',
].join('\n')

const XML_LAYOUT_TRAINING = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<!-- Nut AI training widget: next scheduled workout, or the honest',
  '     "No session scheduled" text. Whole card taps through to nutai://train. -->',
  '<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"',
  '    android:id="@+id/widget_root"',
  '    android:layout_width="match_parent"',
  '    android:layout_height="match_parent"',
  '    android:background="@drawable/nutai_widget_bg">',
  '',
  '  <LinearLayout',
  '      android:layout_width="match_parent"',
  '      android:layout_height="wrap_content"',
  '      android:layout_gravity="center_vertical"',
  '      android:orientation="vertical"',
  '      android:padding="12dp">',
  '',
  '    <TextView',
  '        android:id="@+id/widget_training_label"',
  '        android:layout_width="match_parent"',
  '        android:layout_height="wrap_content"',
  '        android:alpha="0.55"',
  '        android:text="Next workout"',
  '        android:textColor="@android:color/black"',
  '        android:textSize="11sp" />',
  '',
  '    <TextView',
  '        android:id="@+id/widget_training_name"',
  '        android:layout_width="match_parent"',
  '        android:layout_height="wrap_content"',
  '        android:layout_marginTop="2dp"',
  '        android:text="Open Nut AI to refresh"',
  '        android:textColor="@android:color/black"',
  '        android:textSize="15sp"',
  '        android:textStyle="bold" />',
  '',
  '    <TextView',
  '        android:id="@+id/widget_training_time"',
  '        android:layout_width="match_parent"',
  '        android:layout_height="wrap_content"',
  '        android:layout_marginTop="2dp"',
  '        android:alpha="0.55"',
  '        android:text=""',
  '        android:textColor="@android:color/black"',
  '        android:textSize="12sp" />',
  '  </LinearLayout>',
  '</FrameLayout>',
  '',
].join('\n')

const WIDGET_XML_FILES = [
  { dir: 'xml', name: 'today_info.xml', content: appwidgetInfoXml('widget_today') },
  { dir: 'xml', name: 'quick_action_info.xml', content: appwidgetInfoXml('widget_quick_action') },
  { dir: 'xml', name: 'training_info.xml', content: appwidgetInfoXml('widget_training') },
  { dir: 'drawable', name: 'nutai_widget_bg.xml', content: XML_BACKGROUND_DRAWABLE },
  { dir: 'drawable', name: 'nutai_widget_button.xml', content: XML_BUTTON_DRAWABLE },
  { dir: 'layout', name: 'widget_today.xml', content: XML_LAYOUT_TODAY },
  { dir: 'layout', name: 'widget_quick_action.xml', content: XML_LAYOUT_QUICK_ACTION },
  { dir: 'layout', name: 'widget_training.xml', content: XML_LAYOUT_TRAINING },
]

/**
 * Pure manifest transform (exported for the test): pushes the three widget
 * receivers into the first <application> entry. Hard-fails on a missing
 * application anchor — template drift must stop the build, not ship quietly.
 * Idempotent: a receiver that is already present is left alone.
 */
function addWidgetReceivers(manifest) {
  const application =
    manifest && manifest.manifest && Array.isArray(manifest.manifest.application)
      ? manifest.manifest.application[0]
      : null
  if (!application) {
    throw new Error(
      'withAndroidWidgets: no <application> entry found in the generated AndroidManifest.xml. ' +
        'The Expo/React-Native template changed; this plugin must be updated to match.'
    )
  }
  if (!Array.isArray(application.receiver)) {
    application.receiver = []
  }
  for (const receiver of RECEIVERS) {
    const alreadyThere = application.receiver.some(
      (existing) => existing.$ && existing.$['android:name'] === receiver.className
    )
    if (!alreadyThere) {
      application.receiver.push({
        $: {
          'android:name': receiver.className,
          'android:exported': 'false',
          'android:label': receiver.label,
        },
        'intent-filter': [{ action: [{ $: { 'android:name': APPWIDGET_UPDATE_ACTION } }] }],
        'meta-data': [
          {
            $: { 'android:name': APPWIDGET_PROVIDER_META, 'android:resource': receiver.info },
          },
        ],
      })
    }
  }
  return manifest
}

/**
 * Pure resource writer (exported for the test): writes every embedded XML
 * under <androidProjectRoot>/app/src/main/res/. Hard-fails when the res
 * anchor (the generated res directory) is missing — the plugin must never
 * CREATE the template's own directory tree, only fill it.
 */
function writeWidgetResources(androidProjectRoot) {
  const resDir = path.join(androidProjectRoot, 'app', 'src', 'main', 'res')
  if (!fs.existsSync(resDir)) {
    throw new Error(
      'withAndroidWidgets: expected the generated res directory at ' +
        resDir +
        ' but it does not exist. The Expo/React-Native template changed; ' +
        'this plugin must be updated to match.'
    )
  }
  const written = []
  for (const file of WIDGET_XML_FILES) {
    const dir = path.join(resDir, file.dir)
    fs.mkdirSync(dir, { recursive: true })
    const target = path.join(dir, file.name)
    fs.writeFileSync(target, file.content)
    written.push(path.relative(androidProjectRoot, target))
  }
  return written
}

module.exports = function withAndroidWidgets(config) {
  config = withAndroidManifest(config, (cfg) => {
    cfg.modResults = addWidgetReceivers(cfg.modResults)
    return cfg
  })

  return withDangerousMod(config, [
    'android',
    (cfg) => {
      writeWidgetResources(cfg.modRequest.platformProjectRoot)
      return cfg
    },
  ])
}

// Exported for apps/mobile/plugins/withAndroidWidgets.test.js.
module.exports.addWidgetReceivers = addWidgetReceivers
module.exports.writeWidgetResources = writeWidgetResources
module.exports.WIDGET_XML_FILES = WIDGET_XML_FILES
module.exports.RECEIVERS = RECEIVERS
