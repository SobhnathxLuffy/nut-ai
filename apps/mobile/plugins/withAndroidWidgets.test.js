import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import plugin from './withAndroidWidgets'

const { addWidgetReceivers, writeWidgetResources, WIDGET_XML_FILES, RECEIVERS } = plugin

const MODULE_DIR = fileURLToPath(new URL('../modules/nutai-widgets', import.meta.url))

/**
 * Minimal fixture shaped like the prebuild template's parsed
 * AndroidManifest.xml (Expo hands withAndroidManifest an xml2js-style object).
 */
function fixtureManifest() {
  return {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android', package: 'com.nutai.app' },
      application: [
        {
          $: { 'android:label': 'Nut AI' },
          activity: [{ $: { 'android:name': '.MainActivity' } }],
        },
      ],
    },
  }
}

/** Tiny well-formedness check: balanced open/close/self-closing tags. */
function assertWellFormedXml(xml, label) {
  const body = xml.replace(/^<\?xml[^>]*\?>/, '').trim()
  const tokens = body.match(/<[^>]+>/g)
  expect(tokens, label + ': no XML tags found').not.toBeNull()
  const stack = []
  for (const token of tokens) {
    if (token.startsWith('<?') || token.startsWith('<!')) continue
    if (token.startsWith('</')) {
      const name = token.slice(2, -1).trim()
      const open = stack.pop()
      expect(open === name, label + ': </' + name + '> closes <' + (open ?? 'nothing') + '>').toBe(true)
    } else if (!token.endsWith('/>')) {
      stack.push(token.slice(1, -1).trim().split(/\s/)[0])
    }
  }
  expect(stack, label + ': unclosed tags ' + stack.join(', ')).toEqual([])
}

describe('withAndroidWidgets — manifest receivers', () => {
  it('adds exactly three appwidget receivers to a fixture manifest', () => {
    const manifest = addWidgetReceivers(fixtureManifest())
    const receivers = manifest.manifest.application[0].receiver
    expect(receivers).toHaveLength(3)
    expect(receivers.map((r) => r.$['android:name'])).toEqual(RECEIVERS.map((r) => r.className))
    expect(RECEIVERS.map((r) => r.className)).toEqual([
      'com.nutai.app.widget.NutaiWidgetsProvider$Today',
      'com.nutai.app.widget.NutaiWidgetsProvider$QuickAction',
      'com.nutai.app.widget.NutaiWidgetsProvider$Training',
    ])
    for (const receiver of receivers) {
      expect(receiver.$['android:exported']).toBe('false')
      expect(receiver['intent-filter'][0].action[0].$['android:name']).toBe(
        'android.appwidget.action.APPWIDGET_UPDATE'
      )
    }
    expect(receivers.map((r) => r['meta-data'][0].$['android:resource'])).toEqual([
      '@xml/today_info',
      '@xml/quick_action_info',
      '@xml/training_info',
    ])
  })

  it('is idempotent — a second run does not duplicate receivers', () => {
    const manifest = addWidgetReceivers(addWidgetReceivers(fixtureManifest()))
    expect(manifest.manifest.application[0].receiver).toHaveLength(3)
  })

  it('hard-fails when the <application> anchor is missing', () => {
    expect(() => addWidgetReceivers({ manifest: {} })).toThrow(/application/)
    expect(() => addWidgetReceivers(undefined)).toThrow(/application/)
  })
})

describe('withAndroidWidgets — emitted resources', () => {
  it('emits exactly the eight embedded XML files, all well-formed', () => {
    expect(WIDGET_XML_FILES.map((f) => f.dir + '/' + f.name).sort()).toEqual([
      'drawable/nutai_widget_bg.xml',
      'drawable/nutai_widget_button.xml',
      'layout/widget_quick_action.xml',
      'layout/widget_today.xml',
      'layout/widget_training.xml',
      'xml/quick_action_info.xml',
      'xml/today_info.xml',
      'xml/training_info.xml',
    ])
    for (const file of WIDGET_XML_FILES) {
      assertWellFormedXml(file.content, file.name)
    }
  })

  it('writes all resources under app/src/main/res in a generated project', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nutai-widgets-'))
    try {
      const resDir = path.join(root, 'app', 'src', 'main', 'res')
      // The template's own res dir must already exist — the plugin fills it,
      // it must never create the anchor itself.
      const sentinel = path.join(resDir, 'values', 'styles.xml')
      mkdirSync(path.dirname(sentinel), { recursive: true })
      writeFileSync(sentinel, '<resources />')

      const written = writeWidgetResources(root)
      expect(written).toHaveLength(8)
      for (const file of WIDGET_XML_FILES) {
        const target = path.join(resDir, file.dir, file.name)
        expect(existsSync(target), target).toBe(true)
        assertWellFormedXml(readFileSync(target, 'utf8'), file.name)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('hard-fails when the generated res anchor is missing', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nutai-widgets-empty-'))
    try {
      expect(() => writeWidgetResources(root)).toThrow(/res directory/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('pairs every widget info file with its layout reference', () => {
    for (const file of WIDGET_XML_FILES.filter((f) => f.dir === 'xml')) {
      expect(file.content).toContain('android:initialLayout="@layout/widget_')
      expect(file.content).toContain('android:updatePeriodMillis="1800000"')
      expect(file.content).toContain('android:resizeMode="horizontal|vertical"')
      expect(file.content).toContain('android:widgetCategory="home_screen"')
    }
  })
})

describe('nutai-widgets local expo module — autolinking contract', () => {
  it('exposes NutaiWidgetsModule from expo-module.config.json with Kotlin sources on disk', () => {
    const moduleConfig = JSON.parse(readFileSync(path.join(MODULE_DIR, 'expo-module.config.json'), 'utf8'))
    expect(moduleConfig.platforms).toEqual(['android'])
    expect(moduleConfig.android.modules).toEqual(['com.nutai.app.widget.NutaiWidgetsModule'])
    for (const source of [
      'android/build.gradle',
      'android/src/main/AndroidManifest.xml',
      'android/src/main/java/com/nutai/app/widget/NutaiWidgetsModule.kt',
      'android/src/main/java/com/nutai/app/widget/NutaiWidgetsProvider.kt',
    ]) {
      expect(existsSync(path.join(MODULE_DIR, source)), source).toBe(true)
    }
  })

  it('pins the JS↔native contract strings inside the Kotlin sources', () => {
    const moduleKt = readFileSync(
      path.join(MODULE_DIR, 'android/src/main/java/com/nutai/app/widget/NutaiWidgetsModule.kt'),
      'utf8'
    )
    // The names T3-c-js's requireNativeModule('NutaiWidgets').publish(...) binds to.
    expect(moduleKt).toContain('Name("NutaiWidgets")')
    expect(moduleKt).toContain('Function("publish")')

    const providerKt = readFileSync(
      path.join(MODULE_DIR, 'android/src/main/java/com/nutai/app/widget/NutaiWidgetsProvider.kt'),
      'utf8'
    )
    // Prefs file + key agreed in the fixed contract.
    expect(providerKt).toContain('"nutai_widget"')
    expect(providerKt).toContain('"snapshot_json"')
    // Honest states + every contracted deep link.
    expect(providerKt).toContain('Open Nut AI to refresh')
    for (const link of ['nutai://home', 'nutai://log', 'nutai://scan', 'nutai://train']) {
      expect(providerKt).toContain('"' + link + '"')
    }
  })
})
