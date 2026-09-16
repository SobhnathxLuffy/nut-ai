# Development debris cleanup

Before cleanup, repository-wide searches covered `package.json`, scripts, CI configuration, documentation, and tests. No live references were found for the deleted root patch/fix scripts or the scan-test `.orig`/`.patch` copies.

Removed as unused development debris:

- `fix_mocks.sh`
- `fix_test.sh`
- `patch_fixscan.js`
- `patch_pipeline_tests.sh`
- `apps/mobile/src/scan/store.test.ts.orig`
- `apps/mobile/src/scan/store.test.ts.patch`

`scripts/patch-expo-modules-jsi.mjs` was retained. It is an active, documented `postinstall` dependency referenced by `package.json`, not cleanup debris.
