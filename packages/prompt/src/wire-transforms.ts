/**
 * Per-provider dialects of the wire schema.
 *
 * Each provider's structured-output mode accepts a DIFFERENT subset of JSON
 * Schema, and sending the wrong dialect is a structural 400 that arrives before
 * authentication — the exact failure mode that once made valid API keys look
 * rejected. These transforms are pure tree-walks over the draft-07 schema from
 * @nutai/core-schema, and the tests assert each provider's documented
 * constraints structurally so a regression is caught at test time, not as a
 * mystery 400 on a user's phone.
 *
 * Numeric and length bounds are enforced by the client-side Zod validator for
 * ALL providers uniformly — stripping them from a wire dialect loses nothing.
 */

type Node = Record<string, unknown>

const isObj = (v: unknown): v is Node => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Visit EVERY object node in the tree, not just the ones under known schema
 * keywords. zod-to-json-schema tucks subschemas into places a keyword allowlist
 * misses (additionalProperties-as-schema, definitions, patternProperties), and a
 * node the walk skips is a provider 400 the tests can't predict.
 */
function walk(node: unknown, visit: (n: Node) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (!isObj(node)) return
  visit(node)
  for (const v of Object.values(node)) {
    if (typeof v === 'object' && v !== null) walk(v, visit)
  }
}

function clone(schema: Record<string, unknown>): Node {
  return JSON.parse(JSON.stringify(schema)) as Node
}

const BOUND_KEYS = [
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern', 'format',
] as const

function stripKeys(n: Node, keys: readonly string[]): void {
  for (const k of keys) delete n[k]
}

/**
 * Anthropic structured outputs: rejects numeric/length bounds and pattern.
 * Everything else in the draft-07 output passes through.
 */
export function anthropicWireSchema(base: Record<string, unknown>): Record<string, unknown> {
  const out = clone(base)
  delete out['$schema']
  walk(out, (n) => stripKeys(n, BOUND_KEYS))
  return out
}

/**
 * OpenAI strict mode: every object must carry `additionalProperties: false` and
 * list EVERY property in `required` — optionality is expressed as a null type
 * union, never by omission. Bounds and pattern are stripped for the same reason
 * as Anthropic: acceptance varies by model generation, and the Zod validator
 * enforces them anyway.
 */
export function openAiWireSchema(base: Record<string, unknown>): Record<string, unknown> {
  const out = clone(base)
  delete out['$schema']
  walk(out, (n) => {
    stripKeys(n, BOUND_KEYS)
    if (n['type'] === 'object' && isObj(n['properties'])) {
      n['additionalProperties'] = false
      n['required'] = Object.keys(n['properties'])
    }
  })
  return out
}

/**
 * Gemini's responseSchema is an OpenAPI-3.0 subset: no additionalProperties, no
 * pattern/format/bounds, and nullability spelled `nullable: true` rather than a
 * type array containing "null".
 */
export function geminiWireSchema(base: Record<string, unknown>): Record<string, unknown> {
  const out = clone(base)
  delete out['$schema']
  walk(out, (n) => {
    stripKeys(n, BOUND_KEYS)
    delete n['additionalProperties']
    if (Array.isArray(n['type'])) {
      const types = n['type'].filter((t) => t !== 'null')
      if (types.length !== n['type'].length) n['nullable'] = true
      n['type'] = types.length === 1 ? types[0] : types
    }
    // anyOf: [X, {type:'null'}] is zod-to-json-schema's other nullable spelling.
    if (Array.isArray(n['anyOf'])) {
      const nonNull = n['anyOf'].filter((m) => !(isObj(m) && m['type'] === 'null'))
      if (nonNull.length === 1 && nonNull.length !== n['anyOf'].length) {
        const only = nonNull[0] as Node
        delete n['anyOf']
        Object.assign(n, only, { nullable: true })
        // The merged branch was cleaned on its own visit-to-come, but THIS node
        // already had its cleanup — re-strip what the merge just copied in.
        stripKeys(n, BOUND_KEYS)
        delete n['additionalProperties']
      }
    }
  })
  return out
}
