export { OpenFoodFactsSource } from './off-source.js'
// T4-a wiring: the honest barcode outcome type (found | miss | unreachable).
// The `resolveByBarcodeOutcome` method rides on the already-exported
// OpenFoodFactsSource class; `resolveByBarcode` keeps its legacy
// null-on-failure contract, and consumers that can act on offline-vs-miss
// (the scan flow) read the outcome instead.
export type { OffBarcodeOutcome } from './off-source.js'
export * from './types.js'
export * from './usda-source.js'
export * from './ifct-source.js'
export * from './user-food-source.js'
export * from './router-source.js'
export * from './recipe-source.js'
export * from './dish-kb-source.js'
export * from './household-dish-source.js'
