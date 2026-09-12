# IFCT Ingestion Pipeline and Permission Record

## Permission Status

**The project owner explicitly states that permission has been obtained to use
and publicly upload the IFCT data for this project.**

This authorization is the basis for IFCT integration in this repository.

## Current Repository State

The repository now contains a reproducible import of all **528 food items from
IFCT 2017 Table 1** into `apps/mobile/assets/ifct.db`.

Phase 2 intentionally imports the nutrients supported by the current nutrition
source contract: energy, protein, fat, carbohydrate, fibre, category, stable IFCT
food code, and source/provenance metadata. The remaining IFCT micronutrient
tables are not lost or forgotten; they require the Phase 8 micronutrient schema,
reporting UI, and validation work before they can be safely stored and displayed.

The two-row sample remains only as a development fixture at
`tools/ifct-import/fixtures/ifct-sample.csv`.

### Evidence Record

| Field | Value |
|-------|-------|
| **Data source** | Indian Food Composition Tables (IFCT) 2017 |
| **Publisher** | ICMR-NIN (Indian Council of Medical Research – National Institute of Nutrition) |
| **Reference** | T. Longvah, R. Ananthan, K. Bhaskarachary, K. Venkaiah |
| **Version** | IFCT 2017 (published 2017, PDF updated 16 Dec 2024) |
| **URL** | https://www.nin.res.in/ebooks/IFCT2017_16122024.pdf |
| **Source PDF SHA-256** | `e87629581a58faca286f4886504bc75f33d6d3771a50fb4e40e2afee2b2b32dd` |
| **Imported pages** | Table 1, PDF pages 41-68 |
| **Imported food items** | 528 |
| **Normalized CSV SHA-256** | `894006e2aa34ffcb510debff88705e78c40df88e2e7dcee65bbd944f9fcc4785` |
| **Authorization** | Project owner's explicit statement |
| **Scope** | Use and public upload for this project |
| **Evidence attachment** | Project-owner authorization recorded in this repository; attach external correspondence here before wider public/commercial release if required |

> **Owner follow-up:** Attach the permission evidence document to this file or
> link it from here. The evidence should include the scope of authorization,
> any conditions, and attribution requirements. Do not include unrelated
> personal details in the public record.

## Attribution Requirements

When IFCT data is bundled or displayed:

```
Nutrition data source: Indian Food Composition Tables (IFCT) 2017.
T. Longvah, R. Ananthan, K. Bhaskarachary, K. Venkaiah.
Published by ICMR–National Institute of Nutrition, Hyderabad.
```

## Ingestion Pipeline Design

### Location

```
tools/ifct-import/
  src/
    extract-pdf.mjs    # Extract Table 1 from the official IFCT PDF
    build.mjs          # Generate ifct.db SQLite database
    golden-queries.mjs # Validation queries for built database
  data/
    ifct-2017-macros.csv
    ifct-2017-macros.csv.manifest.json
  fixtures/
    ifct-sample.csv    # tiny development fixture only
```

### Pipeline Steps

1. **Extract**: Extract food records from IFCT Table 1
   - Food code
   - Food name
   - Category/group
   - Nutrient values per 100g currently supported by the app contract
     (energy, protein, fat, carbohydrate, fibre)
   - Units and basis

2. **Validate**: Check each record
   - Required fields present
   - Nutrient values within physically possible ranges
   - Unit consistency
   - No duplicate entries
   - Source food code preserved

3. **Normalize**: Standardize for the nutrition schema
   - Convert IFCT kilojoules to kcal using kJ / 4.184
   - Standardize food names
   - Generate source metadata

4. **Build**: Create `ifct.db`
   - Same schema as `nutrition.db` (foods, food_micros, food_portions, etc.)
   - `source = 'ifct'` for all records
   - `license = 'ifct-authorized'`
   - Build manifest with source hash, version, build date
   - FTS5 indexes

5. **Validate**: Run golden queries
   - Common Indian foods resolve correctly
   - Nutrient values match source data
   - No zero-calorie main dishes
   - Coverage statistics reported

### Source Manifest

```json
{
  "source": "IFCT",
  "version": "2017",
  "publisher": "ICMR-NIN",
  "record_count": "528",
  "build_date": "<ISO date>",
  "source_hash": "<SHA-256 of source data>",
  "schema_version": "<nutrition schema version>",
  "permission": "project-owner-authorized",
  "attribution": "T. Longvah et al., IFCT 2017, ICMR-NIN"
}
```

### Integration with App

- IFCT data loaded via `IFCTSource` adapter in `packages/nutrition-sources/`
- Preferred for Indian foods (higher priority than USDA for relevant items)
- USDA remains fallback for items not in IFCT
- Each resolved food carries `source: 'ifct'` and `source_id` for traceability
- App displays the bundled IFCT and USDA corpus counts in Food Database
- App displays IFCT attribution in Food Database and Profile/About surfaces

### Release Checks

Before distributing IFCT data:

- [x] Project-owner authorization recorded
- [x] Attribution text appears in app About/Food Database surfaces
- [x] Attribution text in THIRD-PARTY-DATA.md
- [x] Source manifest generated and verified
- [x] Golden queries pass
- [x] Build is reproducible from the official PDF
- [x] No unrelated unlicensed data included in the IFCT artifact
- [ ] Attach external permission correspondence before wider public/commercial release if required
