# Source Manifest Template

Use this template for every nutrition data source.

```json
{
  "source_name": "<human-readable name>",
  "source_id": "<machine identifier>",
  "version": "<version string or date>",
  "publisher": "<publishing organization>",
  "url": "<canonical URL>",
  "license": "<license identifier>",
  "license_url": "<URL to license text>",
  "permission_status": "public-domain | open-license | authorized | pending",
  "record_count": "<number of food records>",
  "nutrient_coverage": {
    "energy": true,
    "protein": true,
    "fat": true,
    "carbohydrate": true,
    "fiber": "<true | partial | false>",
    "micronutrients": "<true | partial | false>"
  },
  "build_date": "<ISO 8601 date of build>",
  "source_hash": "<SHA-256 hash of source data files>",
  "artifact_hash": "<SHA-256 hash of generated .db file>",
  "schema_version": "<nutrition schema version used>",
  "build_tool": "<path to build script>",
  "golden_queries": "<path to validation queries>",
  "attribution_text": "<required attribution text>",
  "redistribution_conditions": "<conditions for redistribution>",
  "notes": "<any additional notes>"
}
```

## Required Fields

Every source manifest MUST include:

- `source_name` and `source_id`
- `version` and `build_date`
- `license` and `permission_status`
- `record_count`
- `source_hash` (for reproducibility)
- `attribution_text`

## Usage

1. Generate a manifest during each `data:build` or `ifct:build` run
2. Store in the built `.db` file's `build_manifest` table
3. Also save as a standalone JSON file alongside the `.db` artifact
4. Reference in `THIRD-PARTY-DATA.md`
