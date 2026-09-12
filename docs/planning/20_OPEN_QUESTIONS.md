# Open Questions

This document tracks unresolved product, engineering, and data decisions. These need resolution before or during their associated implementation tasks.

## 1. IFCT Data Format (PDF vs Structured)
- **Description:** The Indian Food Composition Tables (IFCT) are primarily available as complex PDFs. We need to decide whether to invest in building a complex PDF parser or attempt to source structured data through unofficial/paid APIs.
- **Recommended Default:** Build a custom PDF extraction script with manual spot-checking.
- **Consequence of Accepting Default:** High upfront time investment in Phase 2; requires ongoing maintenance if the PDF format updates.
- **Affected Tasks:** `IND-001`
- **Decision Timeline:** Start of Phase 2.
- **Decision:** Resolved in Phase 2. Use the official PDF and the repository
  extraction pipeline in `tools/ifct-import/src/extract-pdf.mjs`. The current
  Phase 2 import covers all 528 IFCT 2017 Table 1 foods for macro/fibre lookup;
  micronutrient extraction is deferred to Phase 8.

## 2. Exercise Library Seed Source
- **Description:** We need a source for the built-in exercise library that is legally safe to use and comprehensive enough for Day 1 users.
- **Recommended Default:** Use the `wger` open-source database and filter for the top 200 most common exercises.
- **Consequence of Accepting Default:** Some niche exercises will be missing. Users will have to create them manually.
- **Affected Tasks:** `TRN-001`
- **Decision Timeline:** Start of Phase 3.

## 3. Indian Food Density Values
- **Description:** Translating volume measurements (e.g., "1 katori") to weight (grams) varies wildly depending on the food's density, especially for Indian curries and dals.
- **Recommended Default:** Use a static fallback average density for categories (e.g., all dals = 1.05g/ml) unless specific data is available.
- **Consequence of Accepting Default:** Calorie calculations for volumetric entries might have a ±15% error margin.
- **Affected Tasks:** `IND-002`
- **Decision Timeline:** Start of Phase 2.
- **Decision:** Partially resolved for Phase 2 by recipe yield/oil modelling and
  explicit cooked-yield fields. Broader utensil-density personalization remains
  in later household-learning/search tasks.

## 4. Health Connect Minimum SDK
- **Description:** Integrating Health Connect on Android requires deciding the minimum Android SDK version to support, as older versions require a standalone app.
- **Recommended Default:** Support Android 14+ natively, require the Health Connect app download for Android 9-13.
- **Consequence of Accepting Default:** Friction for users on older Android devices who must install a separate app.
- **Affected Tasks:** `HLT-001`
- **Decision Timeline:** Start of Phase 8.

## 5. Supabase vs Alternatives
- **Description:** Choosing the backend-as-a-service for user authentication and data syncing.
- **Recommended Default:** Supabase (self-hosted or managed).
- **Consequence of Accepting Default:** Vendor lock-in to Supabase's specific Postgres extensions (e.g., pgjwt) and Auth API.
- **Affected Tasks:** `SYN-001`, `SYN-002`
- **Decision Timeline:** Start of Phase 7.

## 6. Local AI Compatibility
- **Description:** Determining if we can run small LLMs/SLMs entirely on-device (e.g., via MLC LLM or MediaPipe) for privacy and offline support.
- **Recommended Default:** Stick to cloud APIs (OpenAI/Anthropic) for V1, defer local AI.
- **Consequence of Accepting Default:** Requires internet connection for AI features; incurs ongoing API costs.
- **Affected Tasks:** `AIP-008`
- **Decision Timeline:** Start of Phase 10.

## 7. Voice Input Approach
- **Description:** How to handle voice-to-text for food logging. Native device dictation vs custom Whisper integration.
- **Recommended Default:** Use native iOS/Android dictation keyboards for V1.
- **Consequence of Accepting Default:** Lower accuracy for complex Indian food names compared to a fine-tuned Whisper model.
- **Affected Tasks:** `AIP-004`
- **Decision Timeline:** Start of Phase 6.

## 8. Indian Food Evaluation Dataset
- **Description:** We need a benchmark dataset of typical Indian meal logs to test the accuracy of our search and AI resolution pipelines.
- **Recommended Default:** Manually create a golden dataset of 500 diverse Indian meal string inputs and their expected parsed JSON outputs.
- **Consequence of Accepting Default:** Requires significant manual data entry work.
- **Affected Tasks:** `EVAL-001`
- **Decision Timeline:** Start of Phase 9.

## 9. Web Framework Confirmation
- **Description:** Selecting the web framework for the companion web dashboard.
- **Recommended Default:** Next.js (App Router).
- **Consequence of Accepting Default:** Heavy dependency on Vercel ecosystem; might be overkill for a simple dashboard.
- **Affected Tasks:** `WEB-001`
- **Decision Timeline:** Start of Phase 7.

## 10. Open Food Facts Barcode Coverage for India
- **Description:** Assessing if Open Food Facts has sufficient barcode coverage for Indian grocery products.
- **Recommended Default:** Rely on OFF as the primary source, implement a fallback UI for users to manually enter missing barcode data.
- **Consequence of Accepting Default:** Users might face a high "barcode not found" rate initially, requiring manual entry.
- **Affected Tasks:** `NUT-003`
- **Decision Timeline:** Start of Phase 2.
- **Decision:** Resolved for Phase 2 as a fallback source. Local USDA/IFCT/user
  sources are preferred; OFF is used for barcode lookups after local misses, with
  timeout and ODbL attribution.

## 11. Initial Built-in Exercise Count Target
- **Description:** Defining the exact number of exercises to ship with the app on Day 1.
- **Recommended Default:** Target 250 core exercises (barbell, dumbbell, machines, basic bodyweight).
- **Consequence of Accepting Default:** Users doing specialized programs (e.g., kettlebell sport, advanced calisthenics) will need to input exercises manually.
- **Affected Tasks:** `TRN-001`
- **Decision Timeline:** Start of Phase 3.
