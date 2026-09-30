import { Pressable, Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import { useTheme } from '../theme/ThemeProvider'
import { space, type } from '../theme/tokens'

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
 * P2-30 (a): the ONE create-custom-ingredient mini form.
 *
 * food-search and dish-composer each carried a verbatim copy (same title,
 * same name field, same per-100 g macro row, same "Save ingredient
 * (searchable afterwards)" button) that had already drifted into different
 * error UX. Both now render THIS form and keep only their own save handler —
 * the resolution semantics legitimately differ per surface, the fields and
 * copy do not.
 */
export function NewIngredientForm({
  value,
  onChange,
  onSave,
  saving,
  containerStyle,
  nameInputStyle,
  macroInputStyle,
}: {
  value: NewIngredientDraft
  onChange: (next: NewIngredientDraft) => void
  onSave: () => void
  saving: boolean
  containerStyle?: StyleProp<ViewStyle>
  nameInputStyle?: StyleProp<TextStyle>
  macroInputStyle?: StyleProp<TextStyle>
}) {
  const theme = useTheme()
  return (
    <View
      style={[
        {
          borderWidth: 1,
          borderRadius: 12,
          padding: space.md,
          gap: space.xs,
        },
        containerStyle,
      ]}
    >
      <Text style={[type.caption, { color: theme.text, fontWeight: '700' }]}>New ingredient (values per 100 g)</Text>
      <TextInput
        accessibilityLabel="Ingredient name"
        value={value.name}
        onChangeText={(text) => onChange({ ...value, name: text })}
        placeholder="Name"
        placeholderTextColor={theme.textFaint}
        style={[
          {
            borderWidth: 1,
            borderRadius: 8,
            minHeight: 44,
            paddingHorizontal: 8,
            paddingVertical: 4,
            color: theme.text,
            borderColor: theme.border,
            backgroundColor: theme.bgSunken,
          },
          nameInputStyle,
        ]}
      />
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xs }}>
        {MACRO_FIELDS.map(([field, placeholder]) => (
          <TextInput
            key={field}
            accessibilityLabel={`${placeholder} per 100 grams`}
            value={value[field]}
            onChangeText={(text) => onChange({ ...value, [field]: text })}
            placeholder={placeholder}
            placeholderTextColor={theme.textFaint}
            keyboardType="numeric"
            style={[
              {
                flex: 1,
                borderWidth: 1,
                borderRadius: 8,
                minHeight: 44,
                textAlign: 'center',
                paddingVertical: 4,
                color: theme.text,
                borderColor: theme.border,
                backgroundColor: theme.bgSunken,
              },
              macroInputStyle,
            ]}
          />
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Save custom ingredient"
        disabled={saving}
        onPress={onSave}
        style={{
          marginTop: space.sm,
          minHeight: 44,
          borderRadius: 8,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.protein,
          borderColor: theme.protein,
          borderWidth: 1,
          paddingHorizontal: space.md,
        }}
      >
        <Text style={[type.label, { color: theme.bg, fontWeight: '700' }]}>
          {saving ? 'Saving…' : 'Save ingredient (searchable afterwards)'}
        </Text>
      </Pressable>
    </View>
  )
}
