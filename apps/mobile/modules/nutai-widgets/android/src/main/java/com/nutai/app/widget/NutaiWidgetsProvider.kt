package com.nutai.app.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import kotlin.math.abs
import org.json.JSONObject

/**
 * The widget snapshot store. JS owns this document end to end: the app
 * recomputes it and publishes the whole JSON through NutaiWidgetsModule.
 * publish(...). Native never opens SQLite from a widget context (worklog
 * T1-d section B — the user DB is a WAL SQLite singleton) and never infers
 * staleness here — the snapshot's own `stale` boolean (computed by JS) is
 * the only staleness signal, rendered honestly.
 */
internal const val PREFERENCES_FILE = "nutai_widget"
internal const val SNAPSHOT_KEY = "snapshot_json"

/**
 * The three widget surfaces. Each maps 1:1 to a manifest <receiver> — a
 * STATIC nested subclass of [NutaiWidgetsProvider] (registered as
 * `com.nutai.app.widget.NutaiWidgetsProvider$Today` etc.) — and to one
 * `*_info.xml` + layout written at prebuild by
 * apps/mobile/plugins/withAndroidWidgets.js. Static (not inner) classes are
 * mandatory: the system instantiates receivers reflectively.
 */
internal enum class WidgetKind(val providerClass: Class<out NutaiWidgetsProvider>) {
  TODAY(NutaiWidgetsProvider.Today::class.java),
  QUICK_ACTION(NutaiWidgetsProvider.QuickAction::class.java),
  TRAINING(NutaiWidgetsProvider.Training::class.java),
}

/**
 * Base class for all three Nut AI widgets. The manifest (written by the
 * withAndroidWidgets plugin) registers one receiver per nested subclass;
 * each only declares which [WidgetKind] it renders.
 *
 * onUpdate() re-renders from the LAST PUBLISHED snapshot in prefs. If nothing
 * was ever published (or it does not parse), WidgetViews renders the honest
 * "Open Nut AI to refresh" state — native never fabricates numbers to fill a
 * broadcast (AGENTS.md §19).
 */
abstract class NutaiWidgetsProvider : AppWidgetProvider() {
  protected abstract val kind: WidgetKind

  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    val snapshot = readSnapshot(context)
    for (widgetId in appWidgetIds) {
      appWidgetManager.updateAppWidget(widgetId, WidgetViews.build(context, kind, snapshot))
    }
  }

  private fun readSnapshot(context: Context): JSONObject? {
    val json = context
      .getSharedPreferences(PREFERENCES_FILE, Context.MODE_PRIVATE)
      .getString(SNAPSHOT_KEY, null) ?: return null
    // A persisted-but-unparseable snapshot (should be impossible: publish()
    // validates first) degrades to the honest empty state, never a crash.
    return runCatching { JSONObject(json) }.getOrNull()
  }

  class Today : NutaiWidgetsProvider() {
    override val kind = WidgetKind.TODAY
  }

  class QuickAction : NutaiWidgetsProvider() {
    override val kind = WidgetKind.QUICK_ACTION
  }

  class Training : NutaiWidgetsProvider() {
    override val kind = WidgetKind.TRAINING
  }
}

/**
 * Builds the RemoteViews for each widget kind from the JS-published snapshot.
 *
 * Layouts and drawables live in the APP's res/ (written at prebuild by the
 * withAndroidWidgets config plugin), not in this library module — so every
 * id is resolved by name at runtime. A resolved-zero id means the plugin did
 * not run; that fails loudly rather than rendering a blank widget.
 *
 * Styling: dark text on light, framework colors only —
 * no new resource dependencies. Secondary text uses black at alpha 0.55
 * (≈4.9:1 on white) because @android:color/darker_gray is too low-contrast.
 * Tap targets are ≥48dp; the tappable root of each widget gets an honest
 * runtime contentDescription.
 */
internal object WidgetViews {
  private const val REFRESH_TEXT = "Open Nut AI to refresh"

  // Deep links — resolved by the app's existing alias map (deep-links.ts).
  private const val LINK_HOME = "nutai://home"
  private const val LINK_LOG = "nutai://log"
  private const val LINK_SCAN = "nutai://scan"
  private const val LINK_TRAIN = "nutai://train"

  // Distinct requestCodes so one PendingIntent never aliases another.
  private const val RC_TODAY_HOME = 11
  private const val RC_HOME = 21
  private const val RC_LOG = 22
  private const val RC_SCAN = 23
  private const val RC_TRAIN = 24
  private const val RC_TRAINING_TRAIN = 25

  fun build(context: Context, kind: WidgetKind, snapshot: JSONObject?): RemoteViews = when (kind) {
    WidgetKind.TODAY -> today(context, snapshot)
    WidgetKind.QUICK_ACTION -> quickAction(context)
    WidgetKind.TRAINING -> training(context, snapshot)
  }

  private fun today(context: Context, snapshot: JSONObject?): RemoteViews {
    val views = RemoteViews(context.packageName, id(context, "layout", "widget_today"))
    val remainingId = id(context, "id", "widget_today_remaining")
    val eatenId = id(context, "id", "widget_today_eaten")
    val barId = id(context, "id", "widget_today_protein_bar")
    val proteinId = id(context, "id", "widget_today_protein_text")
    val statusId = id(context, "id", "widget_today_status")
    val rootId = id(context, "id", "widget_root")

    // live == null covers "nothing published yet" AND a stale snapshot — both
    // render the same honest refresh prompt. A missing/stale state never
    // shows last-known numbers as if current.
    val live = snapshot?.takeIf { !it.optBoolean("stale", true) }
    val kcalRemaining = live?.let { number(it, "kcalRemaining") }

    if (live == null || kcalRemaining == null) {
      views.setTextViewText(remainingId, REFRESH_TEXT)
      views.setTextViewText(eatenId, "")
      views.setViewVisibility(barId, RemoteViews.GONE)
      views.setTextViewText(proteinId, "")
      views.setTextViewText(statusId, "")
      views.setContentDescription(rootId, REFRESH_TEXT)
    } else {
      // kcalOver comes FROM the snapshot (JS computes it) — shown honestly,
      // never folded into a positive "remaining" number.
      val kcalOver = live.optBoolean("kcalOver", false)
      val remainingText = if (kcalOver) {
        "Over by ${fmt(abs(kcalRemaining))} kcal"
      } else {
        "${fmt(kcalRemaining)} kcal left"
      }
      views.setTextViewText(remainingId, remainingText)

      val kcalEaten = number(live, "kcalEaten")
      val kcalTarget = number(live, "kcalTarget")
      views.setTextViewText(
        eatenId,
        when {
          kcalEaten != null && kcalTarget != null ->
            "Eaten ${fmt(kcalEaten)} of ${fmt(kcalTarget)} kcal"
          kcalEaten != null -> "Eaten ${fmt(kcalEaten)} kcal"
          else -> "Nothing logged yet"
        },
      )

      val proteinG = number(live, "proteinG")
      val proteinTargetG = number(live, "proteinTargetG")
      if (proteinG != null && proteinTargetG != null && proteinTargetG > 0) {
        val percent = (proteinG / proteinTargetG * 100.0).coerceIn(0.0, 100.0)
        views.setViewVisibility(barId, RemoteViews.VISIBLE)
        views.setProgressBar(barId, 100, Math.round(percent).toInt(), false)
        views.setTextViewText(proteinId, "Protein ${fmt(proteinG)} / ${fmt(proteinTargetG)} g")
      } else if (proteinTargetG != null) {
        // Target set but nothing logged — a fabricated zero would violate
        // AGENTS.md §19 ("missing nutrition silently converted to zero").
        views.setViewVisibility(barId, RemoteViews.GONE)
        views.setTextViewText(proteinId, "Protein not logged yet")
      } else {
        views.setViewVisibility(barId, RemoteViews.GONE)
        views.setTextViewText(proteinId, "No protein target set")
      }

      val status = string(live, "todayStatus")
      views.setTextViewText(statusId, status ?: "")
      views.setContentDescription(
        rootId,
        listOf(remainingText, status ?: "no status").joinToString(". "),
      )
    }

    views.setOnClickPendingIntent(rootId, tap(context, LINK_HOME, RC_TODAY_HOME))
    return views
  }

  /** Four plain text buttons; snapshot-independent (always actionable). */
  private fun quickAction(context: Context): RemoteViews {
    val views = RemoteViews(context.packageName, id(context, "layout", "widget_quick_action"))
    bind(context, views, "widget_btn_home", LINK_HOME, RC_HOME)
    bind(context, views, "widget_btn_log", LINK_LOG, RC_LOG)
    bind(context, views, "widget_btn_scan", LINK_SCAN, RC_SCAN)
    bind(context, views, "widget_btn_train", LINK_TRAIN, RC_TRAIN)
    return views
  }

  private fun training(context: Context, snapshot: JSONObject?): RemoteViews {
    val views = RemoteViews(context.packageName, id(context, "layout", "widget_training"))
    val nameId = id(context, "id", "widget_training_name")
    val timeId = id(context, "id", "widget_training_time")
    val rootId = id(context, "id", "widget_root")

    val live = snapshot?.takeIf { !it.optBoolean("stale", true) }
    val scheduled = live?.let { string(it, "nextWorkoutName") }
    val at = live?.let { string(it, "nextWorkoutTime") }
    val kindLabel = live?.let { string(it, "nextWorkoutKind") }

    val name = when {
      live == null -> REFRESH_TEXT
      scheduled != null -> scheduled
      // The contract's honest empty state — never a fabricated guess.
      else -> "No session scheduled"
    }
    val time = if (scheduled != null) listOfNotNull(at, kindLabel).joinToString(" · ") else ""

    views.setTextViewText(nameId, name)
    views.setTextViewText(timeId, time)
    views.setContentDescription(rootId, if (time.isEmpty()) name else "$name, $time")
    views.setOnClickPendingIntent(rootId, tap(context, LINK_TRAIN, RC_TRAINING_TRAIN))
    return views
  }

  private fun bind(
    context: Context,
    views: RemoteViews,
    button: String,
    link: String,
    requestCode: Int,
  ) {
    views.setOnClickPendingIntent(id(context, "id", button), tap(context, link, requestCode))
  }

  /** VIEW intent on a nutai:// deep link — the app's alias map routes it. */
  private fun tap(context: Context, link: String, requestCode: Int): PendingIntent =
    PendingIntent.getActivity(
      context,
      requestCode,
      Intent(Intent.ACTION_VIEW, Uri.parse(link)),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

  /** A missing key and an explicit JSON null both read as null — honest absence. */
  private fun number(json: JSONObject, key: String): Double? =
    if (json.isNull(key)) null else json.optDouble(key)

  private fun string(json: JSONObject, key: String): String? {
    if (json.isNull(key)) return null
    val value = json.optString(key)
    return if (value.isBlank()) null else value
  }

  /** Display-only rounding of an already-published number — nothing recomputed. */
  private fun fmt(value: Double): String = Math.round(value).toString()

  private fun id(context: Context, type: String, name: String): Int {
    val identifier = context.resources.getIdentifier(name, type, context.packageName)
    if (identifier == 0) {
      throw IllegalStateException(
        "Nut AI widget resource '$name' not found — did the withAndroidWidgets config plugin run at prebuild?",
      )
    }
    return identifier
  }
}
