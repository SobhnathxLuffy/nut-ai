# Requirements Traceability

This matrix maps the agreed Master Build Plan v3 requirements to real task IDs in [TASK_INDEX.md](../tasks/TASK_INDEX.md). Task IDs are intentionally repeated where one implementation slice satisfies several product requirements.

| PDF Section | Requirement | Product Surface | Domain Entity | Task IDs | Tests Required | Phase |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | Product vision, offline-first, no fake certainty | Entire app | All | AUD-001, FND-001, NUT-001, AIP-003, EVAL-003, REL-006 | Full gate, E2E smoke, evaluation checks | 1-11 |
| 2 | Five-tab navigation | App shell | Navigation state | TLN-002, TRN-002, WEB-003, REL-001 | Mobile UI tests, accessibility checks | 3-11 |
| 3 | Unified input pipeline | Food logging | Meal, operation | NUT-001, IND-003, SRH-001, AIP-003, AIP-004 | Unit, integration, correction E2E | 2-6 |
| 4 | Zero-API/offline mode | Core flows | Network state | FND-002, SRH-001, TRN-002, AIP-009 | Offline integration tests | 1-10 |
| 5 | AI architecture: local and cloud | AI settings, assistant | Provider, model call | AIP-001, AIP-007, AIP-008, AIP-009 | Provider contract tests, fallback tests | 6-10 |
| 6 | India-first nutrition source | Food search | Food source | NUT-001, IND-001, REL-005 | Source adapter tests, license checks | 2-11 |
| 7 | Indian food ontology | Food search, recipes | Alias, dish family | IND-002, IND-003, EVAL-001 | Fixture and golden-query tests | 2-9 |
| 8 | Hidden-ingredient clarification | Review/correction | Clarification | IND-003, AIP-003, AIP-004 | Prompt fixture and correction tests | 2-6 |
| 9 | Household learning and measures | Food logging | Utensil, household rule | IND-003, SRH-004 | Unit and integration tests | 2-4 |
| 10 | Portion estimation hierarchy | Meal analysis | Portion evidence | IND-003, AIP-003, EVAL-003 | Property tests, evaluation harness | 2-9 |
| 11 | Training tracking types | Train | Exercise, set | TRN-001, TRN-002 | Schema and workout unit tests | 3 |
| 12 | Custom exercises | Train | Exercise | TRN-001, TRN-002, SRH-003 | DB constraints, search tests | 3-4 |
| 13 | Equipment and plate calculator | Train, You | Equipment | EQP-001 | Property tests, UI smoke | 3 |
| 14 | Active workout UI and recovery | Train, global shell | Workout session | TRN-002, TRN-003, TLN-002, TRN-006 | Process-death recovery tests, Android manual test | 3-10 |
| 15 | RIR/RPE optional advanced fields | Train | Set | TRN-001, TRN-002, TRN-005 | Schema, simple/advanced UI tests | 3 |
| 16 | PR engine | Train, Progress | Personal record | TRN-004, TLN-004 | PR derivation unit tests | 3-8 |
| 17 | Progression engine | Train | Program, progression rule | TRN-005 | Unit and fixture tests | 3 |
| 18 | Training analytics | Progress | Analytics read model | TRN-004, TLN-003, TLN-004 | Analytics tests | 3-8 |
| 19 | Recovery/readiness without fake scores | Train, Progress | Recovery context | TRN-005, ADP-003, TLN-004 | Unit tests, copy review | 3-8 |
| 20 | Workout tools | Train | Timer, note, superset | TRN-002, TRN-003, TRN-006 | UI and timer tests | 3-10 |
| 21 | Routines, programs, quick workouts | Train | Routine, program | TRN-005 | DB, integration, UI tests | 3 |
| 22 | Combined progress dashboard | Progress | Metrics | TLN-004, WEB-003 | Chart contract tests, visual smoke | 7-8 |
| 23 | Exercise calories not auto-eaten | Food, Train, Settings | Preference, day total | FND-001, TRN-002, ADP-003 | Unit tests for totals policy | 1-5 |
| 24 | Training chatbot | Assistant, Train | Chat tool | AIP-005, AIP-006 | Read/write tool integration tests | 6 |
| 25 | Mobile and web monorepo | Repo, web app | Workspace, app shell | WEB-001, WEB-002, WEB-003 | Build, typecheck, sync smoke | 7 |
| 26 | Sync/local-only/account migration | You, onboarding | Sync account, outbox | SYN-001, SYN-003, SYN-004, SYN-006 | Migration, conflict, offline tests | 7 |
| 27 | Photo/body privacy | Settings, media | Photo object, key | AIP-002, SYN-005, REL-002 | EXIF, retention, security tests | 6-11 |
| 28 | Health Connect and HealthKit | You, integrations | Health sample | HLT-001, HLT-002, HLT-003 | Adapter contract and device tests | 8 |
| 29 | Core data model | Database | Schema | FND-001, FND-003, TRN-001, NUT-002, SYN-002 | Migration and backup tests | 1-8 |
| 30 | Evaluation programs and datasets | Eval tooling | Golden sample | EVAL-001, EVAL-002, EVAL-003 | Evaluation harness tests | 9 |
| 31 | Accuracy/effort modes | Food, Settings | Logging mode | IND-003, AIP-003, ADP-005 | Mode behavior and safety tests | 2-6 |
| 32 | Open-source and licensing | Repo, release | License manifest | AUD-001, IND-001, REL-005 | Manual and link checks | 1-11 |
| 33 (v3) | Day completeness | Home, timeline | Day status | FND-004, ADP-001, ADP-002 | Exclusion and UI tests | 1-5 |
| 34 (v3) | Fast repeat logging | Food, timeline | Log entry | SRH-004, SRH-005 | Repeat operation tests | 4 |
| 35 (v3) | Universal search | Search | Search index | SRH-001, SRH-002, SRH-003 | Ranking and latency tests | 4 |
| 36 (v3) | Unified timeline | Home, Food | Timeline event | TLN-001, TLN-002 | Read-model and UI tests | 4 |
| 37 (v3) | Weekly/monthly reports | Progress, web | Report | TLN-003, TLN-004, WEB-003 | Report fixture tests | 8 |
| 38 (v3) | Simple/advanced training UX | Train, You | User preference | TRN-002, TRN-005, REL-001 | UI and accessibility tests | 3-11 |
| 39 (v3) | Micronutrient-ready model | Food, Progress | Micronutrient | NUT-002, NUT-003 | Schema, missing-data, coverage tests | 8 |
| 40 (v3) | Undo/versioning | Core, recipes, sync | Operation, version | FND-003, IND-003, SYN-006 | Undo, version, conflict tests | 1-7 |
| 41 (v3) | Data quality inspector | Food details, tools | Provenance | EVAL-004, NUT-003 | Inspector contract and UI tests | 8-9 |
| 42 (v3) | Active workout outside Train | Global shell | Workout state | TRN-003, TLN-002, TRN-006 | Navigation, recovery, live control tests | 3-10 |
