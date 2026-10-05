# Codex CLI bridge (local OpenAI-compatible gateway)

A local development gateway that fronts the OpenAI Codex CLI with an
OpenAI-compatible `/v1` HTTP API, so Nut AI's custom base-URL provider path
(the reseller fields in the credential form) can talk to a
locally-authenticated `codex` binary.

Everything lives in [`tools/codex-bridge/`](../tools/codex-bridge/README.md):

- `tools/codex-bridge/server.mjs` — zero-dependency Node server
  (default `http://127.0.0.1:8471/v1`, optional `--host`/`--token`),
- `tools/codex-bridge/README.md` — quickstart, phone setup, capability
  matrix for codex-cli 0.160.0 with evidence classes, failure mapping,
  limitations, troubleshooting,
- `tools/codex-bridge/server.test.mjs` + `test/mock-codex.mjs` — integration
  tests over the HTTP seam (`npx vitest run tools/codex-bridge`).

The app needs no code path beyond the existing reseller base-URL fields:
point them at `http://localhost:8471/v1` (iOS simulator, or Android with
`adb reverse tcp:8471 tcp:8471`) and use `codex` as the model id. The bridge
stores no credentials; Codex CLI's own login is the only auth. Note: the
app's P2-11 rule upgrades non-loopback plain `http://` to `https://`, so a
same-Wi-Fi LAN IP needs the follow-up documented in the bridge README.
