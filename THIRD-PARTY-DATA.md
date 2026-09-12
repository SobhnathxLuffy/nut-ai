# Third-Party Data Sources

This file tracks every non-application data source used or planned for use in
Nut AI, its license, provenance, and obligations.

> **Note:** Application source code is licensed under AGPL-3.0-or-later (see
> [LICENSE](LICENSE)). Data licenses are legally independent of the code
> license; neither discharges the other.

## Currently Bundled

### USDA FoodData Central

| Field | Value |
|-------|-------|
| **Source** | [USDA FoodData Central](https://fdc.nal.usda.gov/) |
| **Datasets used** | Foundation Foods, SR Legacy |
| **License** | Public domain (U.S. Government work) |
| **Import pipeline** | `tools/nutrition-data/src/build.mjs` |
| **Validation** | `tools/nutrition-data/src/golden-queries.mjs` (26 queries) |
| **Version tracking** | `build_manifest` table in `nutrition.db` |
| **Redistribution** | Permitted (public domain) |
| **Attribution** | "U.S. Department of Agriculture, Agricultural Research Service. FoodData Central." |
| **Obligations** | None beyond attribution (recommended) |

### IFCT (Indian Food Composition Tables)

| Field | Value |
|-------|-------|
| **Source** | [ICMR-NIN IFCT 2017](https://www.nin.res.in/ebooks/IFCT2017_16122024.pdf) |
| **Publisher** | Indian Council of Medical Research – National Institute of Nutrition |
| **License** | See permission note below |
| **Permission status** | **Project owner explicitly states permission to use and publicly upload IFCT data for this project** |
| **Adapter** | `IFCTSource` behind `NutritionSource` interface |
| **Import pipeline** | `tools/ifct-import/` |
| **Bundled scope** | 528 food items from IFCT 2017 Table 1: energy, protein, fat, carbohydrate, fibre, category, source code, provenance |
| **Source hash** | `e87629581a58faca286f4886504bc75f33d6d3771a50fb4e40e2afee2b2b32dd` |
| **Redistribution** | Authorized per owner's stated permission |
| **Attribution** | "T. Longvah, R. Ananthan, K. Bhaskarachary, K. Venkaiah. Indian Food Composition Tables. ICMR-NIN, 2017." |
| **Obligations** | Preserve attribution; record permission evidence; review before commercial redistribution |

The currently bundled `ifct.db` is generated from the official IFCT PDF and
contains all 528 food items from Table 1. IFCT micronutrient tables are deferred
to the Phase 8 micronutrient schema and reports work.

> **Permission evidence:** The project owner has explicitly authorized the use
> and public upload of IFCT data for this project. The permission evidence
> document should be attached to `docs/data/IFCT_INGESTION_AND_PERMISSION.md`
> by the owner. This authorization is recorded here as the basis for IFCT
> integration; it does not extend to unrelated third-party projects.

### Open Food Facts

| Field | Value |
|-------|-------|
| **Source** | [Open Food Facts](https://world.openfoodfacts.org/) |
| **License** | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) (database), [DbCL 1.0](https://opendatacommons.org/licenses/dbcl/1-0/) (individual contents) |
| **Adapter** | `OpenFoodFactsSource` behind `NutritionSource` interface |
| **Redistribution** | Permitted under ODbL (share-alike, attribution) |
| **Attribution** | "Open Food Facts contributors, https://openfoodfacts.org" |
| **Obligations** | ODbL share-alike for derivative databases; attribute; keep provenance separate |

### User-Created Foods

| Field | Value |
|-------|-------|
| **Source** | User input |
| **License** | User-owned |
| **Adapter** | `UserFoodSource` |
| **Storage** | `user_foods` table in `user.db` |

### Household Recipes

| Field | Value |
|-------|-------|
| **Source** | User input and household learning |
| **License** | User-owned |
| **Adapter** | `HouseholdRecipeSource` |
| **Storage** | Recipe tables in `user.db` |

## Provenance Rules

1. Every nutrition record retains its `source`, `source_id`, and import version.
2. Sources are NEVER collapsed into an opaque master table.
3. Each source adapter provides `getLicenseInfo()` with redistribution terms.
4. The resolver may search all sources, but results carry their source identity.
5. Historical log items snapshot the per-100g values AND source provenance.
6. Open Food Facts data must remain separable due to ODbL share-alike.

## Release Checklist

Before any public or commercial distribution:

- [x] Verify project-owner IFCT authorization is recorded
- [x] Verify IFCT attribution appears in app and repository
- [x] Verify ODbL compliance for Open Food Facts adapter use
- [x] Verify USDA attribution in app About screen
- [x] Verify each source's redistribution terms are tracked
- [x] Verify no unrelated unlicensed data was inadvertently included in IFCT artifact
- [x] Verify `build_manifest` records source versions and hashes
- [ ] Attach external IFCT permission correspondence before wider public/commercial release if required
