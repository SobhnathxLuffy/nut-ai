# Indian Food Data and Recipes

## Overview
This specification covers the integration of the Indian Food Composition Tables (IFCT), the formulation of an Indian food ontology, and a robust recipe engine that accurately models Indian cooking practices, yield, and measures.

## 1. IFCT Ingestion Pipeline (`tools/ifct-import/`)
A dedicated ingestion script translates the official IFCT PDF into the Nut AI canonical format.
- **Source Manifest**: Defines mapping of IFCT codes to canonical nutrients.
- **Validation**: Ensures macro sums (Prot+Carb+Fat+Ash+Water) do not exceed 100g.
- **Normalization**: Standardizes unit names and limits precision to 2 decimal places.
- **Golden Queries**: A test suite that runs against the imported data to verify expected outputs (e.g., searching "Toor dal" must return the correct IFCT legume ID).
- **Phase 2 Scope**: All 528 food items from IFCT 2017 Table 1 are imported for energy, protein, fat, carbohydrate, and fibre lookup. Micronutrient tables are deferred to the Phase 8 micronutrient storage/reporting work.

## 2. Indian Food Ontology
Provides semantic mapping for diverse Indian cuisines.
- **Canonical Concepts**: The base ingredient (e.g., `legume_pigeon_pea`).
- **Aliases**: English (Pigeon Pea), Hinglish (Arhar dal, Toor dal), Hindi transliterations (Tuvar), and regional variations.
- **Dish Families**: Groupings like `flatbreads` (roti, chapati, phulka, paratha, naan), `yogurt_based` (dahi, curd, raita), `lentils` (dal, sambar, rasam).
- **Resolution Example**: The text "2 katori tuvar dal" resolves to `legume_pigeon_pea` + cooked state + `household_measure_katori`.

## 3. Preparation Differences
The engine must preserve and respect how preparation alters nutrient density:
- **Raw vs. Cooked**: Hydration changes weight significantly. (e.g., raw rice vs. boiled rice).
- **Frying vs. Roasting**: Oil absorption varies.

## 4. Indian Household Measures
Since scales are rarely used in standard Indian households, accurate volumetric estimations are required:
- `Katori` (standard Indian bowl): ~150ml
- `Bowl` (badi katori): ~250ml
- `Glass` (steel tumbler): ~200ml
- `Cup` (standard or chai cup): ~100-240ml
- `tsp` / `tbsp` / `ladle` (karchhi) / `handful` (mutthi) / `piece/count` (for rotis, idlis).
- **Density/Portion References**: Maps these volumes to cooked weights (e.g., 1 katori cooked rice = ~120g).

## 5. Recipe Model
Models the physics of cooking to calculate precise final macros.

```typescript
interface Recipe {
  id: string;
  name: string;
  ingredients: RecipeIngredient[];
  preparation: 'boiled' | 'fried' | 'roasted' | 'raw';
  added_oil_g: number;
  added_water_g: number;
  final_cooked_weight_g: number;
  servings: number;
}
```

**Calculation Formula**:
`serving_nutrient = (sum(ingredient_nutrients) + oil_nutrients) * (serving_weight / final_cooked_weight)`

## 6. Household Learning & Provenance
Nut AI learns the specific definitions of household measures for a given user.
- **Provenance States**:
  - `Measured`: User explicitly weighed their "katori".
  - `Confirmed`: User agreed with an AI suggestion.
  - `Learned`: AI inferred over multiple logs.
  - `Inferred`: Deduced from context.
  - `Generic`: IFCT average.
  - `Unknown`: Requires clarification.

## 7. Versioned Household Recipes
As a user modifies their standard recipe (e.g., changing from 2 tbsp to 1 tbsp oil in their daily dal), the recipe is versioned. Logs from last month use Version 1; today's logs use Version 2.

## 8. Owner's IFCT Permission Evidence Handling
*Implementation Note*: If IFCT data requires specific usage attribution or permissions in a commercial app, the engine must store evidence of compliance, display appropriate attributions in the UI when viewing details, and provide an offline copy of the license.
