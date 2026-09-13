export type * from "./types.js";
export const normalizeDishSearch=(v:string)=>v.normalize("NFKD").toLowerCase().replace(/[^a-z0-9\s-]/g," ").replace(/\s+/g," ").trim();
export * from './inheritance.js'
export * from './totals.js'
export * from './portions.js'
export * from './clarification.js'
export * from './household.js'
