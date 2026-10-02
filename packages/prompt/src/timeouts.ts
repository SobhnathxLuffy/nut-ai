/**
 * P3-D16: the ONE home for network timeout constants.
 *
 * Timeouts used to be scattered magic numbers (45s here, 8s there, 30s in two
 * places, 20s in a third) with no cross-reference. Every provider-facing wait
 * is named here so tuning is a one-file change.
 *
 * The shape of the values:
 *  - SCAN/VISION (image payloads, big outputs): the long end.
 *  - LOOKUP (web-search refinement, one small call): the middle.
 *  - VALIDATION (key check): tight — a bad key should be reported fast.
 *  - OFF-SOURCE (bundled/offline sources): tiny, it never leaves the device.
 *  - STALL (streaming inactivity): the user-facing hang guard.
 */

/** Scan + vision + label + receipt image payloads and long structured outputs. */
export const SCAN_TIMEOUT_MS = 45_000

/** Web-lookup refinement calls (scan-time and barcode "Other…"). */
export const LOOKUP_TIMEOUT_MS = 30_000

/** Correction-intent parse calls (Fix Result). */
export const CORRECTION_TIMEOUT_MS = 30_000

/** Credential validation probes. */
export const VALIDATION_TIMEOUT_MS = 15_000

/** Estimate calls from exercise/receipt flows that stay text-only. */
export const ESTIMATE_TIMEOUT_MS = 20_000

/** Offline/off-device source reads (bundled corpora, no network). */
export const OFFSOURCE_REQUEST_TIMEOUT_MS = 8_000

/** Streaming stall guard: no bytes for this long aborts the stream. */
export const STREAM_STALL_TIMEOUT_MS = 45_000

/**
 * Total wall-clock budget for a scan streamed through an OpenAI-compatible
 * reseller gateway. Non-streaming gateway requests are killed by the gateway
 * itself around 30s (aicredits.in returns a bare 500), which is inside the
 * generation time of a real structured scan (40-90s measured on Gemma vision
 * models), so gateway scans MUST ship `stream: true`. Streaming removes the
 * 30s wall but exposes the full generation time, so the client-side ceiling
 * has to cover it. Official endpoints keep SCAN_TIMEOUT_MS.
 */
export const GATEWAY_SCAN_TIMEOUT_MS = 180_000
