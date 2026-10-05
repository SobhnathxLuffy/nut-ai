#!/usr/bin/env node
/**
 * Mock `codex` binary for the bridge integration tests.
 *
 * Emits the same JSONL event stream the real `codex exec --json` produces
 * (shapes verified against codex-cli 0.160.0: thread.started / turn.started /
 * item.completed agent_message / turn.completed usage, and `ERROR: …` lines
 * on stderr with exit 1 for failures). The active scenario comes from
 * MOCK_CODEX_SCENARIO; argv + stdin are recorded into MOCK_CODEX_RECORD_DIR
 * so tests can assert exactly what the bridge passed to the CLI.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const scenario = process.env.MOCK_CODEX_SCENARIO ?? 'text'
const recordDir = process.env.MOCK_CODEX_RECORD_DIR
if (recordDir) {
  mkdirSync(recordDir, { recursive: true })
  writeFileSync(join(recordDir, 'argv.json'), JSON.stringify(process.argv.slice(2)))
}

// Read the prompt the bridge wrote to stdin (mirrors real exec stdin mode).
let stdin = ''
if (!process.stdin.isTTY) {
  stdin = readFileSync(0, 'utf8')
}
if (recordDir) writeFileSync(join(recordDir, 'stdin.txt'), stdin)

const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\n')

const thread = () => emit({ type: 'thread.started', thread_id: 'mock-thread-1' })
const turn = () => emit({ type: 'turn.started' })
const agentMessage = (id, text, type) =>
  emit({ type, item: { id, type: 'agent_message', text } })

/** Record any -i image files the bridge passed, with their exact bytes. */
function recordImages() {
  const files = []
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '-i') {
      const p = process.argv[i + 1]
      try {
        statSync(p)
        files.push({ path: p, bytes: readFileSync(p).toString('base64') })
      } catch {
        files.push({ path: p, missing: true })
      }
    }
  }
  if (recordDir && files.length) writeFileSync(join(recordDir, 'images.json'), JSON.stringify(files))
  return files
}

const fail = (statusText) => {
  process.stderr.write(`ERROR: unexpected status ${statusText}\n`)
  process.exit(1)
}

const scenarios = {
  text: () => {
    thread(); turn()
    agentMessage('item_0', 'hello', 'item.started')
    agentMessage('item_0', 'hello', 'item.completed')
    emit({ type: 'turn.completed', usage: { input_tokens: 12, cached_input_tokens: 0, output_tokens: 5 } })
  },
  long: () => {
    thread(); turn()
    const text = 'Lorem ipsum dolor sit amet. '.repeat(2000)
    agentMessage('item_0', text, 'item.completed')
    emit({ type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 8000 } })
  },
  multiturn: () => {
    recordImages()
    thread(); turn()
    agentMessage('item_0', 'context received', 'item.completed')
  },
  // Non-JSON stdout lines (banner noise) mixed with a valid final message —
  // the bridge must tolerate the noise and still recover the answer.
  'garbage-ok': () => {
    process.stdout.write('OpenAI Codex v0.0.0-mock\n--------\n')
    thread(); turn()
    process.stdout.write('warning: something unparseable\n')
    agentMessage('item_0', 'recovered answer', 'item.completed')
  },
  // Exit 0 but no agent_message anywhere — the honest-failure case.
  'no-message': () => {
    process.stdout.write('not json at all\n')
    thread(); turn()
  },
  timeout: () => {
    thread(); turn()
    setTimeout(() => process.exit(0), 10_000)
  },
  'auth-fail': () => fail('401 Unauthorized: Invalid API key.'),
  'region-403': () => fail('403 Forbidden: Country, region, or territory not supported.'),
  'model-404': () => fail('404 Not Found: model not-a-real-model does not exist.'),
  'rate-429': () => fail('429 Too Many Requests: rate limit exceeded'),
  // ---- Live-captured shapes from the REAL codex-cli 0.160.0 binary ----
  // Under --json the failure detail rides STDOUT as JSONL (error events +
  // turn.failed) and stderr stays clean — captured verbatim from an
  // unauthenticated run (2026-10-05). The bridge must map these, not fall
  // back to a generic 500.
  'jsonl-region-403': () => {
    thread(); turn()
    emit({ type: 'error', message: 'Reconnecting... 2/5 (unexpected status 403 Forbidden: Country, region, or territory not supported, url: wss://api.openai.com/v1/responses)' })
    emit({ type: 'item.completed', item: { id: 'item_0', type: 'error', message: 'Falling back from WebSockets to HTTPS transport. unexpected status 403 Forbidden: Country, region, or territory not supported, url: wss://api.openai.com/v1/responses' } })
    emit({ type: 'turn.failed', error: { message: 'unexpected status 403 Forbidden: Country, region, or territory not supported, url: https://api.openai.com/v1/responses' } })
    process.exit(1)
  },
  'jsonl-auth-401': () => {
    thread(); turn()
    emit({ type: 'turn.failed', error: { message: 'unexpected status 401 Unauthorized: Invalid API key.' } })
    process.exit(1)
  },
  // Defensive honesty lock: a failed turn is a failure even if a CLI build
  // ever exits 0 alongside it.
  'turn-failed-exit-zero': () => {
    thread(); turn()
    emit({ type: 'turn.failed', error: { message: 'unexpected status 403 Forbidden: Country, region, or territory not supported.' } })
    // exit 0 on purpose
  },
  // Nonzero exit with NO recognizable status anywhere — generic 500.
  crash: () => {
    thread(); turn()
    process.stderr.write("thread 'mock' panicked at 'sandbox internally inconsistent'")
    process.exit(1)
  },
  'json-fenced': () => {
    thread(); turn()
    agentMessage('item_0', 'Sure!\n```json\n{"dish":"dal","grams":150}\n```', 'item.completed')
  },
  // Emits JSON that is valid but missing a required key — the request's
  // json_schema decides whether the bridge accepts it.
  'json-schema-missing': () => {
    thread(); turn()
    agentMessage('item_0', '{"dish":"dal"}', 'item.completed')
  },
  image: () => {
    const files = recordImages()
    thread(); turn()
    agentMessage('item_0', `image files seen: ${files.length}`, 'item.completed')
  },
  'sse-two-deltas': () => {
    thread(); turn()
    agentMessage('item_0', '', 'item.started')
    agentMessage('item_0', 'Hello', 'item.updated')
    setTimeout(() => {
      agentMessage('item_0', 'Hello world', 'item.completed')
      emit({ type: 'turn.completed', usage: { input_tokens: 7, output_tokens: 2 } })
    }, 60)
  },
}

if (!scenarios[scenario]) {
  process.stderr.write(`mock-codex: unknown scenario "${scenario}"\n`)
  process.exit(2)
}
scenarios[scenario]()
