# Testing and Evaluation

## 1. Testing Stack
- **Vitest**: Fast, Vite-native unit and integration testing for shared domain logic and web components.
- **fast-check**: Property-based testing for complex state machines (e.g., sync conflict resolution, macro calculations).
- **React Native Testing Library (RNTL)**: Component and integration testing for the mobile app.
- **Maestro**: Declarative E2E testing for the mobile application (UI automation).
- **Playwright**: E2E testing for the responsive web application.

## 2. Required CI Gates
Before any code is merged, it must pass:
1. **Lint**: ESLint / Prettier compliance.
2. **Typecheck**: Zero TypeScript errors (`tsc --noEmit`).
3. **Tests**: All unit and integration tests pass.
4. **Node-Purity**: Ensure domain logic packages do not import environment-specific APIs (no `window` or `react-native` in core).
5. **Data-Verify**: Validation scripts run against the bundled `nutrition.db` to ensure schema integrity and no missing required fields.

## 3. Test Types
- **Unit**: Isolated tests for pure functions (e.g., calorie calculations, date formatting).
- **Property**: Ensuring algorithms (like unit conversions) hold true for a wide range of fuzzed inputs.
- **Integration**: Testing module interactions (e.g., dispatching an action and verifying the SQLite database updates).
- **Migration**: Automated tests verifying schema upgrades from version N to N+1 without data loss.
- **Backup**: Exporting a state, resetting the DB, importing the state, and verifying deep equality.
- **Component**: Testing UI rendering and user interactions in isolation.
- **E2E**: Full-stack journeys mimicking real user behavior.

## 4. Critical E2E User Journeys (The 12 Prompts)
Automated E2E tests must cover the following core journeys to prevent regressions:
1. Search and log a standard food item.
2. Create and log a custom recipe.
3. Start an empty workout and log a set.
4. Execute a pre-planned workout routine.
5. Take a photo of food and accept the AI interpretation.
6. Edit a past log to change the quantity.
7. Switch the app to offline mode, log data, and verify sync upon reconnection.
8. Complete the user onboarding flow.
9. View weekly progress charts.
10. Export user data to CSV.
11. Attempt to log in with invalid credentials.
12. Scan a barcode and save a new food item from the nutrition label.

## 5. Nutrition Evaluation Framework
Evaluating the AI's accuracy is critical. We use an automated evaluation harness:
- **Fixture Sets**: A curated dataset of 500+ images/prompts representing diverse meals (including complex Indian dishes).
- **Metrics**:
  - *Identification Top-1/3*: Does the AI correctly identify the main components in its top 1 or top 3 guesses?
  - *Portion MAE/MAPE*: Mean Absolute Error and Mean Absolute Percentage Error for quantity estimation (e.g., guessing 150g vs actual 200g).
  - *Calorie/Macro MAE/MAPE*: Accuracy of the final nutritional payload.
  - *Coverage*: Percentage of fixtures successfully processed without fallback.
  - *Clarification Efficiency*: How often does the AI need to ask the user for clarifying details?
  - *Calibration*: Does the AI's confidence score accurately reflect its empirical success rate?

## 6. Training Tests
Specific edge cases in the workout domain must be heavily tested:
- **e1RM**: Calculations for estimated 1 Rep Max based on different formulas (Brzycki, Epley).
- **PR Types**: Differentiating between Volume PRs, Weight PRs, and Rep PRs.
- **Warm-up Exclusion**: Ensuring warm-up sets do not skew volume or PR calculations.
- **Planned/Actual**: Validating that modifying a planned set during a workout updates the 'actual' state without destroying the template.
- **Per-Hand/Total**: Correctly doubling weights for dumbbell exercises vs barbell when calculating total volume.
- **Plate Inventory**: Verifying the plate math calculator suggests correct plates for a target weight.
- **Muscle-Set Rules**: Ensuring volume attribution correctly maps to primary/secondary muscle groups.
- **Session Recovery**: Force-quitting the app during a workout and verifying state is recovered upon restart.
- **Replacement Identity**: Swapping an exercise in a routine mid-workout and ensuring history is tracked correctly.

## 7. Performance Budgets
- **Cold Start**: App must be interactive within 1.5 seconds on a mid-range Android device.
- **Search Latency**: Local SQLite FTS must return results in < 50ms.
- **Set Completion**: Tapping 'Complete Set' must update UI in < 16ms (1 frame).
- **Screen Responsiveness**: No dropped frames during tab switching.
- **Backup Size/Time**: A 1-year database must export in < 2 seconds.
- **Sync Batching**: Processing 100 outbox items must take < 3 seconds of background processing.
- **Photo Preprocessing**: Compressing and stripping EXIF from a 12MP photo must occur in < 500ms.

## 8. Accessibility & Security Checks
- **a11y**: Automated axe-core checks integrated into component tests.
- **Security**: Regular `npm audit` and static analysis for hardcoded secrets in the pipeline.

## 9. CI Pipeline Stages
1. **Pre-commit**: Husky runs Lint + Typecheck on staged files.
2. **Pull Request**: Runs Unit, Integration, Component tests, and Node-Purity checks.
3. **Merge to Main**: Runs the full suite, including E2E (Playwright/Maestro) on emulators, and executes the Nutrition Evaluation Framework against a subset of fixtures.
4. **Release**: Full evaluation suite, security scans, and automated deployment to staging environments.
