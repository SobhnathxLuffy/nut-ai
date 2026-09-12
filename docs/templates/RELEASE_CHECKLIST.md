# Release Checklist

## Pre-Release Verification

### Code Quality
- [ ] `npm run check` passes (lint + typecheck + test + node-purity + data-verify)
- [ ] All property tests pass with extended iterations
- [ ] Migration tests pass from every shipped schema version
- [ ] Backup round-trip tests pass for every shipped backup format version
- [ ] No TypeScript `any` casts without documented justification

### Security
- [ ] No API secrets in APK/web bundle/Expo config/EXPO_PUBLIC_* variables
- [ ] BYO keys stored in expo-secure-store only
- [ ] EXIF/GPS stripped from photos before cloud analysis
- [ ] AI/OCR output treated as untrusted data
- [ ] Backup files validated before restore
- [ ] SQL queries use parameterized statements
- [ ] Supabase RLS policies verified (if sync is enabled)

### Privacy
- [ ] Progress photos local-only by default
- [ ] Meal-photo retention policy enforced
- [ ] No meal, body, or credential data in crash reports/logs
- [ ] Export data includes everything user-owned
- [ ] Delete/clear data actually removes it
- [ ] Privacy policy reflects actual data handling

### Licensing
- [ ] AGPL-3.0-or-later LICENSE file present and correct
- [ ] §7 app-store permission preserved
- [ ] Source code availability obligations documented
- [ ] THIRD-PARTY-DATA.md complete and accurate
- [ ] IFCT permission evidence attached (if IFCT data included)
- [ ] IFCT attribution present in app and repository
- [ ] Open Food Facts ODbL compliance verified (if OFF data included)
- [ ] USDA attribution present
- [ ] All data source manifests have version/hash records

### Accessibility
- [ ] All interactive elements have accessibility labels
- [ ] Focus order is logical
- [ ] Dynamic type/text scaling works
- [ ] Touch targets meet minimum size (48dp)
- [ ] Sufficient color contrast
- [ ] Reduced motion respected
- [ ] Screen reader announces state changes

### Performance
- [ ] Cold start < 3 seconds on mid-range Android
- [ ] Local search < 200ms
- [ ] Set completion persistence < 100ms
- [ ] Backup export completes in reasonable time
- [ ] App size within budget

### Medical/Legal
- [ ] Medical disclaimer visible during onboarding and in About
- [ ] App does not claim to be a medical device
- [ ] Safety guards for extreme calorie targets
- [ ] Referral to professionals for medically relevant goals

## Platform-Specific

### Android
- [ ] Release APK builds and installs
- [ ] Camera, barcode, label modes work
- [ ] SQLite databases persist across app updates
- [ ] Backup export/import works via file system
- [ ] Health Connect integration works (if enabled)

### iOS (if releasing)
- [ ] Release build compiles
- [ ] Signing configured
- [ ] HealthKit integration works (if enabled)
- [ ] Photo library access works

### Web (if releasing)
- [ ] Production build works
- [ ] Offline mode functions
- [ ] Responsive layout verified
- [ ] Sync with mobile verified
