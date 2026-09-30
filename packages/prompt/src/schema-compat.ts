/**
 * Wire-schema sanitation for gateways whose structured-output implementation
 * cannot parse the full JSON Schema dialect zodToJsonSchema emits.
 *
 * THE BUG THIS FIXES (observed live on aicredits.in, a Go-based OpenAI-compatible
 * reseller): our nullable fields render as `"type": ["string", "null"]`, and
 * their jsonschema library cannot unmarshal a type ARRAY — every scan request
 * died with HTTP 400 ("cannot unmarshal array into ... .type of type
 * jsonschema.DataType") BEFORE reaching the model. The app's structural-400
 * fallback then rescanned with NO schema, and the free-form answer drifted from
 * the payload contract (missing schema_version, model_gram_estimate, enum
 * fields), failing Zod: "the model answered in a shape we could not use".
 *
 * Two transformations, both semantics-preserving for OUR validator:
 *
 *   1. `"type": [T, "null"]`  ->  `"type": T`
 *      The Zod side stays `.nullable()` and still accepts whatever arrives;
 *      the model simply stops being OFFERED null. A string field answers "",
 *      a number answers 0 — clamp handles both.
 *
 *   2. `anyOf: [T, { type: "null" }]`  ->  `T`
 *      Same story for schemas where nullability is a union instead of a type
 *      array. A union with any other shape is left untouched — we only strip
 *      the null branch we know how to strip.
 *
 * Deliberately conservative: unknown keywords pass through untouched, the
 * input is never mutated, and a malformed schema comes back as `null` so the
 * caller can degrade to prompt-only mode rather than send garbage.
 */

export type JsonSchemaNode = Record<string, unknown>

export function sanitizeJsonSchemaForWire(schema: JsonSchemaNode): JsonSchemaNode | null {
  try {
    return sanitizeNode(schema) as JsonSchemaNode
  } catch {
    return null
  }
}

function isPlainNullBranch(node: unknown): boolean {
  return (
    node != null &&
    typeof node === 'object' &&
    !Array.isArray(node) &&
    (node as JsonSchemaNode)['type'] === 'null'
  )
}

function sanitizeNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeNode)
  if (node == null || typeof node !== 'object') return node

  const src = node as JsonSchemaNode
  const out: JsonSchemaNode = {}

  // The $schema key is meta, not schema — some gateways reject it outright.
  if (src['$schema'] !== undefined && Object.keys(src).length === 1) return {}

  for (const [key, value] of Object.entries(src)) {
    if (key === '$schema') continue

    // Case 1: type-array nullability.
    if (key === 'type' && Array.isArray(value)) {
      const nonNull = value.filter((t) => t !== 'null')
      out['type'] = nonNull.length > 0 ? nonNull[0] : value[0]
      continue
    }

    // Case 2: anyOf/oneOf with exactly one real branch plus a null branch.
    if ((key === 'anyOf' || key === 'oneOf') && Array.isArray(value)) {
      const real = value.filter((branch) => !isPlainNullBranch(branch))
      const onlyNull = real.length === 0
      if (onlyNull) {
        // A union of nothing but null — keep it verbatim; nothing to strip.
        out[key] = value
        continue
      }
      if (real.length === 1) {
        const merged = sanitizeNode(real[0])
        if (merged != null && typeof merged === 'object' && !Array.isArray(merged)) {
          // Promote the surviving branch, re-merging any sibling keywords
          // (e.g. description) that rode alongside the anyOf.
          for (const [k, v] of Object.entries(src)) {
            if (k !== key && k !== '$schema' && out[k] === undefined) out[k] = sanitizeNode(v)
          }
          Object.assign(out, merged)
          continue
        }
      }
      out[key] = sanitizeNode(value)
      continue
    }

    out[key] = sanitizeNode(value)
  }
  return out
}

/**
 * The fallback contract: when a gateway rejects structured-output mode
 * entirely, the scan degrades to `json_object` mode with the schema shipped
 * AS TEXT inside the instruction. This header makes that contract explicit
 * and demands every key — free-form answers were drifting (missing
 * schema_version, enums, gram estimates) and failing client-side Zod.
 */
export function schemaContractBlock(schema: JsonSchemaNode): string {
  return [
    'OUTPUT CONTRACT — your reply must be one JSON object valid against this JSON Schema.',
    'Every listed property is REQUIRED: never omit a key. When a value is unknown, use',
    'the empty string, 0, or the literal enum value that fits best — never null, never',
    'a different shape. Do not add properties.',
    '<schema>',
    JSON.stringify(schema),
    '</schema>',
  ].join('\n')
}
