#!/usr/bin/env node
/**
 * Codex CLI bridge — a local OpenAI-compatible HTTP gateway in front of the
 * Codex CLI (https://github.com/openai/codex), so a client that already
 * speaks the OpenAI chat-completions dialect (the Nut AI app's reseller /
 * custom base-URL path) can use a locally-authenticated `codex` binary as
 * its model backend. ZERO runtime dependencies: node:http + child_process
 * only.
 *
 * What it does per POST /v1/chat/completions:
 *   - flattens the OpenAI messages array into a single `codex exec` prompt
 *     (exec is single-shot; the convention is documented in README.md),
 *   - writes inline data:-URL image parts to a per-request temp dir and
 *     passes them via the official `-i/--image` flag of `codex exec`,
 *   - runs `codex exec --json --ephemeral --skip-git-repo-check -s read-only`
 *     with the prompt on stdin, cwd = the temp dir (so codex never ingests
 *     repository files from wherever the bridge was started),
 *   - parses the JSONL event stream (shapes live-verified against codex-cli
 *     0.160.0) into a chat.completion response, or SSE chunks when
 *     stream:true,
 *   - maps failures honestly: status text from stdout JSONL (`turn.failed`,
 *     where 0.160.0 --json carries it) or stderr (`ERROR: unexpected status
 *     …`, the non-json shape) → 401/403/404/429/5xx envelopes, timeout →
 *     504, exit 0 without a final message → 502.
 *
 * Security model: binds 127.0.0.1 by default; `--token` adds a shared-secret
 * Bearer check for LAN exposure. The bridge stores NO credentials of its own
 * — the codex CLI's own login (`codex login` / OPENAI_API_KEY) is the only
 * auth to the model backend, and it never flows through this process.
 */
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_PORT = 8471
const DEFAULT_TIMEOUT_MS = 120_000
const MAX_BODY_BYTES = 25 * 1024 * 1024 // images ride in the body; match a big scan payload
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024 // per-stream cap on captured codex output

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const opts = {
    port: DEFAULT_PORT,
    host: '127.0.0.1',
    token: process.env.CODEX_BRIDGE_TOKEN || null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    codexBin: process.env.CODEX_BRIDGE_CODEX_BIN || 'codex',
    models: [],
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--port') opts.port = Number(argv[++i])
    else if (a === '--host') opts.host = argv[++i]
    else if (a === '--token') opts.token = argv[++i]
    else if (a === '--timeout-ms') opts.timeoutMs = Number(argv[++i])
    else if (a === '--codex-bin') opts.codexBin = argv[++i]
    else if (a === '--model') opts.models.push(...String(argv[++i]).split(',').filter(Boolean))
    else if (a === '--help' || a === '-h') {
      console.log(`Codex CLI bridge — OpenAI-compatible local gateway over \`codex exec\`.

Usage: node server.mjs [options]

  --port <n>          listen port (default ${DEFAULT_PORT})
  --host <addr>       bind address (default 127.0.0.1; LAN IPs expose the bridge)
  --token <secret>    require Authorization: Bearer <secret> on every request
  --timeout-ms <n>    kill codex after n ms per request (default ${DEFAULT_TIMEOUT_MS})
  --codex-bin <path>  codex executable (default: PATH lookup)
  --model <id>        advertise a model on /v1/models (repeatable / comma-separated)
`)
      process.exit(0)
    } else {
      console.error(`unknown option: ${a}`)
      process.exit(2)
    }
  }
  if (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535) {
    console.error('--port must be a valid port number')
    process.exit(2)
  }
  return opts
}

// ---------------------------------------------------------------------------
// OpenAI messages → codex exec prompt (documented convention, see README)
// ---------------------------------------------------------------------------

/** Flatten content into text; collect image_url parts. Returns {text, images}. */
function flattenContent(content) {
  if (typeof content === 'string') return { text: content, images: [] }
  if (!Array.isArray(content)) return { text: '', images: [] }
  const textParts = []
  const images = []
  for (const part of content) {
    if (part?.type === 'text' && typeof part.text === 'string') textParts.push(part.text)
    else if (part?.type === 'image_url' && part.image_url?.url) images.push(part.image_url.url)
  }
  return { text: textParts.join('\n'), images }
}

/**
 * Multi-turn convention: codex exec is single-shot, so the conversation is
 * flattened into one prompt — system messages become an Instructions block,
 * prior turns become a labeled transcript, and the LAST user message is
 * passed as the plain task at the end.
 */
export function buildPrompt(messages) {
  const instructions = []
  const transcript = []
  let finalUser = ''
  for (const msg of messages) {
    const { text } = flattenContent(msg.content)
    if (msg.role === 'system') instructions.push(text)
    else if (msg.role === 'assistant') transcript.push(`Assistant: ${text}`)
    else if (msg.role === 'user') {
      if (finalUser) transcript.push(`User: ${finalUser}`)
      finalUser = text
    }
  }
  const parts = []
  if (instructions.length) parts.push(`Instructions:\n${instructions.join('\n')}`)
  if (transcript.length) parts.push(`Conversation so far:\n${transcript.join('\n')}`)
  parts.push(finalUser)
  return parts.join('\n\n')
}

// ---------------------------------------------------------------------------
// codex exec plumbing
// ---------------------------------------------------------------------------

/** Spawn `codex exec --json …` with the prompt on stdin. Resolves on exit. */
function runCodex({ codexBin, prompt, model, imageFiles, timeoutMs, cwd }) {
  return new Promise((resolveP) => {
    const args = ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only']
    // "codex" is the bridge's own always-valid id meaning "let the CLI pick".
    if (model && model !== 'codex') args.push('-m', model)
    for (const f of imageFiles) args.push('-i', f)
    let child
    try {
      child = spawn(codexBin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      // Synchronous spawn failure (bad binary path) — resolve, never crash the bridge.
      resolveP({ exitCode: -1, stdout: '', stderr: `codex could not be spawned: ${err.message}`, killed: false, spawnError: true })
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
      child.kill('SIGKILL')
    }, timeoutMs)

    let stdout = ''
    let stderr = ''
    let killed = false
    controller.signal.addEventListener('abort', () => {
      killed = true
    })
    const onStream = (chunk, add) => {
      if (add.length + chunk.length > MAX_CAPTURE_BYTES) return // ponytail: drop overflow, exit code still decides
      add(chunk)
    }
    child.stdout.on('data', (d) => onStream(d.toString(), (c) => (stdout += c)))
    child.stderr.on('data', (d) => onStream(d.toString(), (c) => (stderr += c)))
    child.on('error', (err) => {
      clearTimeout(timer)
      resolveP({ exitCode: -1, stdout, stderr: `${stderr}\n${err.message}`, killed, spawnError: true })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolveP({ exitCode: code ?? -1, stdout, stderr, killed })
    })

    child.stdin.on('error', () => {}) // EPIPE if codex dies early — the exit code tells the story
    child.stdin.end(prompt)
  })
}

/**
 * Parse JSONL events. Returns the final agent_message text, usage from
 * turn.completed, and the last failure detail (turn.failed / error events).
 * Non-JSON lines (banner noise on stdout) are skipped — observed from the
 * real CLI: stdout is JSONL under --json, but resilience is cheap and honest
 * here.
 */
export function parseCodexEvents(stdout) {
  let text = ''
  let usage = null
  let failure = null
  for (const line of stdout.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('{')) continue
    let ev
    try {
      ev = JSON.parse(t)
    } catch {
      continue
    }
    if (ev.type === 'item.completed' && ev.item?.type === 'agent_message' && typeof ev.item.text === 'string') {
      text = ev.item.text
    }
    // Failure detail: 0.160.0 --json runs end with a turn.failed carrying the
    // status text (live-verified), with error/item.completed(error) events
    // along the way. Keep the LAST one — it is the final diagnostic.
    if (ev.type === 'turn.failed' && typeof ev.error?.message === 'string') failure = ev.error.message
    else if (ev.type === 'error' && typeof ev.message === 'string') failure = ev.message
    else if (ev.type === 'item.completed' && ev.item?.type === 'error' && typeof ev.item.message === 'string') {
      failure = ev.item.message
    }
    if (ev.type === 'turn.completed') {
      if (ev.usage && typeof ev.usage.input_tokens === 'number') {
        usage = {
          prompt_tokens: ev.usage.input_tokens,
          completion_tokens: ev.usage.output_tokens ?? 0,
          total_tokens: (ev.usage.input_tokens ?? 0) + (ev.usage.output_tokens ?? 0),
        }
      }
    }
  }
  return { text, usage, failure }
}

/**
 * Map a failed codex run to an honest HTTP status. The status text is looked
 * for in BOTH channels: under --json the real CLI carries it on stdout JSONL
 * (turn.failed / error events) while stderr holds only tracing logs; without
 * --json the "ERROR: unexpected status …" lines land on stderr.
 */
export function failureStatus({ stderr, stdout, killed, spawnError }) {
  if (spawnError) return { status: 500, note: 'codex binary could not be executed.' }
  if (killed) return { status: 504, note: 'codex exec did not finish within the bridge timeout (child killed).' }
  const { failure } = parseCodexEvents(stdout || '')
  const hay = [failure, stderr || ''].filter(Boolean).join('\n')
  const m = hay.match(/unexpected status (\d{3})/)
  if (m) {
    const status = Number(m[1])
    const note = failure ?? hay.trim().split('\n').pop()
    return { status, note }
  }
  if (/not logged in|credentials|api key/i.test(hay)) return { status: 401, note: hay.trim() || 'codex is not authenticated.' }
  return { status: 500, note: hay.trim().split('\n').pop() || 'codex exited nonzero without a diagnostic.' }
}

function errorEnvelope(status, message, code) {
  return {
    status,
    body: { error: { message, type: status < 500 ? 'invalid_request_error' : 'server_error', code } },
  }
}

// ---------------------------------------------------------------------------
// JSON mode (response_format)
// ---------------------------------------------------------------------------

const JSON_INSTRUCTION =
  '\n\nRespond with a single JSON value only — no prose before or after it, no markdown fences.'

/** Minimal honest extraction: fenced block first, else outermost {…}/[…]. */
export function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fence ? fence[1] : text
  const start = candidate.search(/[{[]/)
  if (start === -1) return null
  const close = candidate[start] === '{' ? '}' : ']'
  const end = candidate.lastIndexOf(close)
  if (end <= start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}

/**
 * ponytail: only TOP-LEVEL required keys are checked — a full JSON Schema
 * validator is a dependency and a rewrite; upgrade if a consumer needs it.
 */
export function schemaProblems(value, schema) {
  const required = schema?.schema?.required ?? schema?.required
  if (!Array.isArray(required)) return []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return required.map((k) => `missing required key "${k}" (output is not a JSON object)`)
  }
  return required.filter((k) => !(k in value)).map((k) => `missing required key "${k}"`)
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const JSON_HEADERS = { 'content-type': 'application/json' }

function sendJson(res, status, body) {
  res.writeHead(status, JSON_HEADERS)
  res.end(JSON.stringify(body))
}

function readBody(req, res) {
  return new Promise((resolveP) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY_BYTES) {
        sendJson(res, 413, { error: { message: 'request body too large', type: 'invalid_request_error', code: 'body_too_large' } })
        req.destroy()
        resolveP(null)
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolveP(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => resolveP(null))
  })
}

/**
 * Decode data: URLs into temp files; remote http(s) image URLs are rejected
 * with the clean unsupported envelope — an image is never silently dropped.
 */
async function materializeImages(images, dir) {
  const files = []
  for (const url of images) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url)
    if (!m) {
      return { error: errorEnvelope(400, 'This bridge cannot pass image URLs to codex: only inline base64 data: URLs are supported; remote http(s) image URLs are not supported by codex exec. The image was NOT dropped silently — the request was refused.', 'image_unsupported') }
    }
    const mime = m[1] || 'application/octet-stream'
    const b64 = m[3].replace(/\s/g, '')
    const buf = Buffer.from(b64, 'base64')
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) {
      return { error: errorEnvelope(400, `Image payload is empty or exceeds the ${MAX_IMAGE_BYTES} byte bridge limit.`, 'image_unsupported') }
    }
    const ext = mime.includes('png') ? 'png' : mime.includes('gif') ? 'gif' : mime.includes('webp') ? 'webp' : 'jpg'
    const file = path.join(dir, `image-${files.length}.${ext}`)
    await writeFile(file, buf)
    files.push(file)
  }
  return { files }
}

/** Wire a chat completion through codex exec. */
async function handleChat(res, opts, rawBody) {
  let req
  try {
    req = JSON.parse(rawBody)
  } catch {
    return sendJson(res, 400, { error: { message: 'request body is not valid JSON', type: 'invalid_request_error', code: 'bad_request' } })
  }
  if (!Array.isArray(req.messages)) {
    return sendJson(res, 400, { error: { message: 'messages must be an array', type: 'invalid_request_error', code: 'bad_request' } })
  }
  const model = typeof req.model === 'string' && req.model ? req.model : 'codex'

  const rf = req.response_format
  const jsonMode = rf && (rf.type === 'json_object' || rf.type === 'json_schema')
    ? rf.type === 'json_schema' ? { schema: rf.json_schema } : { schema: null }
    : null

  const prompt = buildPrompt(req.messages)
  const imageUrls = []
  for (const msg of req.messages) imageUrls.push(...flattenContent(msg.content).images)

  // Compute the ENTIRE response while the temp dir exists, remove the dir
  // (image temp files) BEFORE any bytes go out, then send. This keeps the
  // cleanup race-free: a client can never observe its own image files.
  const dir = await mkdtemp(path.join(tmpdir(), 'codex-bridge-'))
  let payload
  try {
    let imageFiles = []
    let requestError = null
    if (imageUrls.length) {
      const made = await materializeImages(imageUrls, dir)
      if (made.error) requestError = made.error
      else imageFiles = made.files
    }
    if (requestError) {
      payload = requestError
    } else {
      const run = await runCodex({
        codexBin: opts.codexBin,
        prompt: jsonMode ? prompt + JSON_INSTRUCTION : prompt,
        model,
        imageFiles,
        timeoutMs: opts.timeoutMs,
        cwd: dir,
      })
      payload = req.stream ? { sse: ssePayload(run, model, jsonMode) } : completePayload(run, model, jsonMode)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }

  if (payload.sse !== undefined) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    res.end(payload.sse)
    return
  }
  return sendJson(res, payload.status, payload.body)
}

/** One SSE chat.completion.chunk frame. */
function chunkFrame(id, created, model, { content, finishReason }) {
  return (
    'data: ' +
    JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: content === undefined ? {} : { content }, finish_reason: finishReason ?? null }],
    }) +
    '\n\n'
  )
}

function sseErrorEvent(message, code) {
  return 'data: ' + JSON.stringify({ error: { message, type: 'server_error', code } }) + '\n\n' + 'data: [DONE]\n\n'
}

/**
 * stream:true payload. A 200 + SSE always goes out; failures ride the stream
 * as an error event followed by [DONE] (the SSE convention the app's
 * XHR-SSE reader tolerates). ponytail: codex exec does not expose reliable
 * token-by-token deltas on stdout, so the completed message is replayed in
 * ~1KB chunks — upgrade to forwarding item.updated deltas if a consumer
 * needs true incremental latency.
 */
function ssePayload(run, model, jsonMode) {
  const id = 'chatcmpl-' + Math.random().toString(36).slice(2)
  const created = Math.floor(Date.now() / 1000)

  const events = parseCodexEvents(run.stdout)
  if (run.exitCode !== 0 || events.failure) {
    const f = failureStatus(run)
    return sseErrorEvent(f.note, 'codex_failure')
  }
  const { text, usage } = events
  if (!text) return sseErrorEvent('codex exited successfully but produced no final message.', 'no_final_message')

  let content = text
  if (jsonMode) {
    const parsed = extractJson(text)
    if (parsed === null) return sseErrorEvent('codex output could not be parsed as JSON (JSON mode was requested).', 'json_parse_failed')
    if (jsonMode.schema) {
      const problems = schemaProblems(parsed, jsonMode.schema)
      if (problems.length) return sseErrorEvent(`codex output failed the requested response_format schema: ${problems.join('; ')}.`, 'schema_validation_failed')
    }
    content = JSON.stringify(parsed)
  }

  let sse = ''
  for (let i = 0; i < content.length; i += 1024) {
    sse += chunkFrame(id, created, model, { content: content.slice(i, i + 1024) })
  }
  sse += chunkFrame(id, created, model, { finishReason: 'stop' })
  if (usage) {
    sse += 'data: ' + JSON.stringify({ id, object: 'chat.completion.chunk', created, model, usage, choices: [] }) + '\n\n'
  }
  return sse + 'data: [DONE]\n\n'
}

function completePayload(run, model, jsonMode) {
  // A failed turn is a failed turn even if the CLI exited 0 — map it through
  // the same honest failure path instead of inventing a 502.
  const events = parseCodexEvents(run.stdout)
  if (run.exitCode !== 0 || events.failure) {
    const f = failureStatus(run)
    const env = f.status === 504
      ? errorEnvelope(504, f.note, 'codex_timeout')
      : errorEnvelope(f.status, `codex exec failed: ${f.note}`, `codex_${f.status}`)
    return { status: env.status, body: env.body }
  }
  const { text, usage } = events
  if (!text) {
    const env = errorEnvelope(502, 'codex exited successfully but produced no final message (its output was not a parseable answer).', 'no_final_message')
    return { status: env.status, body: env.body }
  }
  let content = text
  if (jsonMode) {
    const parsed = extractJson(text)
    if (parsed === null) {
      const env = errorEnvelope(502, 'codex output could not be parsed as JSON (JSON mode was requested). Raw output was not discarded — this is an honest failure, not a retry.', 'json_parse_failed')
      return { status: env.status, body: env.body }
    }
    if (jsonMode.schema) {
      const problems = schemaProblems(parsed, jsonMode.schema)
      if (problems.length) {
        const env = errorEnvelope(500, `codex output failed the requested response_format schema: ${problems.join('; ')}.`, 'schema_validation_failed')
        return { status: env.status, body: env.body }
      }
    }
    content = JSON.stringify(parsed)
  }
  return {
    status: 200,
    body: {
      id: 'chatcmpl-' + Math.random().toString(36).slice(2),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      ...(usage ? { usage } : {}),
    },
  }
}

function authorize(req, opts) {
  if (!opts.token) return true
  const header = req.headers.authorization || ''
  return header === `Bearer ${opts.token}`
}

export function createBridgeServer(opts) {
  const server = http.createServer(async (req, res) => {
    if (!authorize(req, opts)) {
      return sendJson(res, 401, { error: { message: 'missing or invalid bearer token', type: 'invalid_request_error', code: 'unauthorized' } })
    }
    const url = new URL(req.url, 'http://x')
    if (req.method === 'GET' && (url.pathname === '/v1/models' || /^\/v1\/models\/.+/.test(url.pathname))) {
      const idFromPath = /^\/v1\/models\/(.+)$/.exec(url.pathname)?.[1]
      // Any id is accepted: the bridge forwards -m VERBATIM and codex/the
      // backend is the authority on availability. "codex" = CLI default.
      if (idFromPath) {
        const id = decodeURIComponent(idFromPath)
        return sendJson(res, 200, { id, object: 'model', owned_by: 'codex-cli-bridge' })
      }
      const modelIds = ['codex', ...opts.models]
      return sendJson(res, 200, {
        object: 'list',
        data: modelIds.map((mid) => ({ id: mid, object: 'model', owned_by: 'codex-cli-bridge' })),
      })
    }
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const raw = await readBody(req, res)
      if (raw === null) return
      return handleChat(res, opts, raw)
    }
    return sendJson(res, 404, { error: { message: `no bridge route for ${req.method} ${url.pathname}`, type: 'invalid_request_error', code: 'not_found' } })
  })
  server.bridgeOptions = opts
  return server
}

export function startBridge(opts) {
  // Loopback is the safe default: an omitted --host must never silently
  // expose the bridge on every interface. Same defaults apply when the
  // bridge is embedded (tests) rather than started through parseArgs.
  const withDefaults = {
    ...opts,
    host: opts.host ?? '127.0.0.1',
    port: opts.port ?? DEFAULT_PORT,
    token: opts.token ?? null,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    codexBin: opts.codexBin ?? 'codex',
    models: opts.models ?? [],
  }
  return new Promise((resolveP, rejectP) => {
    const server = createBridgeServer(withDefaults)
    server.once('error', rejectP)
    server.listen(withDefaults.port, withDefaults.host, () => {
      const addr = server.address()
      resolveP({
        server,
        port: typeof addr === 'object' ? addr.port : withDefaults.port,
        host: withDefaults.host,
        close: () => new Promise((done) => server.close(done)),
      })
    })
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const opts = parseArgs(process.argv.slice(2))
  startBridge(opts).then(({ port }) => {
    console.log(`codex-bridge listening on http://${opts.host}:${port}/v1 (token ${opts.token ? 'required' : 'not required'}, timeout ${opts.timeoutMs}ms, models: ${['codex', ...opts.models].join(', ')})`)
  })
}
