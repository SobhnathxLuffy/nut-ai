# Mobile and Web UX Specifications

## 1. UX Philosophy
- **Calm Design**: The application uses a muted, neutral color palette. No "shame colors" (e.g., glaring reds when a user exceeds a calorie goal). Red is reserved strictly for destructive actions (deleting data) or safety warnings.
- **Metrics-First with Imperial Conversion**: Core data is processed and stored in metric units (grams, kg, cm) for precision. Imperial conversions (lbs, oz, inches) are applied at the presentation layer based on user preference.

## 2. Mobile 5-Tab Navigation

### 2.1. Home Tab
- **Purpose**: A unified daily timeline showing everything that happened today.
- **Entry/Exit**: Default landing screen. Navigates to details of specific logs.
- **Information Hierarchy**:
  1. High-level daily summary (Macros, Calories remaining).
  2. Chronological timeline of meals and workouts.
  3. Quick-add FAB (Floating Action Button).
- **Actions**: Log food, Start workout, Edit past log.
- **States**:
  - *Default*: Shows today's timeline.
  - *Empty*: "Your day is a blank canvas. Tap + to start logging."
  - *Loading*: Skeleton loaders for timeline items.
- **Accessibility**: ARIA labels for timeline items indicating time and type.

### 2.2. Food Tab
- **Purpose**: Dedicated space for nutrition planning, recipes, and detailed food search.
- **Entry/Exit**: From nav bar. Can drill down into Recipe Editor.
- **Information Hierarchy**:
  1. Search bar / Scan barcode.
  2. Recent foods / Saved Meals.
  3. Recipe collection.
- **Actions**: Search database, Scan barcode/label, Create recipe.
- **States**:
  - *Offline*: Shows banner indicating cloud search is unavailable, falls back to local DB.
  - *Permission-Denied*: Camera placeholder with prompt to enable permissions for scanning.

### 2.3. Train Tab
- **Purpose**: Workout planning, execution, and exercise library.
- **Entry/Exit**: From nav bar. Drills down into Active Workout or Routine builder.
- **Information Hierarchy**:
  1. Next planned routine.
  2. Active routines / Programs.
  3. Exercise library search.
- **Actions**: Start empty workout, Start routine, Browse exercises.
- **Active Workout Mini-Card**: When a workout is running, a persistent mini-card appears above the bottom tab bar globally, showing duration and current exercise, allowing quick return to the active session.

### 2.4. Progress Tab
- **Purpose**: Long-term trends, body measurements, and performance tracking.
- **Entry/Exit**: From nav bar.
- **Information Hierarchy**:
  1. Weight trend graph.
  2. Macro averages (weekly/monthly).
  3. 1RM/PR trends for key lifts.
- **States**:
  - *Partial-Data*: If less than a week of data, shows "Keep logging to unlock trend insights."

### 2.5. You Tab (Settings/Profile)
- **Purpose**: Account management, app settings, and data export.
- **Entry/Exit**: From nav bar.
- **Information Hierarchy**: Profile -> Sync Status -> App Preferences -> Data Management.
- **Actions**: Login/Signup, Toggle themes, Export CSV, Trigger manual sync.

## 3. Camera Modes
The camera view (accessed via FAB or Food tab) supports four distinct modes, swipeable at the bottom:
1. **Food**: General object recognition for plate estimation.
2. **Barcode**: Standard 1D/2D barcode scanning.
3. **Label**: OCR mode specifically tuned for reading nutritional information panels.
4. **Receipt**: OCR for capturing grocery store receipts for bulk entry.

## 4. Key Flows & Modals

### Onboarding Flow
1. **Welcome**: Value proposition (Offline, Private, AI-assisted).
2. **Goals**: Select primary goal (Cut, Bulk, Maintain).
3. **Metrics**: Input baseline (Height, Weight, Age, Gender).
4. **Permissions**: Request camera (with explanation) and notifications.
5. **Completion**: Lands on Home tab.

### Result Review/Correction Modal
- Used after AI processing (photo or voice).
- Shows AI's interpretation with confidence scores.
- User can tap any interpreted item to swap it with a database search result or manually edit the quantity before committing to the log.

### Recipe Editor Modal
- Full-screen modal.
- Inputs for Title, Servings/Yield.
- Dynamic list of ingredients.
- Real-time macro calculation summary at the bottom as ingredients are added/modified.

## 5. Web Responsive Layout
- **Layout**: Uses a responsive sidebar configuration.
  - *Mobile/Tablet*: Bottom navigation bar matches the mobile app.
  - *Desktop*: Bottom tabs move to a fixed left sidebar. The main content area expands.
- **Header**: Contains global search, active workout indicator, and user profile avatar.

## 6. Accessibility Standards
- **Labels**: Every icon button must have a descriptive accessibility label.
- **Focus Order**: Logical top-to-bottom, left-to-right tab order for keyboard navigation (crucial for Web).
- **Dynamic Type**: Text must scale smoothly up to 200% without breaking layouts.
- **Touch Targets**: Minimum 44x44pt touch areas for all interactive elements.
- **Contrast**: Minimum contrast ratio of 4.5:1 for normal text and 3:1 for UI components.
- **Reduced Motion**: Respect OS-level "Reduce Motion" settings by disabling non-essential animations (e.g., confetti on hitting a goal, complex page transitions).

## 7. Hardcoded Strings Inventory (i18n Foundation)
All user-facing text must be extracted to dictionary files (e.g., `en.json`) from day one to support future localization.
- *Examples*: `nav.home`, `nav.food`, `action.save`, `error.network_offline`, `empty_state.timeline`.
- Avoid string concatenation for sentences; use interpolation variables (e.g., `"Logged {calories} kcal"`).
