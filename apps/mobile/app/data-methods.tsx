import { Pressable, ScrollView, Text, View, type StyleProp, type TextStyle } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../src/theme/ThemeProvider'
import { space, type, type Theme } from '../src/theme/tokens'

/**
 * The full, honest explanation of where Nut AI's food and dish numbers come
 * from: the corpora, the dish knowledge base, how ingredient amounts are
 * counted, how the compose page builds "My Version", and why a dish opens at
 * 150 g (or 40 g) and what that number means. Linked from Profile →
 * "How food & dish data works".
 */
export default function DataMethods() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + 120, gap: space.lg }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text accessibilityRole="header" style={[type.title, { color: theme.text }]}>How food & dish data works</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={space.md}>
          <Text style={[type.label, { color: theme.textMuted }]}>Done</Text>
        </Pressable>
      </View>

      <Block theme={theme} title="1 · Where the data comes from">
        <Text style={p(theme)}>
          Every food number in this app comes from three offline sources — nothing is invented at runtime.
          IFCT 2017 (Indian Food Composition Tables, ICMR-NIN) contributes 542 Indian foods with laboratory
          values. USDA FoodData Central contributes 7,928 foods, including reference rows for a few basics
          missing from both corpora (plain brewed tea and coffee). The third source is Nut AI's own dish
          knowledge base: 362 reviewed Indian dish recipes (roti, dal tadka, biryani, idli…), each built from
          standard home and restaurant recipes.
        </Text>
        <Text style={p(theme)}>
          Each dish recipe is stored as ingredient slots. A slot names one ingredient role — grain flour,
          dal, aromatics, tadka fat, water — and is pinned to a specific verified food id (for example, a
          roti's flour slot points at IFCT A019, whole wheat flour). That mapping is how the app knows which
          food goes into which dish, and it is validated at build time: a slot whose food id does not exist in
          the shipped corpora fails the build instead of shipping silently. The Food Database header states
          the shipped truth from the artifact itself — how many dishes are fully mapped and how many carry a
          verified cooked yield — so the app can never claim more verification than its own database holds
          (P1-10: internal honesty has to match external claims).
        </Text>
      </Block>

      <Block theme={theme} title="2 · How ingredient amounts are counted">
        <Text style={p(theme)}>
          The database never stores "50 g ghee" style numbers. Each slot stores a verified mass-fraction range
          — its share of the total raw ingredients. A roti's raw dough is roughly 60–70% flour, 30–40% water,
          0.5–1.5% salt and 1–4% ghee. The dish also stores two calibrated numbers: the cooked yield (how much
          of the raw batch survives cooking — a roti dough loses water on the tawa, factor 0.88) and the
          standard portion weight (one roti ≈ 40 g cooked).
        </Text>
        <Text style={p(theme)}>
          From those, the per-serving grams of every ingredient follow by plain arithmetic: the raw batch for
          one serving is portion ÷ yield (40 ÷ 0.88 ≈ 45 g of dough), and each ingredient takes its share of
          that batch. For a roti that is about 29 g flour, 16 g water, 0.4 g salt and 1.1 g ghee — not a flat
          block of 50 g of everything. Calories and macros are then the sum of each ingredient's per-100 g
          values times its grams, scaled from the cooked batch to the portion you log.
        </Text>
        <Text style={p(theme)}>
          Cooking water is part of the recipe the same way. A serving of dal tadka (150 g cooked) starts from
          about 33 g raw dal and 104 g water; the yield factor (0.92) only accounts for evaporation, because
          the water is already counted as an ingredient. This is also why searching "dal tadka" shows a
          realistic ~180 kcal per katori rather than a three-times-underestimated number.
        </Text>
      </Block>

      <Block theme={theme} title="3 · How the compose page builds your version">
        <Text style={p(theme)}>
          When you open a dish in the composer (Edit ingredients), it opens pre-seeded with the verified
          recipe converted to real grams — the same arithmetic as section 2. The recipe's own cooking fat is
          preselected in the Cooking Fat / Oil chips with its derived grams, so there is exactly one place
          where fat lives. The portion opens at the dish's standard portion, and the verified cooked-yield
          factor is shown and used, so the composer's math reproduces the curated numbers you saw in search.
        </Text>
        <Text style={p(theme)}>
          Everything is then yours to change: edit any ingredient's grams, remove or add ingredients (searched
          across your foods, IFCT and USDA — or create a missing one on the spot), change the fat and its
          grams, or pick a different cooking method. The arithmetic recomputes live: total raw mass × yield =
          cooked mass, and your final portion's share of that cooked mass sets the kcal, protein, carbs and
          fat shown. Saving logs "My Version" as a household dish and keeps it searchable for next time.
        </Text>
      </Block>

      <Block theme={theme} title="4 · Why a dish opens at 150 g — and what that number means">
        <Text style={p(theme)}>
          All nutrition in the app is stored per 100 g. The dish records additionally define a standard
          portion — the weight of one realistic serving: a roti 40 g, a katori of dal 150 g, a plate of
          khichdi 250 g, a samosa 85 g. That is the "150 g" you see: not a nutritional unit, just the starting
          serving estimate for bowl-shaped dishes, chosen to match a standard katori or plate.
        </Text>
        <Text style={p(theme)}>
          When you log a food, the app multiplies the per-100 g values by the grams you actually ate. The
          review screen shows this explicitly: Quantity (how many) × grams in 1 quantity = total grams. For
          piece foods like rotis you can say 2 × 40 g; for a heavier homemade roti just change the piece
          weight to 55 g. Ingredient weights inside a recipe scale the same way — they are shown per serving
          and the totals follow.
        </Text>
      </Block>

      <Block theme={theme} title="5 · What is verified, and what happens when something is missing">
        <Text style={p(theme)}>
          A dish only shows deterministic numbers when its recipe passes the full gate: every slot mapped to a
          real food id, every fraction verified, yield and portion calibrated, and the arithmetic reproducible
          in tests. Anything that fails stays out of your face instead of shipping a confident-looking guess.
          When you search something the dish base does not know, the decomposer lets you build the estimate
          from ingredients and a cooking method yourself — the same arithmetic, your assumptions. Custom
          ingredients you create live in your own database and behave exactly like corpus rows.
        </Text>
      </Block>
    </ScrollView>
  )
}

function Block({ theme, title, children }: { theme: Theme; title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text style={[type.bodyStrong, { color: theme.text }]}>{title}</Text>
      <View style={{ gap: space.sm }}>{children}</View>
    </View>
  )
}

const p = (theme: Theme): StyleProp<TextStyle> =>
  [type.caption, { color: theme.text, lineHeight: 20 }]
