# Codex CLI bridge — OpenAI-compatible local gateway over `codex exec`

A zero-dependency Node server (`node:http` + `child_process` only, stdlib
imports — nothing to install) that exposes the locally-installed
[OpenAI Codex CLI](https://github.com/openai/codex) as an
OpenAI-compatible `/v1` HTTP API, so a client that already speaks the
chat-completions dialect — including **Nut AI's custom base-URL provider
path** — can use a locally-authenticated `codex` binary as its model backend.

The bridge stores **no credentials of its own**: the Codex CLI's own login
(`codex login`, or a key the CLI picks up) is the only auth to the model
backend, and it never flows through this process. Optional shared-secret
`--token` protects LAN exposure. No secrets are stored, logged, or written
by the bridge.

- Version researched: **@openai/codex 0.160.0** (`npm view @openai/codex version`, 2026-10-05)
- Capability evidence classes: **VERIFIED-BY-INSTALLATION** (probed on the
  installed binary), **DOC-CITED** (official docs/help, not live-provable
  without credentials), **NOT TESTED** (needs credentials).

## Quickstart

```bash
npm install -g @openai/codex        # 0.160.0 at time of writing
codex login                         # once, on this machine (or see auth below)
node tools/codex-bridge/server.mjs  # → codex-bridge listening on http://127.0.0.1:8471/v1
```

Smoke test from the same machine:

```bash
curl -s http://127.0.0.1:8471/v1/models
curl -s http://127.0.0.1:8471/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"codex","messages":[{"role":"user","content":"Reply with exactly: hello"}]}'
```

### Options

```
--port <n>          listen port (default 8471)
--host <addr>       bind address (default 127.0.0.1; a LAN IP exposes the bridge)
--token <secret>    require Authorization: Bearer <secret> on every request
--timeout-ms <n>    kill codex after n ms per request (default 120000)
--codex-bin <path>  codex executable (default: PATH lookup)
--model <id>        advertise a model on /v1/models (repeatable / comma-separated)
```

## Connecting the app to the bridge

The bridge itself binds loopback by default and takes `--host`/`--token` for
wider exposure, **but the app has a deliberate security rule (P2-11,
`src/inference/base-url.ts`): plain `http://` is only kept for LOOPBACK
hosts — `http://<LAN-IP>:8471/v1` from a phone on the same Wi-Fi is silently
upgraded to `https://`, which this bridge does not speak.** So today:

- **iOS simulator** (shares the Mac's network): base URL
  `http://localhost:8471/v1` works as-is.
- **Android device/emulator**: `adb reverse tcp:8471 tcp:8471` (USB) maps the
  device's `localhost:8471` to the computer's bridge, then base URL
  `http://localhost:8471/v1` works.
- **Physical phone over Wi-Fi (LAN IP)**: needs one of (a) a one-line
  `base-url.ts` exception treating private LAN addresses like loopback —
  recommended follow-up, owner decision, it relaxes a security rule; or
  (b) TLS in front of the bridge (a reverse proxy with a cert the phone
  trusts). Neither is implemented here; documented honestly rather than
  shipped broken.

Steps that work today (simulator / adb-reverse path):

1. Bridge running on the computer: `node tools/codex-bridge/server.mjs`
   (loopback is enough for both paths above — no `--host` needed).
2. In **Nut AI → Provider settings → Advanced** (the "Using a reseller?"
   area of the credential form):
   - **Reseller base URL**: `http://localhost:8471/v1` (OpenAI-compatible
     custom base URL — the same field a reseller gateway uses; the app allows
     plain `http://` for exactly this loopback-gateway case).
   - **Reseller model ID**: `codex` (bridge convention: "let the CLI pick"),
     or any model id — it is forwarded verbatim as `codex exec -m <id>`.
   - **API credential**: any non-empty value (e.g. `bridge`) when the bridge
     runs without `--token`; with `--token`, paste the token.

`--token` still matters: whenever the bridge is exposed beyond loopback
(`--host 0.0.0.0` for anything that talks to it over the network), require a
shared secret.

## How it maps to the Codex CLI

Per `POST /v1/chat/completions` the bridge:

1. Flattens the OpenAI `messages` array into a single `codex exec` prompt:
   system messages become an `Instructions:` block, prior turns a labeled
   `Conversation so far:` transcript, the last user message the task.
   (`codex exec` is single-shot; `codex exec resume` exists but is not used —
   keeping the bridge stateless.)
2. Writes inline `data:`-URL image parts to a per-request temp dir and passes
   them via the official `-i/--image` flag. Remote `http(s)` image URLs are
   **refused with a clean 400 `image_unsupported` envelope — never silently
   dropped** (codex `exec -i` takes local files).
3. Spawns `codex exec --json --ephemeral --skip-git-repo-check -s read-only`
   with the prompt on **stdin** and `cwd` = the temp dir, so codex never
   ingests repository files from wherever the bridge was started.
4. Parses the JSONL event stream on stdout into a `chat.completion` response
   (or SSE `chat.completion.chunk` frames when `stream: true`).
5. Maps failures honestly (see matrix below). The temp dir is removed before
   any response bytes go out.

## Capability matrix (codex-cli 0.160.0)

| Capability | Verdict | Evidence |
|---|---|---|
| Headless syntax | `codex exec [OPTIONS] [PROMPT]`; with no prompt arg, instructions are read from stdin | VERIFIED-BY-INSTALLATION (`exec --help`; live run showed `Reading prompt from stdin…` and the request reached the backend) |
| Text input | stdin piping works; prompt+stdin combined mode also exists | VERIFIED-BY-INSTALLATION (live unauthenticated runs) |
| Model selection | `-m/--model <MODEL>` flag; default model observed `gpt-6.1-sol` | VERIFIED-BY-INSTALLATION (flag parsed; banner printed) / actual model routing NOT TESTED (needs credentials) |
| Image input | **SUPPORTED on `exec`**: `-i, --image <FILE>...` (local files, variadic) | VERIFIED-BY-INSTALLATION at flag level (parsed; file accepted; run proceeded). End-to-end image understanding NOT TESTED (needs credentials) |
| Structured JSON | Native: `--output-schema <FILE>` (JSON Schema for the final response) + `-o/--output-last-message <FILE>`. Bridge uses prompt-guided JSON mode + fenced/outermost extraction + top-level required-key validation (works everywhere, no schema file lifecycle) | VERIFIED-BY-INSTALLATION (flags parsed, schema file read). Schema *enforcement* NOT TESTED (needs credentials); agent_message/usage event shapes DOC-CITED (official docs sample) |
| JSONL events | `codex exec --json` → stdout JSONL: `thread.started`, `turn.started`, `error`, `item.completed`, `turn.failed`, `turn.completed` | VERIFIED-BY-INSTALLATION (failure-path events captured live) / success-path `turn.completed` usage shape DOC-CITED |
| Streaming | CLI: JSONL progress on stdout (item deltas per docs). Bridge: replays the completed message as ~1 KB SSE chunks | DOC-CITED (docs) / bridge SSE AUTOMATICALLY VERIFIED by tests |
| Auth modes | `codex login` (ChatGPT) / `codex logout` / `codex login status`; `CODEX_API_KEY` env for automation; `~/.codex/auth.json` holds tokens | `login status` → `Not logged in`, exit 1 VERIFIED-BY-INSTALLATION; API-key modes DOC-CITED (official docs) |
| Exit codes | failures observed → **exit 1** (region 403, missing git check, no prompt); `codex --version`/`--help` → 0; success-with-answer → 0 expected | VERIFIED-BY-INSTALLATION for all failure paths; success exit code NOT TESTED (needs credentials) |
| Timeouts | **No timeout flag on `exec`** (0.160.0 help); CLI retries the backend ~5× itself (~7 s) then fails. The bridge enforces `--timeout-ms` and kills the child → HTTP 504 | VERIFIED-BY-INSTALLATION (flag absence; retry loop observed). Bridge kill path AUTOMATICALLY VERIFIED by tests |
| Sandbox | `exec` defaults to read-only; `-s read-only\|workspace-write\|danger-full-access` | DOC-CITED (docs + help); `sandbox: read-only` banner VERIFIED-BY-INSTALLATION |
| Git check | Refuses to run outside a git repo without `--skip-git-repo-check` | VERIFIED-BY-INSTALLATION (live: `Not inside a trusted directory…`, exit 1) |
| Session persistence | `--ephemeral` runs without persisting session files; `codex exec resume --last` exists | Flag accepted VERIFIED-BY-INSTALLATION; persistence behavior DOC-CITED |
| Config | `~/.codex/config.toml` + `-c key=value` dotted overrides + `CODEX_HOME`; `codex features list` | DOC-CITED (help; developers.openai.com/codex/config-reference — page fetch blocked by bot protection in this environment) |

### Failure mapping (bridge → HTTP)

| Codex symptom | HTTP |
|---|---|
| `unexpected status 401/403/404/429 …` on stdout JSONL (`turn.failed`, the 0.160.0 `--json` shape) or stderr (`ERROR: …`, non-json shape) | 401 / 403 / 404 / 429 with the codex detail verbatim |
| Bridge timeout (child killed) | 504 `codex_timeout` |
| Nonzero exit, no recognizable status | 500 with the stderr tail |
| Exit 0 but no final agent message | 502 `no_final_message` |
| Exit 0 but `turn.failed` event | same honest status mapping as a nonzero exit |
| JSON mode requested, output unparseable / schema key missing | 502 / 500, raw output not discarded silently |
| `stream: true` + failure | 200 + SSE error event + `[DONE]` (never a fake completion) |

## Endpoints

- `GET /v1/models` — `codex` (CLI default) plus any `--model` list.
- `GET /v1/models/<id>` — any id accepted; codex validates `-m` server-side.
- `POST /v1/chat/completions` — OpenAI chat-completions shape; honors
  `stream`, `response_format: {type: 'json_object'|'json_schema'}`, inline
  `image_url` data-URL parts; `usage` filled when codex reports it.

## Limitations

- Single-shot per request: no server-side conversation state; multi-turn is
  the flattened-transcript convention above.
- SSE is a replay of the completed message, not true token deltas (codex
  `item.updated` forwarding is the upgrade path).
- JSON mode is prompt-guided with bridge-side validation, not the native
  `--output-schema` enforcement (documented trade-off; `--output-schema` is
  the drop-in stricter upgrade).
- Body ≤ 25 MB, image ≤ 10 MB, captured codex output ≤ 2 MB per stream.
- One codex child per request, no pooling/queueing.
- The bridge binds loopback by default and never logs prompts or tokens.

## Troubleshooting

- **401 / `Not logged in`** — run `codex login` on the bridge machine (or set
  `CODEX_API_KEY` for the bridge process). `codex login status` must print
  logged-in state before the bridge can answer.
- **403 "Country, region, or territory not supported"** — the OpenAI backend
  refused the request (observed for unauthenticated runs from some regions);
  the bridge forwards it verbatim.
- **504** — codex did not finish inside `--timeout-ms`; raise it for long
  scans (remember the CLI's own ~5× retry loop runs first).
- **`Not inside a trusted directory`** — codex was invoked without
  `--skip-git-repo-check` (the bridge always passes it; check custom
  `--codex-bin` wrappers).
- **Phone can't reach the bridge** — it is bound to loopback unless `--host`
  is given; expose on LAN only together with `--token`.
- **`codex` not found / wrong binary** — pass `--codex-bin /path/to/codex`.
- **Model id rejected** — `GET /v1/models/<id>` always answers 200 (the
  bridge forwards ids verbatim); the real validation happens inside codex and
  surfaces as the mapped 4xx envelope.

## Tests

```bash
npx vitest run tools/codex-bridge   # 36 integration tests over the HTTP seam
```

The suite drives the bridge through its public HTTP surface with a mock
`codex` binary (`test/mock-codex.mjs`) reproducing the JSONL shapes captured
from real 0.160.0. Positive-path live-codex calls remain NOT TESTED in this
environment (no credentials).
