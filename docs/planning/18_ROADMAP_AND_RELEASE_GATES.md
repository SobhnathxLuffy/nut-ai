# Roadmap and Release Gates

This document defines the 11 major phases of the project, mapping directly to the task system phases. It establishes entry criteria, deliverables, and strict release gates for each phase.

*Note: Phases 2, 3, and 4 can be executed partially in parallel depending on resource availability.*

## Phase 1: Foundation & Baseline (COMPLETE)
- **Status:** COMPLETE
- **Entry Criteria:** Repository initialization.
- **Deliverables:** Core monorepo setup, `core-schema` v4, `totals`, `gram-engine`, `db-adapter`, base UI setup.
- **Exit Criteria:** 363 passing tests, 100% type coverage on schemas, SQLite running natively.
- **Release Gate:** Internal Dev Release 1.

## Phase 2: Nutrition Sources & Indian Food (COMPLETE)
- **Status:** COMPLETE
- **Entry Criteria:** Phase 1 complete.
- **Deliverables:** 
  - `NUT-001` to `NUT-003` (OFF integration, macro parsing)
  - `IND-001` to `IND-003` (IFCT data pipeline, density mappings, Hindi alias support)
- **Exit Criteria:** Source router returns source-qualified USDA/IFCT/user/recipe/OFF results; IFCT 2017 Table 1 macro/fibre corpus contains 528 foods; common Indian aliases route to canonical foods; household recipes can be created, versioned, logged, backed up, and undone.
- **Release Gate:** Core Nutrition Engine Gate.

## Phase 3: Training Engine
- **Entry Criteria:** Phase 1 complete.
- **Deliverables:**
  - `TRN-001` to `TRN-005` (Exercise library, workout logger UI, volume tracking, rest timers)
  - `EQP-001` (Equipment profiles)
- **Exit Criteria:** Able to log a full push/pull/legs session and view aggregated volume. State recovery works after app kill.
- **Release Gate:** Workout Alpha.

## Phase 4: Search, Repeat Logging & Timeline
- **Entry Criteria:** Phase 1 complete.
- **Deliverables:**
  - `SRH-001` (FTS5 search UI)
  - `TLN-001`, `TLN-002` (Daily timeline view, quick-add recent items)
- **Exit Criteria:** Search responds < 50ms. Timeline accurately reflects logged meals.
- **Release Gate:** Usable Beta (Food + Training logging enabled).

## Phase 5: Day Completeness & Adaptive Check-ins
- **Entry Criteria:** Phases 2 and 4 complete.
- **Deliverables:**
  - `ADP-001` to `ADP-005` (Day completion logic, dynamic TDEE adjustments, check-in UI)
- **Exit Criteria:** Algorithm successfully detects anomalies in weight entries and suggests calorie adjustments.
- **Release Gate:** Intelligence Beta.

## Phase 6: AI Providers, Photo Analysis & Chat
- **Entry Criteria:** Phase 4 complete.
- **Deliverables:**
  - `AIP-001` to `AIP-007` (OpenAI/Anthropic integration, vision UI for plate analysis, natural language parsing)
- **Exit Criteria:** Users can upload a photo of a meal and receive a structured JSON log item matching the schema.
- **Release Gate:** AI Feature Freeze.

## Phase 7: Accounts, Sync, Supabase & Web
- **Entry Criteria:** Phases 1-5 complete.
- **Deliverables:**
  - `SYN-001` to `SYN-004` (Auth, Supabase migrations, conflict resolution)
  - `WEB-001` to `WEB-003` (Next.js dashboard, web auth)
- **Exit Criteria:** Seamless bi-directional sync between mobile app and web dashboard via Supabase.
- **Release Gate:** Cloud Beta.

## Phase 8: Reports, Micronutrients & Health Adapters
- **Entry Criteria:** Phases 2 and 3 complete.
- **Deliverables:**
  - `TLN-003` (Weekly/Monthly charts)
  - `NUT-004+` (Micronutrient tracking)
  - `HLT-001+` (Health Connect / Apple HealthKit sync)
- **Exit Criteria:** Charts render at 60fps. Steps and active energy imported correctly from OS health stores.
- **Release Gate:** Analytics Complete.

## Phase 9: Indian-food Evaluation Dataset
- **Entry Criteria:** Phase 2 complete.
- **Deliverables:**
  - `EVAL-001` to `EVAL-004` (Golden dataset creation, automated accuracy scripts)
- **Exit Criteria:** Pipeline scores > 90% accuracy against the 500-item golden dataset.
- **Release Gate:** Accuracy Certification.

## Phase 10: Local AI & Live Controls
- **Entry Criteria:** Phase 6 complete.
- **Deliverables:**
  - `AIP-008+` (Local inference fallback)
  - `TRN-006` (Live workout AI coaching)
- **Exit Criteria:** Basic text resolution works completely offline using on-device models.
- **Release Gate:** Offline Resiliency Gate.

## Phase 11: Accessibility, Security, Performance & Release
- **Entry Criteria:** All previous phases complete.
- **Deliverables:**
  - `REL-001` to `REL-006` (Screen reader audit, AGPL audit, bundle size reduction, App Store provisioning)
- **Exit Criteria:** Zero critical security issues. 100% VoiceOver/TalkBack compatibility on core flows.
- **Release Gate:** Production 1.0 Launch.
