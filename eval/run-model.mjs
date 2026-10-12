/**
 * Live prompt eval against the aicredits.in gateway (owner request, 2026-10-12).
 *
 * Mirrors the app's GATEWAY wire mode EXACTLY (src/inference/pathA/calls/scan.ts):
 *   - system message = the real SYSTEM_PROMPT from @nutai/prompt
 *   - user message = schema-as-TEXT contract + USER_INSTRUCTION + image
 *   - response_format {type:'json_object'}, stream:true, max_tokens 8192
 *   - SSE folded back to an envelope, finish_reason==='length' = truncation
 * Then scores with the app's own validators: validateWithRepair +
 * payloadValidationIssues (the exact gates a scan must pass).
 *
 * Usage:
 *   node eval/run-model.mjs [--models id,id] [--images a,b] [--out report.json]
 * Reads the key from NUTAI_EVAL_KEY (never committed).
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')

const { SYSTEM_PROMPT, USER_INSTRUCTION } = await import(path.join(root, 'packages/prompt/dist/index.js'))
const { VISION_WIRE_SCHEMA } = await import(path.join(root, 'packages/core-schema/dist/index.js'))
const { sanitizeJsonSchemaForWire, schemaContractBlock } = await import(path.join(root, 'packages/prompt/dist/index.js'))
const { validatePayload, payloadValidationIssues } = await import(path.join(root, 'packages/pipeline/dist/index.js'))
const { repairVisionPayload } = await import(path.join(root, 'packages/pipeline/dist/index.js'))

const KEY = process.env.NUTAI_EVAL_KEY
if (!KEY) {
  console.error('Set NUTAI_EVAL_KEY')
  process.exit(1)
}
const BASE = process.env.NUTAI_EVAL_BASE ?? 'https://aicredits.in/v1'
const MODELS = process.env.NUTAI_EVAL_MODELS
  ? process.env.NUTAI_EVAL_MODELS.split(',')
  : [
      'google/gemma-3-12b-it',
      'inclusionai/ling-3.0-flash-vl',
      'google/gemini-2.5-flash-lite',
      'google/gemini-2.5-flash',
      'openai/gpt-4o-mini',
      'google/gemma-3-27b-it',
      'qwen/qwen3-vl-8b-instruct',
    ]

// The app sends ONE preprocessed image; here the raw test photos ride as-is
// (they are large; downscale to keep the request near the app's post-preprocess size).
const IMAGES = (process.env.NUTAI_EVAL_IMAGES
  ? process.env.NUTAI_EVAL_IMAGES.split(',')
  : ['test1.jpg', 'test2.jpg', 'test3.jpg']).map((n) => path.join(root, 'docs/image tests', n))

/** Downscale + re-encode to ~1280px JPEG via the system Python (PIL ships in this container). */
async function toDataUri(imagePath) {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  const out = `/tmp/eval-${path.basename(imagePath)}.jpg`
  await run('python3', [
    '-c',
    `from PIL import Image; im=Image.open(${JSON.stringify(imagePath)}); im.thumbnail((1280,1280)); im.convert('RGB').save(${JSON.stringify(out)}, 'JPEG', quality=88)`,
  ])
  const buf = await readFile(out)
  return `data:image/jpeg;base64,${buf.toString('base64')}`
}

/** The exact instruction-side payload a gateway scan builds (providers.ts + schema-compat.ts). */
function buildGatewayBody(model, dataUri) {
  const sanitized = sanitizeJsonSchemaForWire(VISION_WIRE_SCHEMA)
  const contract = schemaContractBlock(sanitized)
  const text = `${contract}\n\n${USER_INSTRUCTION}`
  return {
    model,
    max_tokens: 8192,
    stream: true,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text },
          { type: 'image_url', image_url: { url: dataUri } },
        ],
      },
    ],
  }
}

/** Stream + fold SSE into a chat-completions envelope (mirror of foldSseToEnvelope). */
async function callModel(model, dataUri) {
  const started = Date.now()
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildGatewayBody(model, dataUri)),
    signal: AbortSignal.timeout(180_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { kind: 'http-error', status: res.status, detail: body.slice(0, 300), ms: Date.now() - started }
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let reasoning = ''
  let finish = null
  let usage = null
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]') continue
      try {
        const json = JSON.parse(payload)
        const choice = json.choices?.[0]
        if (choice?.delta?.content) content += choice.delta.content
        if (choice?.delta?.reasoning_content) reasoning += choice.delta.reasoning_content
        if (choice?.delta?.reasoning) reasoning += choice.delta.reasoning
        if (choice?.finish_reason) finish = choice.finish_reason
        if (json.usage) usage = json.usage
      } catch {
        /* keep-alive comment or partial line */
      }
    }
  }
  return { kind: 'ok', content, reasoning, finish, usage, ms: Date.now() - started }
}

/** Pull the outermost JSON object (mirrors the app's extractor). */
function extractJsonObject(text) {
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

const report = []
for (const model of MODELS) {
  for (const imagePath of IMAGES) {
    const label = `${model} × ${path.basename(imagePath)}`
    process.stdout.write(`→ ${label} … `)
    let dataUri
    try {
      dataUri = await toDataUri(imagePath)
    } catch (e) {
      console.log('IMAGE PREP FAILED', e.message)
      continue
    }
    let call
    try {
      call = await callModel(model, dataUri)
    } catch (e) {
      console.log('CALL FAILED', String(e).slice(0, 120))
      report.push({ model, image: path.basename(imagePath), outcome: 'call-failed', detail: String(e).slice(0, 200) })
      continue
    }
    if (call.kind !== 'ok') {
      console.log(`HTTP ${call.status}`)
      report.push({ model, image: path.basename(imagePath), outcome: 'http-error', status: call.status, detail: call.detail })
      continue
    }
    if (call.finish === 'length' || call.finish === 'MAX_TOKENS') {
      console.log(`TRUNCATED (${call.ms}ms)`)
      report.push({ model, image: path.basename(imagePath), outcome: 'truncated', ms: call.ms, usage: call.usage, contentChars: call.content.length })
      continue
    }
    const raw = extractJsonObject(call.content)
    if (!raw) {
      console.log(`NO-JSON (${call.ms}ms, ${call.content.length} chars)`)
      report.push({
        model,
        image: path.basename(imagePath),
        outcome: 'no-json',
        ms: call.ms,
        usage: call.usage,
        excerpt: call.content.slice(0, 200),
      })
      continue
    }
    // The app's gate: strict parse → deterministic repair → re-parse.
    const direct = await import(path.join(root, 'packages/core-schema/dist/index.js'))
    const strictOk = direct.VisionPayloadZ ? direct.VisionPayloadZ.safeParse(raw).success : null
    const repaired = validatePayload(raw)
    const issues = payloadValidationIssues(raw)
    // Post-repair residue: what the repair layer could NOT map — the exact
    // targets for the next repair/prompt iteration (the raw issues above are
    // the model's drift; these are the gate's remaining blockers).
    const residue = repaired ? [] : payloadValidationIssues(repairVisionPayload(raw))
    const itemNameCount = Array.isArray(raw?.items) ? raw.items.length : -1
    const names = Array.isArray(raw?.items) ? raw.items.map((i) => i?.name).join(', ') : ''
    console.log(
      `${repaired ? 'PASS' : 'SCHEMA-FAIL'} (strict:${strictOk ? 'ok' : 'repaired-only'}, items:${itemNameCount}, ${Math.round(call.ms / 100) / 10}s) ${names.slice(0, 80)}`,
    )
    report.push({
      model,
      image: path.basename(imagePath),
      outcome: repaired ? 'pass' : 'schema-fail',
      strictParse: strictOk,
      repaired: Boolean(repaired),
      validationIssues: issues,
      postRepairIssues: residue,
      items: itemNameCount,
      itemNames: names.slice(0, 200),
      isFood: raw?.is_food,
      summary: typeof raw?.summary === 'string' ? raw.summary.slice(0, 160) : null,
      ms: call.ms,
      usage: call.usage,
      reasoningChars: call.reasoning?.length ?? 0,
      // The raw answer rides along so a schema-fail can be replayed offline
      // against new repair logic without re-billing the gateway.
      rawPayload: repaired ? undefined : raw,
    })
  }
}

const outArg = process.argv.indexOf('--out')
const outFile = outArg > -1 ? process.argv[outArg + 1] : '/tmp/eval-report.json'
await writeFile(outFile, JSON.stringify(report, null, 2))
console.log(`\nReport → ${outFile}`)

// Summary table
const byModel = new Map()
for (const row of report) {
  const m = byModel.get(row.model) ?? { pass: 0, fail: 0, strict: 0, total: 0 }
  m.total++
  if (row.outcome === 'pass') m.pass++
  else m.fail++
  if (row.strictParse) m.strict++
  byModel.set(row.model, m)
}
console.log('\nMODEL                          PASS  STRICT  TOTAL')
for (const [model, m] of byModel) {
  console.log(`${model.padEnd(30)} ${String(m.pass).padStart(4)}  ${String(m.strict).padStart(6)}  ${String(m.total).padStart(5)}`)
}
