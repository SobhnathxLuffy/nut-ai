#!/usr/bin/env bash
# Build a GitHub-Pages-ready web export of Nut AI (project-page sub-path hosting).
#
# GitHub Pages cannot set COOP/COEP headers, which sqlite-wasm's OPFS VFS needs
# (SharedArrayBuffer). coi-serviceworker bridges this client-side: it registers a
# service worker that re-serves the site with the isolation headers, then reloads
# once. Result: full OPFS-backed storage on GH Pages, with a localStorage
# fallback if the worker cannot install (old browsers).
#
# Token-free by design: this script only BUILDS. Deployment (git push to the
# gh-pages branch) is done by the operator with credentials supplied at runtime.
#
# Usage:  EXPO_PUBLIC_WEB_BASE=/nut-ai scripts/build-ghpages.sh   (from repo root)
set -euo pipefail
cd "$(dirname "$0")/.."

BASE="${EXPO_PUBLIC_WEB_BASE:?set EXPO_PUBLIC_WEB_BASE=/nut-ai (no trailing slash)}"

echo "[ghpages] exporting web bundle (baseUrl=$BASE) ..."
( cd apps/mobile && EXPO_PUBLIC_WEB_BASE="$BASE" npx expo export --platform web )

DIST=apps/mobile/dist

echo "[ghpages] fetching coi-serviceworker ..."
curl -fsSL https://cdn.jsdelivr.net/npm/@gouch/coi-serviceworker@0.0.3/coi-serviceworker.js \
  -o "$DIST/coi-serviceworker.js"
rg -q 'Cross-Origin-Embedder-Policy' "$DIST/coi-serviceworker.js" \
  || { echo "[ghpages] downloaded shim does not look right"; exit 1; }

echo "[ghpages] patching index.html (+ 404.html + .nojekyll) ..."
python3 - "$DIST" <<'PY'
import sys, pathlib
dist = pathlib.Path(sys.argv[1])
idx = dist / 'index.html'
html = idx.read_text()
if 'coi-serviceworker.js' not in html:
    marker = '<head>'
    if marker not in html:
        raise SystemExit('index.html has no <head> to inject into')
    html = html.replace(marker, marker + '<script src="coi-serviceworker.js"></script>', 1)
    idx.write_text(html)
# SPA fallback: GH Pages serves 404.html for unknown paths, so copying the app
# shell there lets expo-router deep links (e.g. /nut-ai/meal/42) still boot.
(dist / '404.html').write_text(html)
# Keep the _expo/ directory out of Jekyll's underscore ignore list.
(dist / '.nojekyll').write_text('')
PY
echo "[ghpages] done — deploy: push apps/mobile/dist/* (incl. .nojekyll) to the gh-pages branch root"
