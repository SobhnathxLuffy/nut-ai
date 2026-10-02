import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { Field } from './Field'
import { useTheme } from '../theme/ThemeProvider'
import { MIN_TAP_TARGET, radius, space, type } from '../theme/tokens'

export interface NewIngredientDraft {
  name: string
  kcal: string
  protein: string
  carbs: string
  fat: string
}

export const EMPTY_NEW_INGREDIENT: NewIngredientDraft = { name: '', kcal: '', protein: '', carbs: '', fat: '' }

const MACRO_FIELDS = [
  ['kcal', 'kcal'],
  ['protein', 'P g'],
  ['carbs', 'C g'],
  ['fat', 'F g'],
] as const

/**
 * P2-30 (a) → Wave 3 (UI/UX report Ch. 8.3): the ONE create-custom-ingredient
 * mini form, REBUILT on the shared Field primitive.
 *
 * food-search and dish-composer each carried a verbatim copy (same title, same
 * name field, same per-100 g macro row, same save button) that had drifted
 * into different error UX — P2-30 folded them into one component; this wave
 * removes the component's own hand-rolled TextInput dialects (private borders,
 * radii, minHeight) so the fields, focus handling and sizing all resolve from
 * the ONE Field. Both surfaces render THIS form and keep only their own save
 * handler — resolution semantics legitimately differ per surface, the fields
 * do not. The per-call-site inputStyle overrides are gone: style drift was the
 * original bug.
 */
export function NewIngredientForm({
  value,
  onChange,
  onSave,
  saving,
  containerStyle,
}: {
  value: NewIngredientDraft
  onChange: (next: NewIngredientDraft) => void
  onSave: () => void
  saving: boolean
  containerStyle?: StyleProp<ViewStyle>
}) {
  const theme = useTheme()
  return (
    <View style={[styles.box, { borderColor: theme.border, backgroundColor: theme.bgSunken }, containerStyle]}>
      <Text style={[type.caption, { color: theme.text, fontWeight: '700' }]}>New ingredient (values per 100 g)</Text>
      <Field
        label="Ingredient name"
        value={value.name}
        onValueChange={(name) => onChange({ ...value, name })}
        placeholder="Name"
        inputStyle={styles.input}
      />
      <View style={styles.macroRow}>
        {MACRO_FIELDS.map(([field, unit]) => (
          <Field
            key={field}
            label={unit}
            accessibilityLabel={`${unit} per 100 grams`}
            value={value[field]}
            onValueChange={(text) => onChange({ ...value, [field]: text })}
            placeholder={unit}
            numeric
            containerStyle={styles.macroField}
            inputStyle={styles.macroInput}
          />
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Save custom ingredient"
        disabled={saving}
        onPress={onSave}
        style={[styles.saveBtn, { backgroundColor: theme.protein, borderColor: theme.protein }]}
      >
        <Text style={[type.label, { color: theme.bg, fontWeight: '700' }]}>
          {saving ? 'Saving…' : 'Save ingredient (searchable afterwards)'}
        </Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  box: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
  },
  macroRow: {
    flexDirection: 'row',
    gap: space.sm,
  },
  macroField: {
    flex: 1,
  },
  // The Field primitive owns the size/focus/border dialect; these overrides
  // only COMPACT the macro cells so four fit one row (value + unit caption).
  input: {},
  macroInput: {
    minHeight: MIN_TAP_TARGET,
    textAlign: 'center',
    paddingVertical: space.xs,
  },
  saveBtn: {
    marginTop: space.sm,
    minHeight: MIN_TAP_TARGET,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
  },
})
