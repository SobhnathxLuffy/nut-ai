# Task Index

Tasks are dependency ordered. A task is `ready` only when every dependency is complete or explicitly allowed by its task file.

| ID | Title | Phase | Status | Dependencies | Parallel-Safe | Estimated Scope | High-Conflict Files | Spec Links |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Phase 1: Foundation** |
| AUD-001 | Reproduce Baseline and Correct Stale Documentation | 1 | complete | None | Yes | Small | VERIFICATION.md, eslint config | [AUD-001](./phase-01-foundation/AUD-001-baseline.md) |
| FND-001 | Schema v2 — UUID Identity and Sync Metadata | 1 | complete | AUD-001 | No | Medium | schema.ts, migrations | [FND-001](./phase-01-foundation/FND-001-schema-v2-identity.md) |
| FND-002 | Backup Format v2 — Round-Trip All Tables | 1 | complete | FND-001 | Yes | Medium | backup-core.ts, backup allowlists | [FND-002](./phase-01-foundation/FND-002-backup-v2.md) |
| FND-003 | Structured Operations and Undo Foundation | 1 | complete | FND-001 | No | Large | schema.ts, operations core | [FND-003](./phase-01-foundation/FND-003-operations-undo.md) |
| AUD-002 | Health Score Removal | AUD-002 | Health Score Removal & Metric Default | 1 | ready | Metric Default | 1 | complete | AUD-001 | Yes | Small | index.tsx, settings | [AUD-002](./phase-01-foundation/AUD-002-health-score-metric.md) |
| FND-005 | String Extraction & i18n Foundation | 1 | ready | AUD-001 | Yes | Medium | app shell, components | [FND-005](./phase-01-foundation/FND-005-i18n-foundation.md) |
| FND-004 | Day Completeness Storage Foundation | 1 | complete | FND-001 | Yes | Small | schema.ts, goals | [FND-004](./phase-01-foundation/FND-004-day-completeness.md) |
| **Phase 2: Nutrition** |
| NUT-001 | Nutrition Source Interface and USDA Adapter | 2 | complete | AUD-001 | Yes | Medium | nutrition source contracts | [NUT-001](./phase-02-nutrition/NUT-001-source-interface.md) |
| NUT-002 | Open Food Facts Adapter & ODbL | 2 | complete | NUT-001 | Yes | Medium | nutrition sources | [NUT-002](./phase-02-nutrition/NUT-002-open-food-facts.md) |
| NUT-003 | Source Router & Multi-Source Resolution | 2 | complete | NUT-001, NUT-002 | No | Large | resolver | [NUT-003](./phase-02-nutrition/NUT-003-source-router.md) |
| IND-001 | IFCT Ingestion Pipeline and Adapter | 2 | complete | NUT-001 | Yes | Large | tools/ifct-import, data manifests | [IND-001](./phase-02-nutrition/IND-001-ifct-pipeline.md) |
| IND-002 | Indian Food Alias Normalization | 2 | complete | FND-001, NUT-001 | Yes | Medium | indian ontology fixtures | [IND-002](./phase-02-nutrition/IND-002-indian-aliases.md) |
| IND-003 | Recipe, Version, Yield, and Oil Model | 2 | complete | IND-002, FND-001 | No | Large | recipe schema, gram engine | [IND-003](./phase-02-nutrition/IND-003-recipe-engine.md) |
| **Phase 3: Training** |
| TRN-001 | Exercise and Equipment Schema | 3 | complete | FND-001 | No | Medium | schema.ts, migrations | [TRN-001](./phase-03-training/TRN-001-exercise-schema.md) |
| TRN-002 | Minimal Offline Workout Creation | 3 | complete | TRN-001 | Yes | Large | training core, Train routes | [TRN-002](./phase-03-training/TRN-002-workout-core.md) |
| TRN-003 | Active Workout Persistence and Recovery | 3 | complete | TRN-002 | Yes | Medium | active workout state | [TRN-003](./phase-03-training/TRN-003-workout-persistence.md) |
| EQP-001 | Equipment Inventory and Plate Calculator | 3 | complete | TRN-001 | Yes | Medium | equipment package, settings | [EQP-001](./phase-03-training/EQP-001-plate-calculator.md) |
| TRN-004 | PR Detection and Progress Graph | 3 | complete | TRN-002 | Yes | Medium | progression package, Progress UI | [TRN-004](./phase-03-training/TRN-004-pr-engine.md) |
| TRN-005 | Routines, Programs, and Progression | 3 | complete | TRN-002, EQP-001 | No | Large | schema.ts, routine/program routes | [TRN-005](./phase-03-training/TRN-005-routines-programs.md) |
| TRN-007 | Superset & Circuit Grouping UI | 3 | complete | TRN-002 | Yes | Medium | workout active UI | [TRN-007](./phase-03-training/TRN-007-superset-circuit.md) |
| **Phase 4: Search, Repeat Logging, and Timeline** |
| UX-001 | 5-Tab Navigation Migration | 4 | complete | AUD-002 | No | Large | expo router, layout | [UX-001](./phase-04-search-timeline/UX-001-5-tab-navigation.md) |
| SRH-001 | Unified Search Contract and Local Index | 4 | complete | NUT-001, IND-002, TRN-001 | No | Medium | search contracts, resolver | [SRH-001](./phase-04-search-timeline/SRH-001-unified-search-contract.md) |
| SRH-002 | Food Search Ranking and Filters | 4 | complete | SRH-001, IND-003 | Yes | Medium | Food tab search UI | [SRH-002](./phase-04-search-timeline/SRH-002-food-search-ranking.md) |
| SRH-003 | Exercise Search Ranking and Filters | 4 | complete | SRH-001, TRN-002 | Yes | Medium | Train search UI | [SRH-003](./phase-04-search-timeline/SRH-003-exercise-search-ranking.md) |
| SRH-004 | Recent, Frequent, Favorite, and Usual Meals | 4 | complete | FND-003, IND-003 | Yes | Medium | logging history, saved meals | [SRH-004](./phase-04-search-timeline/SRH-004-recents-favorites-usuals.md) |
| SRH-005 | Repeat Logging and Copy-Yesterday Actions | 4 | complete | SRH-004, FND-003 | Yes | Medium | operations, Food tab actions | [SRH-005](./phase-04-search-timeline/SRH-005-repeat-logging-actions.md) |
| TLN-001 | Unified Timeline Event Contract | 4 | complete | FND-003, TRN-002, IND-003 | No | Medium | timeline read models | [TLN-001](./phase-04-search-timeline/TLN-001-timeline-event-contract.md) |
| TLN-002 | Daily Timeline Mobile UI | 4 | complete | TLN-001, SRH-005, TRN-003 | No | Large | Home/Food navigation, timeline UI | [TLN-002](./phase-04-search-timeline/TLN-002-daily-timeline-ui.md) |
| **Phase 5: Day Completeness and Adaptive Check-ins** |
| ADP-001 | Day Status Rules and Analytics Exclusions | 5 | complete | FND-004, TLN-001 | No | Medium | goals, reports contracts | [ADP-001](./phase-05-adaptive-checkins/ADP-001-day-status-rules.md) |
| ADP-002 | Completeness UI and Day Finalization | 5 | complete | ADP-001, TLN-002 | Yes | Medium | Home/Food day controls | [ADP-002](./phase-05-adaptive-checkins/ADP-002-completeness-ui.md) |
| ADP-003 | Weekly Check-in Metrics Engine | 5 | complete | ADP-001, TRN-004 | Yes | Medium | goals, analytics | [ADP-003](./phase-05-adaptive-checkins/ADP-003-weekly-checkin-metrics.md) |
| ADP-004 | Adaptive Target Suggestions | 5 | complete | ADP-003 | No | Medium | goals, profile settings | [ADP-004](./phase-05-adaptive-checkins/ADP-004-adaptive-target-suggestions.md) |
| ADP-005 | Check-in Consent and Safety Guardrails | 5 | complete | ADP-004 | No | Medium | safety rules, check-in UI | [ADP-005](./phase-05-adaptive-checkins/ADP-005-consent-safety-guardrails.md) |
| **Phase 6: AI Providers, Photo Analysis, and Chat** |
| AIP-001 | AI Provider Interface and Key Storage Contract | 6 | unstarted | NUT-001, FND-003 | No | Medium | provider contracts, secure storage | [AIP-001](./phase-06-ai-chat/AIP-001-provider-interface-key-storage.md) |
| AIP-002 | Photo Preprocessing and Privacy Filter | 6 | complete | AIP-001 | Yes | Medium | media pipeline, EXIF stripping | [AIP-002](./phase-06-ai-chat/AIP-002-photo-preprocessing-privacy.md) |
| AIP-003 | Structured Meal Photo Analysis | 6 | complete | AIP-002, IND-003 | No | Large | prompt, gram engine integration | [AIP-003](./phase-06-ai-chat/AIP-003-structured-meal-photo-analysis.md) |
| AIP-004 | Correction Intent Parser and Confirmation | 6 | complete | AIP-003, FND-003 | No | Large | correction flow, operations | [AIP-004](./phase-06-ai-chat/AIP-004-correction-intent-confirmation.md) |
| AIP-005 | Unified Assistant Read Tools | 6 | unstarted | TLN-001, TRN-004, AIP-001 | Yes | Medium | assistant tool registry | [AIP-005](./phase-06-ai-chat/AIP-005-assistant-read-tools.md) |
| AIP-006 | Assistant Write Actions with Confirmation | 6 | unstarted | AIP-004, AIP-005 | No | Medium | assistant confirmations | [AIP-006](./phase-06-ai-chat/AIP-006-assistant-write-actions.md) |
| AIP-007 | Provider Fallbacks, Timeouts, Retries, and Cache | 6 | unstarted | AIP-001, AIP-003 | Yes | Medium | provider orchestration | [AIP-007](./phase-06-ai-chat/AIP-007-provider-fallback-retry-cache.md) |
| **Phase 7: Accounts, Sync, Supabase, and Web** |
| SYN-001 | Account and Auth Abstraction | 7 | unstarted | FND-001, FND-003 | No | Medium | auth contracts, profile settings | [SYN-001](./phase-07-sync-web/SYN-001-account-auth-abstraction.md) |
| SYN-002 | Supabase Schema and RLS Draft | 7 | unstarted | SYN-001 | No | Large | supabase migrations, RLS | [SYN-002](./phase-07-sync-web/SYN-002-supabase-schema-rls.md) |
| SYN-003 | Outbox and Pull Sync Engine | 7 | unstarted | SYN-002, FND-003 | No | Large | sync engine, operations | [SYN-003](./phase-07-sync-web/SYN-003-outbox-pull-sync-engine.md) |
| SYN-004 | Local-to-Account Migration | 7 | unstarted | SYN-003, FND-002 | No | Medium | onboarding, backup/migration | [SYN-004](./phase-07-sync-web/SYN-004-local-to-account-migration.md) |
| SYN-005 | Photo Object Storage Lifecycle | 7 | unstarted | SYN-002, AIP-002 | Yes | Medium | storage policies, media refs | [SYN-005](./phase-07-sync-web/SYN-005-photo-object-storage-lifecycle.md) |
| SYN-006 | Conflict Resolution and Sync Recovery | 7 | unstarted | SYN-003, SYN-005 | No | Large | sync conflict policies | [SYN-006](./phase-07-sync-web/SYN-006-conflict-resolution-recovery.md) |
| WEB-001 | Vite React App Shell | 7 | unstarted | SYN-001 | No | Medium | apps/web, shared package imports | [WEB-001](./phase-07-sync-web/WEB-001-vite-react-app-shell.md) |
| WEB-002 | Web Local Store and Sync Bootstrap | 7 | unstarted | WEB-001, SYN-003 | No | Large | web storage, sync bootstrap | [WEB-002](./phase-07-sync-web/WEB-002-web-local-store-sync.md) |
| WEB-003 | Web Food Timeline and Training Views | 7 | unstarted | WEB-002, TLN-002, TRN-005 | No | Large | web routes, shared UI contracts | [WEB-003](./phase-07-sync-web/WEB-003-web-food-timeline-training.md) |
| **Phase 8: Reports, Micronutrients, and Health Adapters** |
| TLN-003 | Weekly and Monthly Reports Engine | 8 | unstarted | ADP-003, TLN-001 | Yes | Medium | reports engine | [TLN-003](./phase-08-reports-health/TLN-003-weekly-monthly-reports.md) |
| TLN-004 | Progress Dashboard and Combined Charts | 8 | unstarted | TLN-003, TRN-004 | No | Large | Progress tab, chart contracts | [TLN-004](./phase-08-reports-health/TLN-004-progress-dashboard-charts.md) |
| MIC-001 | Micronutrient Storage and Coverage Model | 8 | unstarted | IND-001, FND-001 | No | Medium | schema.ts, nutrition source snapshots | [MIC-001](./phase-08-reports-health/MIC-001-micronutrient-storage-coverage.md) |
| MIC-002 | Micronutrient UI and Missing Data States | 8 | unstarted | NUT-002, TLN-003 | Yes | Medium | Food/Progress micronutrient UI | [MIC-002](./phase-08-reports-health/MIC-002-micronutrient-ui.md) |
| HLT-001 | Health Adapter Contract and Permission Model | 8 | unstarted | FND-001, ADP-001 | No | Medium | health contracts, settings | [HLT-001](./phase-08-reports-health/HLT-001-health-adapter-contract.md) |
| HLT-002 | Android Health Connect Adapter | 8 | unstarted | HLT-001 | No | Large | Android native permissions | [HLT-002](./phase-08-reports-health/HLT-002-health-connect-android.md) |
| HLT-003 | iOS HealthKit Adapter | 8 | unstarted | HLT-001 | No | Large | iOS entitlements, native module | [HLT-003](./phase-08-reports-health/HLT-003-healthkit-ios.md) |
| **Phase 9: Indian-food Evaluation Dataset** |
| EVAL-001 | Indian Food Golden Dataset Specification | 9 | unstarted | IND-003, AIP-003 | Yes | Medium | eval manifests, privacy rules | [EVAL-001](./phase-09-evaluation/EVAL-001-indian-food-golden-dataset.md) |
| EVAL-002 | Dataset Capture and Labeling Tool | 9 | unstarted | EVAL-001 | No | Medium | eval tooling | [EVAL-002](./phase-09-evaluation/EVAL-002-dataset-capture-labeling.md) |
| EVAL-003 | Empirical Confidence Calibration | 9 | unstarted | EVAL-002, AIP-003 | No | Large | confidence package, eval harness | [EVAL-003](./phase-09-evaluation/EVAL-003-confidence-calibration.md) |
| EVAL-004 | Data Quality Inspector | 9 | unstarted | NUT-002, EVAL-003 | Yes | Medium | inspector UI, provenance contracts | [EVAL-004](./phase-09-evaluation/EVAL-004-data-quality-inspector.md) |
| **Phase 10: Local Android AI and Live Controls** |
| AIP-008 | Local Android Multimodal AI Spike | 10 | deferred | AIP-003, EVAL-003 | Yes | Medium | Android model runtime spike | [AIP-008](./phase-10-local-ai/AIP-008-local-android-multimodal-spike.md) |
| AIP-009 | Offline Local AI Parser Integration | 10 | deferred | AIP-008, AIP-005 | No | Large | parser fallback, model assets | [AIP-009](./phase-10-local-ai/AIP-009-offline-local-parser.md) |
| TRN-006 | Android Active Workout Live Controls | 10 | deferred | TRN-003 | No | Medium | Android notification controls | [TRN-006](./phase-10-local-ai/TRN-006-android-workout-live-controls.md) |
| **Phase 11: Accessibility, Security, Performance, and Release** |
| REL-007 | Medical Disclaimer Privacy Check | 11 | unstarted | None | Yes | Small | onboarding, settings | [REL-007](./phase-11-release/REL-007-medical-disclaimer.md) |
| REL-001 | Accessibility Audit and Remediation | 11 | unstarted | WEB-003, HLT-003 | No | Large | mobile and web UI | [REL-001](./phase-11-release/REL-001-accessibility-audit-remediation.md) |
| REL-002 | Security Hardening and Privacy Review | 11 | unstarted | SYN-006, AIP-007 | No | Large | auth, sync, media, provider keys | [REL-002](./phase-11-release/REL-002-security-privacy-review.md) |
| REL-003 | Performance Budgets and Profiling | 11 | unstarted | TLN-004, WEB-003 | Yes | Medium | mobile/web performance gates | [REL-003](./phase-11-release/REL-003-performance-budgets-profiling.md) |
| REL-004 | Backup Recovery Disaster Drill | 11 | unstarted | SYN-006, FND-002 | No | Medium | backup, import, sync recovery | [REL-004](./phase-11-release/REL-004-backup-recovery-drill.md) |
| REL-005 | License and Data Release Compliance | 11 | unstarted | EVAL-004, IND-001 | Yes | Medium | license docs, data manifests | [REL-005](./phase-11-release/REL-005-license-data-compliance.md) |
| REL-006 | Beta Release Gate and Store Prep | 11 | unstarted | REL-001, REL-002, REL-003, REL-004, REL-005 | No | Large | release checklists, store metadata | [REL-006](./phase-11-release/REL-006-beta-release-store-prep.md) |
