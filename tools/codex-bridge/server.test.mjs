/**
 * Integration tests for the Codex CLI bridge.
 *
 * The bridge is tested through its public HTTP surface (the seam): requests
 * go in over HTTP, a MOCK codex binary (test/mock-codex.mjs, placed on the
 * bridge via the codexBin option) produces controlled stdout/stderr/exit
 * codes, and the OpenAI-shaped response is asserted. The mock reproduces the
 * JSONL event shapes observed from real codex-cli 0.160.0 (see README
 * capability matrix); positive-path LIVE codex calls remain NOT TESTED (no
 * credentials in this environment).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { parseArgs, startBridge } from './server.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const MOCK = resolve(here, 'test', 'mock-codex.mjs')

let recordDir
let server // default instance
let authServer // --token instance
let timeoutServer // tiny-timeout instance
let baseUrl
let authUrl
let timeoutUrl

const userMsg = (text) => ({ role: 'user', content: text })

async function chat(body, opts = {}) {
  return fetch(`${opts.base ?? baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

async function jsonOf(res) {
  expect(res.headers.get('content-type')).toContain('application/json')
  return res.json()
}

beforeAll(async () => {
  chmodSync(MOCK, 0o755)
  server = await startBridge({ port: 0, codexBin: MOCK, timeoutMs: 5000, models: ['gpt-5.1-codex'] })
  authServer = await startBridge({ port: 0, codexBin: MOCK, timeoutMs: 5000, token: 'bridge-secret-token' })
  timeoutServer = await startBridge({ port: 0, codexBin: MOCK, timeoutMs: 250 })
  baseUrl = `http://127.0.0.1:${server.port}`
  authUrl = `http://127.0.0.1:${authServer.port}`
  timeoutUrl = `http://127.0.0.1:${timeoutServer.port}`
})

afterAll(async () => {
  await Promise.all([server.close(), authServer.close(), timeoutServer.close()])
})

beforeEach(() => {
  // Record dirs live in the OS temp dir — never inside the repo checkout.
  recordDir = mkdtempSync(join(tmpdir(), 'codex-bridge-record-'))
  process.env.MOCK_CODEX_RECORD_DIR = recordDir
})

describe('GET /v1/models', () => {
  it('lists the configured models (plus the always-valid "codex" default)', async () => {
    const res = await fetch(`${baseUrl}/v1/models`)
    expect(res.status).toBe(200)
    const body = await jsonOf(res)
    expect(body.object).toBe('list')
    const ids = body.data.map((m) => m.id)
    expect(ids).toContain('codex')
    expect(ids).toContain('gpt-5.1-codex')
  })

  it('accepts any model id on the per-model retrieve (codex validates -m server-side)', async () => {
    const res = await fetch(`${baseUrl}/v1/models/gpt-5.1-mini`)
    expect(res.status).toBe(200)
    expect((await jsonOf(res)).id).toBe('gpt-5.1-mini')
  })
})

describe('TEXT: non-stream chat completions', () => {
  beforeEach(() => {
    process.env.MOCK_CODEX_SCENARIO = 'text'
  })

  it('maps a single user message to a chat.completion envelope', async () => {
    const res = await chat({ model: 'gpt-5.1-codex', messages: [userMsg('Reply with exactly: hello')] })
    expect(res.status).toBe(200)
    const body = await jsonOf(res)
    expect(body.object).toBe('chat.completion')
    expect(body.model).toBe('gpt-5.1-codex')
    expect(body.choices).toHaveLength(1)
    expect(body.choices[0].message.role).toBe('assistant')
    expect(body.choices[0].message.content).toBe('hello')
    expect(body.choices[0].finish_reason).toBe('stop')
  })

  it('passes the requested model through verbatim to codex exec -m', async () => {
    await chat({ model: 'gpt-5.1-codex', messages: [userMsg('hi')] })
    const argv = JSON.parse(readFileSync(join(recordDir, 'argv.json'), 'utf8'))
    const m = argv.indexOf('-m')
    expect(m).toBeGreaterThan(-1)
    expect(argv[m + 1]).toBe('gpt-5.1-codex')
  })

  it('model id "codex" means the CLI default: no -m flag is passed', async () => {
    await chat({ model: 'codex', messages: [userMsg('hi')] })
    const argv = JSON.parse(readFileSync(join(recordDir, 'argv.json'), 'utf8'))
    expect(argv).not.toContain('-m')
  })

  it('proves multi-turn context mapping (system + prior turns + final user message)', async () => {
    await chat({
      model: 'codex',
      messages: [
        { role: 'system', content: 'You count calories.' },
        userMsg('what did I eat?'),
        { role: 'assistant', content: 'one banana' },
        userMsg('how many kcal?'),
      ],
    })
    const stdin = readFileSync(join(recordDir, 'stdin.txt'), 'utf8')
    expect(stdin).toContain('You count calories.')
    expect(stdin).toContain('User: what did I eat?')
    expect(stdin).toContain('Assistant: one banana')
    expect(stdin).toContain('how many kcal?')
    // The final user turn is the actual task, not a transcript line.
    expect(stdin.indexOf('how many kcal?')).toBeGreaterThan(stdin.indexOf('Assistant: one banana'))
  })

  it('delivers a long response without truncation', async () => {
    process.env.MOCK_CODEX_SCENARIO = 'long'
    const res = await chat({ model: 'codex', messages: [userMsg('write a lot')] })
    const body = await jsonOf(res)
    const text = 'Lorem ipsum dolor sit amet. '.repeat(2000)
    expect(body.choices[0].message.content).toBe(text)
    expect(body.usage).toEqual({ prompt_tokens: 100, completion_tokens: 8000, total_tokens: 8100 })
  })

  it('maps turn.completed usage into OpenAI usage fields', async () => {
    const body = await jsonOf(await chat({ model: 'codex', messages: [userMsg('hi')] }))
    expect(body.usage).toEqual({ prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 })
  })

  it('tolerates non-JSON stdout noise and still recovers the answer', async () => {
    process.env.MOCK_CODEX_SCENARIO = 'garbage-ok'
    const body = await jsonOf(await chat({ model: 'codex', messages: [userMsg('hi')] }))
    expect(body.choices[0].message.content).toBe('recovered answer')
  })
})

describe('malformed / missing output — honest failure', () => {
  it('exit 0 with no agent message yields an honest 502 envelope', async () => {
    process.env.MOCK_CODEX_SCENARIO = 'no-message'
    const res = await chat({ model: 'codex', messages: [userMsg('hi')] })
    expect(res.status).toBe(502)
    const body = await jsonOf(res)
    expect(body.error.message).toMatch(/no final message/i)
  })
})

describe('STRUCTURED: JSON mode', () => {
  it('extracts fenced JSON from the codex output when JSON mode is requested', async () => {
    process.env.MOCK_CODEX_SCENARIO = 'json-fenced'
    const body = await jsonOf(
      await chat({
        model: 'codex',
        messages: [userMsg('give me json')],
        response_format: { type: 'json_object' },
      }),
    )
    expect(res_ok(body)).toBe(true)
    expect(JSON.parse(body.choices[0].message.content)).toEqual({ dish: 'dal', grams: 150 })
  })

  it('rejects output missing a json_schema required key with an honest 500', async () => {
    process.env.MOCK_CODEX_SCENARIO = 'json-schema-missing'
    const res = await chat({
      model: 'codex',
      messages: [userMsg('json please')],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'scan',
          strict: true,
          schema: { type: 'object', required: ['calories'], properties: { calories: { type: 'number' } } },
        },
      },
    })
    expect(res.status).toBe(500)
    const body = await jsonOf(res)
    expect(body.error.message).toMatch(/calories/)
  })
})

const res_ok = (body) => typeof body.choices?.[0]?.message?.content === 'string'

describe('failure mapping (exit codes + stderr → HTTP)', () => {
  const cases = [
    ['auth-fail', 401, /Invalid API key/i, 'auth'],
    ['region-403', 403, /Country, region/i, 'region'],
    ['model-404', 404, /not-a-real-model/i, 'model'],
    ['rate-429', 429, /rate limit/i, 'rate'],
  ]
  for (const [scenario, status, message, label] of cases) {
    it(`${label} failure → HTTP ${status} envelope carrying the codex detail`, async () => {
      process.env.MOCK_CODEX_SCENARIO = scenario
      const res = await chat({ model: 'codex', messages: [userMsg('hi')] })
      expect(res.status).toBe(status)
      const body = await jsonOf(res)
      expect(body.error.message).toMatch(message)
      expect(body.error.type).toBeTruthy()
      expect(body.error.code).toBeTruthy()
    })
  }

  it('an over-time codex child is killed and reported as 504', async () => {
    process.env.MOCK_CODEX_SCENARIO = 'timeout'
    const res = await chat({ model: 'codex', messages: [userMsg('hi')] }, { base: timeoutUrl })
    expect(res.status).toBe(504)
    expect((await jsonOf(res)).error.message).toMatch(/did not finish/i)
  })

  it('a nonzero exit with no recognizable status stays an honest generic 500', async () => {
    process.env.MOCK_CODEX_SCENARIO = 'crash'
    const res = await chat({ model: 'codex', messages: [userMsg('hi')] })
    expect(res.status).toBe(500)
    expect((await jsonOf(res)).error.message).toMatch(/panicked/i)
  })
})

describe('failure mapping — real codex-cli 0.160.0 --json shapes (live capture)', () => {
  // Captured verbatim from the installed 0.160.0 binary: under --json the
  // failure detail rides STDOUT as turn.failed / error JSONL events and the
  // stderr carries only tracing logs. The bridge must not fall back to a
  // generic 500 when stderr is silent.
  it('turn.failed 403 on a silent-stderr run → HTTP 403 with the url detail', async () => {
    process.env.MOCK_CODEX_SCENARIO = 'jsonl-region-403'
    const res = await chat({ model: 'codex', messages: [userMsg('hi')] })
    expect(res.status).toBe(403)
    const body = await jsonOf(res)
    expect(body.error.message).toMatch(/Country, region, or territory not supported/)
    expect(body.error.message).toMatch(/api\.openai\.com\/v1\/responses/)
  })

  it('turn.failed 401 on stdout → HTTP 401 (auth failure without stderr diagnostics)', async () => {
    process.env.MOCK_CODEX_SCENARIO = 'jsonl-auth-401'
    const res = await chat({ model: 'codex', messages: [userMsg('hi')] })
    expect(res.status).toBe(401)
    expect((await jsonOf(res)).error.message).toMatch(/Invalid API key/i)
  })

  it('a turn.failed is a failure even when the CLI exits 0', async () => {
    process.env.MOCK_CODEX_SCENARIO = 'turn-failed-exit-zero'
    const res = await chat({ model: 'codex', messages: [userMsg('hi')] })
    expect(res.status).toBe(403)
  })
})

describe('IMAGE: data-URL parts reach codex exec -i as temp files', () => {
  it('writes each data-URL image to a temp file passed via -i (officially supported flag)', async () => {
    process.env.MOCK_CODEX_SCENARIO = 'image'
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
    const body = await jsonOf(
      await chat({
        model: 'codex',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'what is in this photo?' },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } },
            ],
          },
        ],
      }),
    )
    expect(body.choices[0].message.content).toBe('image files seen: 1')
    const [img] = JSON.parse(readFileSync(join(recordDir, 'images.json'), 'utf8'))
    expect(img.missing).toBeUndefined()
    expect(Buffer.from(img.bytes, 'base64')).toEqual(png)
    // Temp file hygiene: the bridge removes its per-request temp dir.
    expect(existsSync(img.path)).toBe(false)
  })

  it('rejects remote http(s) image URLs with a clean unsupported envelope (never silently dropped)', async () => {
    process.env.MOCK_CODEX_SCENARIO = 'image'
    const res = await chat({
      model: 'codex',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'scan this' },
            { type: 'image_url', image_url: { url: 'https://example.com/food.jpg' } },
          ],
        },
      ],
    })
    expect(res.status).toBe(400)
    const body = await jsonOf(res)
    expect(body.error.code).toBe('image_unsupported')
    expect(body.error.message).toMatch(/image/i)
  })

  it('passes MULTIPLE images through as multiple -i temp files, then cleans them up', async () => {
    process.env.MOCK_CODEX_SCENARIO = 'image'
    const png = Buffer.from('89504e47', 'hex')
    const body = await jsonOf(
      await chat({
        model: 'codex',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${png.toString('base64')}` } },
            ],
          },
        ],
      }),
    )
    expect(body.choices[0].message.content).toBe('image files seen: 2')
    const argv = JSON.parse(readFileSync(join(recordDir, 'argv.json'), 'utf8'))
    expect(argv.filter((a) => a === '-i')).toHaveLength(2)
    const imgs = JSON.parse(readFileSync(join(recordDir, 'images.json'), 'utf8'))
    expect(imgs).toHaveLength(2)
    for (const img of imgs) {
      expect(img.missing).toBeUndefined()
      expect(existsSync(img.path)).toBe(false)
    }
  })

  it('an empty image payload is refused with the unsupported envelope, not forwarded', async () => {
    process.env.MOCK_CODEX_SCENARIO = 'image'
    const res = await chat({
      model: 'codex',
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,' } }] }],
    })
    expect(res.status).toBe(400)
    expect((await jsonOf(res)).error.code).toBe('image_unsupported')
  })

  it('an image over the 10 MB bridge limit is refused, not forwarded', async () => {
    process.env.MOCK_CODEX_SCENARIO = 'image'
    const big = Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64')
    const res = await chat({
      model: 'codex',
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${big}` } }] }],
    })
    expect(res.status).toBe(400)
    expect((await jsonOf(res)).error.code).toBe('image_unsupported')
  })
})

describe('SSE streaming (stream: true)', () => {
  it('delivers the answer as chunked SSE with finish_reason and [DONE]', async () => {
    process.env.MOCK_CODEX_SCENARIO = 'sse-two-deltas'
    const res = await chat({ model: 'codex', messages: [userMsg('hi')], stream: true })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const raw = await res.text()
    const events = raw
      .split('\n\n')
      .filter((b) => b.startsWith('data: '))
      .map((b) => b.slice(6))
    expect(events.at(-1)).toBe('[DONE]')
    const chunks = events.slice(0, -1).map((e) => JSON.parse(e))
    expect(chunks.length).toBeGreaterThan(1) // content chunks + finish chunk
    expect(chunks.every((c) => c.object === 'chat.completion.chunk')).toBe(true)

    const content = chunks
      .map((c) => c.choices?.[0]?.delta?.content ?? '')
      .join('')
    expect(content).toBe('Hello world')
    const finish = chunks.find((c) => c.choices?.[0]?.finish_reason === 'stop')
    expect(finish).toBeTruthy()
  })

  it('a codex failure during stream:true rides the SSE error event, never a lying 200 body', async () => {
    process.env.MOCK_CODEX_SCENARIO = 'jsonl-region-403'
    const res = await chat({ model: 'codex', messages: [userMsg('hi')], stream: true })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const events = (await res.text()).split('\n\n').filter((b) => b.startsWith('data: ')).map((b) => b.slice(6))
    expect(events.at(-1)).toBe('[DONE]')
    const err = JSON.parse(events[0])
    expect(err.error.message).toMatch(/Country, region/i)
  })

  it('JSON mode over SSE delivers the parsed JSON object as the streamed content', async () => {
    process.env.MOCK_CODEX_SCENARIO = 'json-fenced'
    const res = await chat({
      model: 'codex',
      messages: [userMsg('give me json')],
      response_format: { type: 'json_object' },
      stream: true,
    })
    const events = (await res.text()).split('\n\n').filter((b) => b.startsWith('data: ')).map((b) => b.slice(6))
    const chunks = events.slice(0, -1).map((e) => JSON.parse(e))
    const content = chunks.map((c) => c.choices?.[0]?.delta?.content ?? '').join('')
    expect(JSON.parse(content)).toEqual({ dish: 'dal', grams: 150 })
    expect(chunks.at(-1).choices[0].finish_reason).toBe('stop')
  })
})

describe('bridge security: optional shared-secret token', () => {
  it('rejects missing and wrong bearer tokens with 401 when --token is set', async () => {
    expect((await fetch(`${authUrl}/v1/models`)).status).toBe(401)
    const wrong = await chat({ model: 'codex', messages: [userMsg('hi')] }, { base: authUrl, token: 'nope-nope' })
    expect(wrong.status).toBe(401)
  })

  it('serves requests carrying the right token', async () => {
    process.env.MOCK_CODEX_SCENARIO = 'text'
    const res = await chat({ model: 'codex', messages: [userMsg('hi')] }, { base: authUrl, token: 'bridge-secret-token' })
    expect(res.status).toBe(200)
  })
})

describe('request hygiene', () => {
  it('a malformed JSON body gets a 400 envelope, not a crash', async () => {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    })
    expect(res.status).toBe(400)
    expect((await jsonOf(res)).error).toBeTruthy()
  })

  it('messages must be an array — 400 otherwise', async () => {
    const res = await chat({ model: 'codex', messages: 'hello' })
    expect(res.status).toBe(400)
  })

  it('the per-model retrieve and the chat endpoint keep the loopback bind', async () => {
    expect(server.host).toBe('127.0.0.1')
  })
})

describe('CLI parsing: loopback default + optional token/host/model flags', () => {
  it('defaults bind loopback on 8471 with no token', () => {
    const opts = parseArgs([])
    expect(opts.host).toBe('127.0.0.1')
    expect(opts.port).toBe(8471)
    expect(opts.token).toBeNull()
  })

  it('--host and comma-separated --model are honored', () => {
    const opts = parseArgs(['--host', '0.0.0.0', '--model', 'gpt-5.1-codex,gpt-5.1-mini'])
    expect(opts.host).toBe('0.0.0.0')
    expect(opts.models).toEqual(['gpt-5.1-codex', 'gpt-5.1-mini'])
  })
})
