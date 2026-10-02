import { Text, View } from 'react-native'
import { Disclosure } from '../src/components/Disclosure'
import { ItemRow } from '../src/components/ItemRow'
import { Screen } from '../src/components/Screen'
import { useTheme } from '../src/theme/ThemeProvider'
import { space, type } from '../src/theme/tokens'

/**
 * About — UI/UX report Ch 8.8 (Wave 3) sub-page.
 *
 * The old Profile tab's tail — license attributions and the medical
 * disclaimer — folded into expandable disclosures so the words survive
 * verbatim without living at the top of every scroll. Collapsed by default,
 * one tap to read, never deleted.
 */
export default function AboutSettings() {
  const theme = useTheme()
  return (
    <Screen title="About" back backLabel="Back to profile">
      <View style={{ gap: space.sm }}>
        <ItemRow icon="heart" label="Nut AI" value="No account, no server, no paid tier" />
        <ItemRow icon="person" label="Nutrition data" value="IFCT 2017 · USDA · Open Food Facts" />
      </View>

      <View style={{ gap: space.sm, marginTop: space.md }}>
        <Disclosure label="Licenses & data sources" caption="AGPL-3.0 · IFCT · USDA · Open Food Facts">
          <Text style={[type.caption, { color: theme.text, lineHeight: 18 }]}>
            Nut AI is licensed AGPL-3.0.
          </Text>
          <Text style={[type.caption, { color: theme.text, lineHeight: 18 }]}>
            IFCT: ICMR-NIN, used with permission. USDA FoodData Central: public domain.
            Open Food Facts barcode data: ODbL 1.0.
          </Text>
          <Text style={[type.caption, { color: theme.textMuted, lineHeight: 18 }]}>
            The dish knowledge base (362 reviewed Indian dishes) is Nut AI's own, built from
            these corpora.
          </Text>
        </Disclosure>

        <Disclosure label="Medical disclaimer" caption="AI estimates, not medical advice">
          <Text style={[type.caption, { color: theme.text, lineHeight: 18 }]}>
            Nut AI's estimates are AI-generated approximations and may not be accurate. It is not a
            medical device and does not diagnose, treat, cure or prevent any condition. Consult a
            registered dietitian or healthcare provider before making medical decisions.
          </Text>
        </Disclosure>
      </View>
    </Screen>
  )
}
