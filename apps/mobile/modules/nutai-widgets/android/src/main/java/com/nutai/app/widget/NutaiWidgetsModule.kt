package com.nutai.app.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

/**
 * Expo local module "NutaiWidgets" — the ONLY native entry point for widgets.
 *
 * JS contract (agreed with the JS half of task 3-c, implemented EXACTLY):
 *
 *   requireNativeModule('NutaiWidgets').publish(json: string): void
 *
 * `json` is the snapshot document:
 *
 *   {v:1, revision:int, generatedAt:int(ms), date:string, stale:boolean,
 *    kcalEaten, kcalRemaining, kcalTarget: number|null, kcalOver:boolean,
 *    proteinG, proteinTargetG: number|null, todayStatus:string,
 *    nextWorkoutName, nextWorkoutTime, nextWorkoutKind: string|null}
 *
 * publish() persists the raw JSON into the shared prefs file
 * [PREFERENCES_FILE] under [SNAPSHOT_KEY], then pushes a RemoteViews update
 * for every configured widget id of all three providers. The app's user
 * database is a WAL SQLite singleton that must never be opened from a widget
 * context (worklog T1-d section B) — this prefs file IS the widget store.
 *
 * All rendering (including the honest empty/stale states) lives in
 * [WidgetViews]; this module only validates, persists and fans out.
 */
class NutaiWidgetsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("NutaiWidgets")

    Function("publish") { json: String ->
      // Validate BEFORE persisting: an unparseable snapshot must fail loudly
      // (the JS caller sees the thrown error) instead of landing in prefs as
      // garbage that every widget would then silently render as empty.
      val snapshot = JSONObject(json)

      // apply() — async disk write is fine; the in-process read below and the
      // system's own onUpdate both see the new value immediately.
      context
        .getSharedPreferences(PREFERENCES_FILE, Context.MODE_PRIVATE)
        .edit()
        .putString(SNAPSHOT_KEY, json)
        .apply()

      val manager = AppWidgetManager.getInstance(context)
      for (kind in WidgetKind.entries) {
        val ids = manager.getAppWidgetIds(ComponentName(context, kind.providerClass)) ?: continue
        if (ids.isNotEmpty()) {
          manager.updateAppWidget(ids, WidgetViews.build(context, kind, snapshot))
        }
      }
    }
  }
}
