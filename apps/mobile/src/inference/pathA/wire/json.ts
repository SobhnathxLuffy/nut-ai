/**
 * The ONE fenced-JSON extractor (P2-10, P2-3): parses clean JSON directly,
 * and on failure strips markdown fences and isolates the outermost braces.
 * Scan, label, receipt, web-lookup and correction paths all share it, so a
 * degraded gateway that wraps its answer in ``` fences costs the same on
 * every path — one fenced reply no longer loses a billed scan.
 */
export function extractJsonObject(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    // fall through to fence stripping
  }
  const fenced = text.replace(/```(?:json)?/g, '').trim()
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(fenced.slice(start, end + 1))
  } catch {
    return null
  }
}
