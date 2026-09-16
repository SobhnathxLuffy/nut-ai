# Nut AI — Complete Engineering Audit & Implementation Plan

## Audit Summary

After recursive inspection of the entire repository by 4 parallel audit agents plus manual review:

### Phase-by-Phase Verdict

| Phase | Claimed | Verdict | Reason |
|-------|---------|---------|--------|
| Phase 1: Foundation | COMPLETE | **ACCEPTABLE** | SQLite migrations, Zod schemas, 17 node-pure packages, 512 tests passing. Architecture is genuinely strong. |
| Phase 2: Nutrition/Data | COMPLETE | **NEEDS REFACTOR** | IFCT 528 foods + USDA 7928 foods work. But **all 1441 Indian dish ingredient slots have `pending_exact_id`** — the 362-dish KB cannot compute nutrition. Alias resolution works (188+ aliases). Recipe engine works. |
| Phase 3: Training | COMPLETE | **GOOD** | Exercises, sets, e1RM (Epley capped at 12 reps), PRs, equipment/plates, routines, supersets all implemented and tested. |
| Phase 4: Search/Repeat/Timeline | COMPLETE | **ACCEPTABLE** | Search ranking, shortcuts, repeat logging, unified timeline work. `food.tsx` is heavily minified into single lines — maintainability issue. |
| Phase 5: Day Completeness/Adaptive | COMPLETE | **GOOD** | Day statuses, adaptive check-in, 150 kcal safety bounds, consent/safety guardrails properly implemented. |
| Phase 6: AI | NOT IN PLAN.md | **ACCEPTABLE** | PLAN.md says Phase 6 is "Next Task" but AI providers (OpenAI/Anthropic/Gemini), photo scan, assistant chat are all implemented. Provider fallback works. EXIF stripping implicit via ImageManipulator. |
| Progress/Reports | NOT STARTED | **MISSING** | Progress tab only has weight + strength. No nutrition charts, no training volume analytics, no weekly reports, no monthly reports. |

### Critical Bugs Found

1. **Missing route: `custom-food.tsx`** — Food tab has button that navigates to `/custom-food` but no such file exists. **Will crash.**
2. **Home streak hardcoded to `0`** — Line 106 of `index.tsx` shows `0` instead of computed streak.
3. **Fake micronutrient page** — Home page 2 shows Fiber=0/30g, Sugar=0/50g, Sodium=0/2300mg with hardcoded targets and zero values.
4. **Health Score N/A section still present** — PLAN.md says "Health score UI ✅ Removed (AUD-002)" but it's still rendered.
5. **All 1441 Indian dish ingredient mappings are `pending_exact_id`** — dishes exist structurally but cannot produce real nutrition numbers.
6. **`food.tsx` code is compressed into single lines** — entire screen logic on ~4 lines, unmaintainable.

### Non-Critical Issues

- 19 `patch*.js` files polluting root (cleanup artifacts from prior agent)
- `as any` in inference client (minor, isolated to network boundary)
- `.orig` and `.patch` files in scan/ directory (leftover artifacts)

---

## Proposed Changes

### Component 1: Bug Fixes & Cleanup

#### [MODIFY] [index.tsx](file:///home/sobhnath/Music/nut%20ai/nut-ai/apps/mobile/app/(tabs)/index.tsx)
- Fix hardcoded streak `0` → compute from logged meals
- Remove fake micronutrient page (Fiber/Sugar/Sodium zeros with hardcoded targets)
- Remove Health Score N/A section (already supposed to be removed per AUD-002)
- Reduce page carousel from 3 pages to 1 (macros only) or keep 2 pages with useful data

#### [NEW] [custom-food.tsx](file:///home/sobhnath/Music/nut%20ai/nut-ai/apps/mobile/app/custom-food.tsx)
- Create the missing custom food entry screen
- Support manual entry of name, brand, serving size, calories, protein, carbs, fat
- Save to user_foods table

#### [MODIFY] [food.tsx](file:///home/sobhnath/Music/nut%20ai/nut-ai/apps/mobile/app/(tabs)/food.tsx)
- Reformat minified code to be readable and maintainable

#### [DELETE] Root patch files
- Remove `patch.js` through `patch19.js`, `fix_mocks.sh`, `fix_test.sh`, `run_test.js`, `patch_pipeline_tests.sh`
- Remove `apps/mobile/src/scan/store.test.ts.orig` and `store.test.ts.patch`

---

### Component 2: Indian Dish Ingredient Mapping (Top ~50 dishes)

#### [MODIFY] [indian-dishes.mapped.json](file:///home/sobhnath/Music/nut%20ai/nut-ai/packages/indian-dishes/data/indian-dishes.mapped.json)
- Map ingredient slots to real IFCT/USDA IDs for the most common dishes
- Priority dishes: idli, dosa, roti/chapati, dal tadka, paneer butter masala, chicken biryani, chole, rajma, poha, litti, chokha, sambar, rasam, upma, pani puri, butter chicken, aloo gobi, palak paneer, masala dosa, egg chicken roll
- Mark mapped dishes as `CURATED` status
- Focus on high-frequency dishes that users will actually search for

---

### Component 3: Progress Dashboard Enhancement

#### [MODIFY] [progress.tsx](file:///home/sobhnath/Music/nut%20ai/nut-ai/apps/mobile/app/(tabs)/progress.tsx)
- Add segmented sections: Overview → Body → Nutrition → Strength → Training
- **Nutrition section**: Calorie chart, protein chart, macro adherence, complete-day tracking
- **Training section**: Sessions/week, working sets, muscle group distribution, frequency
- Keep existing weight/strength sections
- Add time range selectors (7D, 30D, 3M, 6M, 1Y, ALL)

#### [NEW] [aggregation.ts](file:///home/sobhnath/Music/nut%20ai/nut-ai/packages/goals/src/aggregation.ts)
- `aggregateNutritionDay()` — daily calorie/macro totals with completeness status
- `aggregateNutritionWeek()` — weekly averages excluding incomplete days
- `aggregateNutritionMonth()` — monthly averages
- `aggregateTrainingWeek()` — sessions, sets, volume, PRs
- `aggregateTrainingMonth()` — monthly training summary
- `calculateAdherence()` — target vs actual tracking

---

### Component 4: Weekly & Monthly Reports

#### [NEW] [reports.ts](file:///home/sobhnath/Music/nut%20ai/nut-ai/packages/goals/src/reports.ts)
- `generateWeeklyReport()` — deterministic weekly report from stored data
- `generateMonthlyReport()` — deterministic monthly report
- Reports include: body stats, nutrition averages, training metrics, PRs, data quality
- Calculated on demand (not cached — data is local and fast)

#### [NEW] [weekly-report.tsx](file:///home/sobhnath/Music/nut%20ai/nut-ai/apps/mobile/app/weekly-report.tsx)
- Weekly report screen with proper formatting
- Body section: weight trend, average, change
- Nutrition section: calories, protein, complete days, adherence
- Training section: sessions, sets, PRs, notable improvements
- Data quality warnings

#### [NEW] [monthly-report.tsx](file:///home/sobhnath/Music/nut%20ai/nut-ai/apps/mobile/app/monthly-report.tsx)
- Monthly report with navigation between months
- All metrics from weekly report aggregated monthly
- PR list, strongest improvements, consistency metrics

---

### Component 5: Aggregation Engine (Domain Package)

#### [NEW] [aggregation.ts](file:///home/sobhnath/Music/nut%20ai/nut-ai/packages/goals/src/aggregation.ts)
- Pure TypeScript, Node-testable
- No React/RN imports
- Reusable by future web app
- Functions for daily/weekly/monthly aggregation of nutrition and training data

#### [NEW] [aggregation.test.ts](file:///home/sobhnath/Music/nut%20ai/nut-ai/packages/goals/src/aggregation.test.ts)
- Unit tests for all aggregation functions
- Edge cases: empty data, single day, incomplete days, timezone boundaries

---

### Component 6: Chart Implementation

- Use existing `react-native-svg` (already a dependency) for all charts
- Custom chart components: LineChart, BarChart for nutrition/training data
- Handle edge cases: 0 points, 1 point, NaN, Infinity, sparse data
- Empty states with helpful messages
- Consistent theming

---

## Open Questions

> [!IMPORTANT]
> **Weight display units**: The progress tab shows weight in lbs (US). Should this be configurable (kg/lbs) or should it follow user's locale/preference? The app appears to store in kg internally.

> [!IMPORTANT]
> **Indian dish mapping scope**: With 362 dishes and 1441 slots all unmapped, a full mapping effort is enormous. I propose mapping the top ~50 most common dishes (covering ~80% of likely searches). Is this acceptable, or should ALL 362 be mapped?

> [!IMPORTANT]
> **Micronutrient page**: The Home screen has a placeholder page showing Fiber/Sugar/Sodium with hardcoded zeros. Should this page be removed entirely (as it currently shows false data), or should it be kept as a placeholder with a "Coming soon" message?

## Verification Plan

### Automated Tests
```bash
npm run check              # Full gate (lint + typecheck + test + node-purity + data:verify + ifct:verify)
npm run test               # All unit tests
npm run typecheck          # TypeScript strict
```

### Manual Verification
- Build and install on connected Samsung Galaxy SM-M146B (Android 15, API 35)
- Test all screens, navigation, food search, workout logging
- Verify Indian dish resolution for key dishes
- Test progress charts with real data
- Test weekly/monthly reports
- Test offline mode
- Test process death recovery
