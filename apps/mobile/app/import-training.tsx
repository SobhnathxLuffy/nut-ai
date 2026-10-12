import { router } from 'expo-router'
import { useState } from 'react'
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import { listExercises, listRoutines } from '@nutai/training'
import { db } from '../src/data/repo'
import {
  buildTrainingImportPlan,
  executeTrainingImport,
  parseTrainingImportJson,
  type ImportProblem,
  type TrainingImportPlan,
} from '../src/data/training-import'
import { TRAINING_IMPORT_EXAMPLE } from '../src/data/training-import-example'
import { Button, Card, Label, Screen, useAction } from '../src/components/Screen'
import { showToast } from '../src/components/toast-store'
import { useTheme } from '../src/theme/ThemeProvider'
import { selectionAsync } from '../src/utils/haptics'
import { MIN_TAP_TARGET, radius, space, type } from '../src/theme/tokens'

/**
 * Import routines & programs from one JSON file (owner request, 2026-10-12).
 *
 * The editors create plans one at a time; this screen accepts a BULK file —
 * a coach's plan, a spreadsheet export, a community template — with many
 * routines and programs at once. The three-stage pipeline
 * (parse → plan → execute, src/data/training-import.ts) resolves exercises
 * by NAME against the real library, validates every set through the engine's
 * own gates, and writes through the same saveRoutine/saveProgram the editors
 * use, so every import is transactional and individually undoable.
 *
 * Honest UX: nothing writes until Import is tapped. Problems are listed per
 * item — a bad exercise name drops that ONE routine, never the batch.
 */
export default function ImportTraining() {
  const theme = useTheme()
  const action = useAction()
  const [raw, setRaw] = useState('')
  const [showExample, setShowExample] = useState(false)
  // Post-import problems (plan-stage and write-stage), listed under the form.
  const [problems, setProblems] = useState<ImportProblem[]>([])
  const importing = action.busy

  /** Shape preview from the pasted text — recomputed live, never cached. */
  const preview = (() => {
    if (!raw.trim()) return null
    const parsed = parseTrainingImportJson(raw)
    if (!parsed.ok) return { ok: false as const, error: parsed.error }
    return { ok: true as const, routines: parsed.parsed.routines.length, programs: parsed.parsed.programs.length }
  })()

  const runImport = () => {
    if (importing) return
    void selectionAsync()
    void action.run(async () => {
      const handle = await db()
      const parsed = parseTrainingImportJson(raw)
      if (!parsed.ok) {
        showToast({ message: parsed.error, tone: 'error' })
        return
      }
      const [exercises, routines] = await Promise.all([listExercises(handle), listRoutines(handle)])
      const catalog = {
        exercises: exercises.map((e) => ({ id: e.id, name: e.name, aliases: e.aliases, tracking_type: e.tracking_type })),
        existingRoutines: routines.map((r) => ({ id: r.id, name: r.name })),
      }
      const plan: TrainingImportPlan = buildTrainingImportPlan(parsed.parsed, catalog)
      if (plan.routines.length === 0 && plan.programs.length === 0) {
        setProblems(plan.problems)
        showToast({ message: 'Nothing could be imported — see the problems below.', tone: 'error' })
        return
      }
      const result = await executeTrainingImport(handle, plan)
      const all: ImportProblem[] = [
        ...plan.problems,
        ...result.errors.map((message, i) => ({ ref: `Write ${i + 1}`, message })),
      ]
      setProblems(all)
      showToast({
        message: `Imported ${result.routinesImported} ${result.routinesImported === 1 ? 'routine' : 'routines'} and ${result.programsImported} ${result.programsImported === 1 ? 'program' : 'programs'}${all.length > 0 ? ` — ${all.length} ${all.length === 1 ? 'item' : 'items'} skipped` : ''}.`,
        tone: all.length > 0 ? 'default' : 'success',
      })
    })
  }

  const pickFile = () => {
    void (async () => {
      try {
        const res = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true, multiple: false })
        if (res.canceled || !res.assets?.[0]) return
        const asset = res.assets[0]
        // expo-file-system's File (not the DOM File) reads a native content
        // URI — same lazy require as backup.ts, which keeps the web bundler
        // from pulling the native module in.
        if (Platform.OS === 'web') {
          setRaw(await (await fetch(asset.uri)).text())
        } else {
          const { File } = require('expo-file-system') as { File: new (uri: string) => { text(): Promise<string> } }
          setRaw(await new File(asset.uri).text())
        }
        setProblems([])
        setShowExample(false)
      } catch {
        showToast({ message: 'Could not read that file.', tone: 'error' })
      }
    })()
  }

  return (
    <Screen title="Import routines & programs" back backLabel="Back">
      <Label muted>
        One JSON file, any number of routines and programs. Exercises resolve by NAME against your library; nothing is written
        until you tap Import.
      </Label>
      {action.feedback}

      <View style={styles.fileRow}>
        <Button label="Load JSON file" onPress={pickFile} />
        <Button label={showExample ? 'Hide example' : 'Show example'} onPress={() => { setShowExample((v) => !v); void selectionAsync() }} />
      </View>

      {showExample ? (
        <Card>
          <Label>Example — edit it, or tap the chip to load it</Label>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Load the example JSON into the editor"
            onPress={() => {
              setRaw(TRAINING_IMPORT_EXAMPLE)
              setShowExample(false)
              setProblems([])
              showToast({ message: 'Example loaded below — edit it, then Import.' })
            }}
            style={[styles.exampleChip, { borderColor: theme.border }]}
          >
            <Text style={[type.label, { color: theme.text }]}>Load this example</Text>
          </Pressable>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: space.sm }}>
            <Text style={[styles.example, { color: theme.textMuted, backgroundColor: theme.bgSunken }]} selectable>
              {TRAINING_IMPORT_EXAMPLE}
            </Text>
          </ScrollView>
        </Card>
      ) : null}

      <Text style={[type.caption, { color: theme.textMuted }]}>JSON</Text>
      <View style={[styles.jsonInput, { borderColor: theme.border, backgroundColor: theme.bgSunken }]}>
        <TextInput
          accessibilityLabel="JSON to import"
          value={raw}
          onChangeText={(v) => { setRaw(v); setProblems([]) }}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          placeholder={'{ "format": "nutai.training-import", "version": 1, "routines": [ … ], "programs": [ … ] }'}
          placeholderTextColor={theme.textFaint}
          style={{ minHeight: 180, textAlignVertical: 'top', padding: space.md, color: theme.text, fontSize: type.caption.fontSize }}
        />
      </View>

      {preview ? (
        preview.ok ? (
          <Card>
            <Label>
              Shape check: {preview.routines} {preview.routines === 1 ? 'routine' : 'routines'}, {preview.programs}{' '}
              {preview.programs === 1 ? 'program' : 'programs'} in the file.
            </Label>
            <Label muted>
              Names, sets and schedules are fully verified when you tap Import; anything that fails is listed here, item by item.
            </Label>
          </Card>
        ) : (
          <Card>
            <Label>File problem</Label>
            <Text style={[type.body, { color: theme.safety }]}>{preview.error}</Text>
          </Card>
        )
      ) : (
        <Label muted>Paste JSON above, or load a file, to see the shape check.</Label>
      )}

      <Button label="Import" selected disabled={!preview?.ok || action.busy} onPress={runImport} />
      <Button label="Done" onPress={() => router.back()} />

      {problems.length > 0 ? (
        <Card>
          <Label>Problems ({problems.length})</Label>
          {problems.map((p, i) => (
            <Text key={`${p.ref}-${i}`} style={[type.caption, { color: theme.textMuted, marginTop: space.xs }]}>
              • {p.ref}: {p.message}
            </Text>
          ))}
        </Card>
      ) : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  fileRow: { flexDirection: 'row', gap: space.sm },
  exampleChip: {
    minHeight: MIN_TAP_TARGET,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    marginTop: space.sm,
  },
  example: {
    ...type.caption,
    padding: space.md,
    borderRadius: radius.md,
  },
  jsonInput: {
    borderWidth: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
})
