#!/bin/bash
sed -i '/vi.mock..expo-file-system.,/i \
vi.mock("../db/expo-adapter", () => ({\
  openIfctDb: vi.fn().mockResolvedValue({}),\
  openNutritionDb: vi.fn().mockResolvedValue({})\
}))\
\
vi.mock("../db/portions", () => ({\
  loadFoodDb: vi.fn().mockResolvedValue({})\
}))\
' apps/mobile/src/scan/photo-privacy.test.ts
