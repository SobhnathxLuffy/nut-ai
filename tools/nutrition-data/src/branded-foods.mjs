/**
 * The curated branded tier — offline barcode lookups (task 11-c).
 *
 * A self-authored, representative dataset of real packaged products so a scan
 * of a common or uncommon brand can hit the bundled corpus BEFORE any network
 * call (scan orchestrator: corpus hit costs nothing, OFF is the fallback).
 *
 * HONEST PROVENANCE — read this before trusting a row:
 *
 *   Nutrition  per-100 g values are approximated from public package labels
 *              from best label knowledge. They are plausible and internally
 *              consistent (kcal ≈ 4P+4C+9F), but they are NOT transcription
 *              verified and NOT USDA/FDC data. The license column
 *              ('curated-representative') keeps that distinction visible.
 *
 *   Barcodes   format-valid by construction: representative codes use a real
 *              GS1 country prefix (890 = GS1 India; the international ones
 *              use the brand's real home-market prefix) over a plausible
 *              12-digit base, with the check digit COMPUTED HERE at module
 *              load, so every code passes GS1 mod-10 validation guaranteed.
 *              Company-level prefix digits below the country prefix are
 *              best-recollection and were NOT verified against the GS1
 *              registry; a representative code could therefore collide with
 *              an unallocated or differently-labelled real code. Entries
 *              marked `documented: true` use a full EAN-13 that is widely
 *              published for that exact product (best-effort recollection,
 *              still not scanned-and-verified).
 *
 *   Servings   every product carries serving_size_g > 0 plus the household
 *              serving text as printed on the label.
 *
 * The build (build.mjs) re-validates every check digit and de-duplicates
 * barcodes before inserting, failing the build loudly instead of shipping a
 * dead barcode. branded-foods.test.mjs pins all of this with vitest.
 */

/** GS1 mod-10 check digit over the digit string excluding its check digit. */
export function gs1CheckDigit(digitsWithoutCheck) {
  let sum = 0
  // Weights alternate 3,1 from the RIGHTMOST position of the body — the same
  // algorithm packages/resolver/src/gtin.ts applies at scan time.
  const reversed = [...digitsWithoutCheck].reverse()
  reversed.forEach((ch, i) => {
    const n = Number(ch)
    sum += i % 2 === 0 ? n * 3 : n
  })
  return (10 - (sum % 10)) % 10
}

/** Full 13-digit EAN-13 from its 12-digit base; the check digit is computed. */
export function ean13(base12) {
  return `${base12}${gs1CheckDigit(base12)}`
}

/**
 * Representative base12 codes per brand. Country prefix is real; company
 * digits are representative (see the provenance note above).
 */
const B = {
  amul: '8901262',
  nestle: '8901058',
  parle: '8901063',
  parleAgro: '8901071',
  britannia: '8901051',
  haldirams: '8901035',
  mdh: '8901036',
  everest: '8901037',
  tata: '8906001',
  fortune: '8906100',
  itc: '8901725',
  pepsicoIndia: '8901763',
  cocacolaIndia: '8901764',
  mondelezIndia: '8901030',
  horlicks: '8901039',
  complan: '8901038',
  nutralite: '8901032',
  aachi: '8901033',
  sakthi: '8901041',
  s777: '8901042',
  eastern: '8901043',
  weikfield: '8901044',
  chings: '8901045',
  knorr: '8901046',
  topRamen: '8901047',
  motherDairy: '8901048',
  paperBoat: '8901049',
  rawPressery: '8901050',
  yogaBar: '8901052',
  healthKart: '8901053',
  kelloggs: '8901199',
  dabur: '8901006',
  patanjali: '8904107',
  ferrero: '8000500',
  heinz: '8710900',
  bisleri: '8901070',
}

export const BRANDED_FOODS = [
  // --- Amul (GCMMF) -------------------------------------------------------
  {
    name: 'Amul Butter', brand: 'Amul', barcode: ean13(`${B.amul}00101`),
    servingSizeG: 10, servingDesc: '1 teaspoon (10 g)',
    per100g: { energy_kcal: 717, protein_g: 0.8, fat_g: 81, carb_g: 0.5, fiber_g: 0, sugar_g: 0.5, sodium_mg: 24 },
  },
  {
    name: 'Amul Taaza Toned Milk', brand: 'Amul', barcode: ean13(`${B.amul}00201`),
    servingSizeG: 200, servingDesc: '1 glass (200 ml)',
    per100g: { energy_kcal: 58, protein_g: 3.1, fat_g: 3.0, carb_g: 4.9, fiber_g: 0, sugar_g: 4.9, sodium_mg: 52 },
  },
  {
    name: 'Amul Gold Full Cream Milk', brand: 'Amul', barcode: ean13(`${B.amul}00301`),
    servingSizeG: 200, servingDesc: '1 glass (200 ml)',
    per100g: { energy_kcal: 88, protein_g: 3.2, fat_g: 6.5, carb_g: 4.9, fiber_g: 0, sugar_g: 4.9, sodium_mg: 52 },
  },
  {
    name: 'Amul Cheese Slices', brand: 'Amul', barcode: ean13(`${B.amul}00401`),
    servingSizeG: 20, servingDesc: '1 slice (20 g)',
    per100g: { energy_kcal: 335, protein_g: 20, fat_g: 26.5, carb_g: 3.5, fiber_g: 0, sugar_g: 0, sodium_mg: 1390 },
  },
  {
    name: 'Amul Masti Dahi', brand: 'Amul', barcode: ean13(`${B.amul}00501`),
    servingSizeG: 100, servingDesc: '1 serving (100 g)',
    per100g: { energy_kcal: 60, protein_g: 3.1, fat_g: 3.0, carb_g: 4.7, fiber_g: 0, sugar_g: 4.7, sodium_mg: 50 },
  },
  {
    name: 'Amul Vanilla Ice Cream', brand: 'Amul', barcode: ean13(`${B.amul}00601`),
    servingSizeG: 100, servingDesc: '1 scoop bowl (100 g)',
    per100g: { energy_kcal: 207, protein_g: 3.5, fat_g: 11, carb_g: 24, fiber_g: 0.5, sugar_g: 20, sodium_mg: 80 },
  },
  {
    name: 'Amul Lassi', brand: 'Amul', barcode: ean13(`${B.amul}00701`),
    servingSizeG: 200, servingDesc: '1 glass (200 ml)',
    per100g: { energy_kcal: 80, protein_g: 2.9, fat_g: 2.7, carb_g: 12, fiber_g: 0, sugar_g: 11, sodium_mg: 45 },
  },
  {
    name: 'Amul Dark Chocolate 55% Cocoa', brand: 'Amul', barcode: ean13(`${B.amul}00801`),
    servingSizeG: 25, servingDesc: '4 squares (25 g)',
    per100g: { energy_kcal: 545, protein_g: 6.5, fat_g: 33, carb_g: 47, fiber_g: 4, sugar_g: 40, sodium_mg: 20 },
  },
  {
    name: 'Amul Pure Ghee', brand: 'Amul', barcode: ean13(`${B.amul}00901`),
    servingSizeG: 14, servingDesc: '1 tablespoon (14 g)',
    per100g: { energy_kcal: 900, protein_g: 0, fat_g: 100, carb_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 4 },
  },
  {
    name: 'Amul Kesar Elaichi Shrikhand', brand: 'Amul', barcode: ean13(`${B.amul}01001`),
    servingSizeG: 100, servingDesc: '1 serving (100 g)',
    per100g: { energy_kcal: 235, protein_g: 4.5, fat_g: 7, carb_g: 38, fiber_g: 0, sugar_g: 34, sodium_mg: 70 },
  },

  // --- Nestlé India -------------------------------------------------------
  // The 890105800001x base is the widely-published Maggi Masala family, but the
  // full 13-digit code could NOT be recalled with a trusted check digit, so this
  // stays a REPRESENTATIVE code (computed) rather than claiming `documented`.
  {
    name: 'Maggi 2-Minute Noodles Masala', brand: 'Nestlé', barcode: ean13(`${B.nestle}00001`),
    servingSizeG: 70, servingDesc: '1 pack (70 g)',
    per100g: { energy_kcal: 443, protein_g: 9.1, fat_g: 16.4, carb_g: 60.2, fiber_g: 2.8, sugar_g: 2.2, sodium_mg: 1153 },
  },
  {
    name: 'Maggi Nutri-Licious Masala Oats Noodles', brand: 'Nestlé', barcode: ean13(`${B.nestle}00201`),
    servingSizeG: 70, servingDesc: '1 pack (70 g)',
    per100g: { energy_kcal: 400, protein_g: 10, fat_g: 13, carb_g: 62, fiber_g: 4.5, sugar_g: 2.5, sodium_mg: 940 },
  },
  {
    name: 'Maggi Healthy Soups Sweet Corn', brand: 'Nestlé', barcode: ean13(`${B.nestle}00301`),
    servingSizeG: 48, servingDesc: '1 bowl, prepared (200 ml)',
    per100g: { energy_kcal: 375, protein_g: 5, fat_g: 5, carb_g: 75, fiber_g: 2, sugar_g: 4, sodium_mg: 1458 },
  },
  {
    name: 'KitKat 4 Finger', brand: 'Nestlé', barcode: ean13(`${B.nestle}00401`),
    servingSizeG: 41.7, servingDesc: '1 pack (41.7 g)',
    per100g: { energy_kcal: 520, protein_g: 6.5, fat_g: 26.5, carb_g: 65, fiber_g: 2, sugar_g: 51, sodium_mg: 130 },
  },
  {
    name: 'Munch Crunchy Wafer', brand: 'Nestlé', barcode: ean13(`${B.nestle}00501`),
    servingSizeG: 22, servingDesc: '1 pack (22 g)',
    per100g: { energy_kcal: 520, protein_g: 6.8, fat_g: 26, carb_g: 65, fiber_g: 2, sugar_g: 50, sodium_mg: 140 },
  },
  {
    name: 'Milkmaid Sweetened Condensed Milk', brand: 'Nestlé', barcode: ean13(`${B.nestle}00601`),
    servingSizeG: 30, servingDesc: '2 tablespoons (30 g)',
    per100g: { energy_kcal: 321, protein_g: 7.5, fat_g: 4.0, carb_g: 61, fiber_g: 0, sugar_g: 58, sodium_mg: 110 },
  },
  {
    name: 'Nescafé Classic Instant Coffee', brand: 'Nestlé', barcode: ean13(`${B.nestle}00701`),
    servingSizeG: 2, servingDesc: '1 cup (2 g)',
    per100g: { energy_kcal: 350, protein_g: 12, fat_g: 0.5, carb_g: 68, fiber_g: 2, sugar_g: 0, sodium_mg: 60 },
  },
  {
    name: 'Cerelac Wheat Infant Cereal', brand: 'Nestlé', barcode: ean13(`${B.nestle}00801`),
    servingSizeG: 50, servingDesc: '1 feed (50 g powder)',
    per100g: { energy_kcal: 435, protein_g: 13, fat_g: 10, carb_g: 68, fiber_g: 4, sugar_g: 22, sodium_mg: 185 },
  },

  // --- Parle / Parle Agro -------------------------------------------------
  // The 89010630144x base is the widely-published Parle-G family, but the
  // commonly quoted full 13-digit string fails the GS1 check digit, so this
  // stays a REPRESENTATIVE code (computed) rather than claiming `documented`.
  {
    name: 'Parle-G Original Gluco Biscuits', brand: 'Parle', barcode: ean13(`${B.parle}00144`),
    servingSizeG: 25, servingDesc: '5 biscuits (25 g)',
    per100g: { energy_kcal: 453, protein_g: 6.5, fat_g: 13.5, carb_g: 76, fiber_g: 1, sugar_g: 25, sodium_mg: 343 },
  },
  {
    name: 'Parle Monaco Classic Regular', brand: 'Parle', barcode: ean13(`${B.parle}00201`),
    servingSizeG: 23, servingDesc: '5 biscuits (23 g)',
    per100g: { energy_kcal: 470, protein_g: 7, fat_g: 19, carb_g: 68, fiber_g: 2, sugar_g: 3, sodium_mg: 700 },
  },
  {
    name: 'Parle Hide & Seek Chocolate Chip Cookies', brand: 'Parle', barcode: ean13(`${B.parle}00301`),
    servingSizeG: 22, servingDesc: '4 biscuits (22 g)',
    per100g: { energy_kcal: 480, protein_g: 6, fat_g: 20, carb_g: 70, fiber_g: 2, sugar_g: 28, sodium_mg: 350 },
  },
  {
    name: 'Parle Krack Jack Sweet & Salted', brand: 'Parle', barcode: ean13(`${B.parle}00401`),
    servingSizeG: 26, servingDesc: '4 biscuits (26 g)',
    per100g: { energy_kcal: 460, protein_g: 7, fat_g: 16, carb_g: 71, fiber_g: 2, sugar_g: 15, sodium_mg: 550 },
  },
  {
    name: 'Parle Melody Chocolatey', brand: 'Parle', barcode: ean13(`${B.parle}00501`),
    servingSizeG: 6.5, servingDesc: '1 candy (6.5 g)',
    per100g: { energy_kcal: 420, protein_g: 3.5, fat_g: 12, carb_g: 74, fiber_g: 1, sugar_g: 45, sodium_mg: 180 },
  },
  {
    name: 'Parle Poppins Orange', brand: 'Parle', barcode: ean13(`${B.parle}00601`),
    servingSizeG: 5, servingDesc: '1 candy (5 g)',
    per100g: { energy_kcal: 385, protein_g: 0, fat_g: 0.5, carb_g: 95, fiber_g: 0, sugar_g: 90, sodium_mg: 20 },
  },
  {
    name: 'Frooti Mango Nectar', brand: 'Parle Agro', barcode: ean13(`${B.parleAgro}00201`),
    servingSizeG: 200, servingDesc: '1 pack (200 ml)',
    per100g: { energy_kcal: 62, protein_g: 0.1, fat_g: 0, carb_g: 15.5, fiber_g: 0.1, sugar_g: 13.5, sodium_mg: 10 },
  },
  {
    name: 'Appy Fizz Sparkling Apple Drink', brand: 'Parle Agro', barcode: ean13(`${B.parleAgro}00301`),
    servingSizeG: 250, servingDesc: '1 glass (250 ml)',
    per100g: { energy_kcal: 46, protein_g: 0, fat_g: 0, carb_g: 11.5, fiber_g: 0, sugar_g: 11, sodium_mg: 12 },
  },

  // --- Britannia ----------------------------------------------------------
  {
    name: 'Britannia Marie Gold Tea Time Biscuits', brand: 'Britannia', barcode: ean13(`${B.britannia}00201`),
    servingSizeG: 16, servingDesc: '5 biscuits (16 g)',
    per100g: { energy_kcal: 448, protein_g: 7, fat_g: 12.5, carb_g: 74, fiber_g: 2.5, sugar_g: 14, sodium_mg: 320 },
  },
  {
    name: 'Britannia Good Day Cashew Cookies', brand: 'Britannia', barcode: ean13(`${B.britannia}00301`),
    servingSizeG: 25, servingDesc: '4 biscuits (25 g)',
    per100g: { energy_kcal: 480, protein_g: 6.5, fat_g: 18, carb_g: 72, fiber_g: 2, sugar_g: 24, sodium_mg: 300 },
  },
  {
    name: 'Britannia 50-50 Masti Masala Munch', brand: 'Britannia', barcode: ean13(`${B.britannia}00401`),
    servingSizeG: 23, servingDesc: '5 biscuits (23 g)',
    per100g: { energy_kcal: 480, protein_g: 8, fat_g: 18, carb_g: 69, fiber_g: 2, sugar_g: 4, sodium_mg: 850 },
  },
  {
    name: 'Britannia NutriChoice Digestive Zero', brand: 'Britannia', barcode: ean13(`${B.britannia}00501`),
    servingSizeG: 17, servingDesc: '3 biscuits (17 g)',
    per100g: { energy_kcal: 445, protein_g: 8, fat_g: 15, carb_g: 66, fiber_g: 8, sugar_g: 2, sodium_mg: 480 },
  },
  {
    name: 'Britannia Milk Bikis', brand: 'Britannia', barcode: ean13(`${B.britannia}00601`),
    servingSizeG: 25, servingDesc: '6 biscuits (25 g)',
    per100g: { energy_kcal: 455, protein_g: 7.5, fat_g: 13, carb_g: 72, fiber_g: 1.5, sugar_g: 22, sodium_mg: 280 },
  },

  // --- Haldiram's ---------------------------------------------------------
  {
    name: "Haldiram's Aloo Bhujia", brand: "Haldiram's", barcode: ean13(`${B.haldirams}00201`),
    servingSizeG: 30, servingDesc: '1 bowl (30 g)',
    per100g: { energy_kcal: 531, protein_g: 8, fat_g: 32, carb_g: 52, fiber_g: 4, sugar_g: 2, sodium_mg: 1200 },
  },
  {
    name: "Haldiram's Moong Dal Namkeen", brand: "Haldiram's", barcode: ean13(`${B.haldirams}00301`),
    servingSizeG: 30, servingDesc: '1 bowl (30 g)',
    per100g: { energy_kcal: 515, protein_g: 12, fat_g: 28, carb_g: 50, fiber_g: 4, sugar_g: 2, sodium_mg: 800 },
  },
  {
    name: "Haldiram's Soan Papdi", brand: "Haldiram's", barcode: ean13(`${B.haldirams}00401`),
    servingSizeG: 25, servingDesc: '1 piece (25 g)',
    per100g: { energy_kcal: 480, protein_g: 6, fat_g: 22, carb_g: 66, fiber_g: 1.5, sugar_g: 40, sodium_mg: 90 },
  },
  {
    name: "Haldiram's Kaju Katli", brand: "Haldiram's", barcode: ean13(`${B.haldirams}00501`),
    servingSizeG: 20, servingDesc: '1 piece (20 g)',
    per100g: { energy_kcal: 520, protein_g: 9.5, fat_g: 33, carb_g: 46, fiber_g: 2, sugar_g: 30, sodium_mg: 65 },
  },
  {
    name: "Haldiram's Dal Makhani Ready to Eat", brand: "Haldiram's", barcode: ean13(`${B.haldirams}00601`),
    servingSizeG: 285, servingDesc: '1 tray (285 g)',
    per100g: { energy_kcal: 120, protein_g: 4.5, fat_g: 5.5, carb_g: 14, fiber_g: 3, sugar_g: 2.5, sodium_mg: 480 },
  },

  // --- MDH / Everest (spice mixes; salted mixes carry real label sodium) ---
  {
    name: 'MDH Garam Masala', brand: 'MDH', barcode: ean13(`${B.mdh}00201`),
    servingSizeG: 3, servingDesc: '1 teaspoon (3 g)',
    per100g: { energy_kcal: 380, protein_g: 12, fat_g: 12, carb_g: 55, fiber_g: 30, sugar_g: 3, sodium_mg: 150 },
  },
  {
    name: 'MDH Deggi Mirch Chilli Powder', brand: 'MDH', barcode: ean13(`${B.mdh}00301`),
    servingSizeG: 3, servingDesc: '1 teaspoon (3 g)',
    per100g: { energy_kcal: 380, protein_g: 12, fat_g: 12, carb_g: 52, fiber_g: 28, sugar_g: 8, sodium_mg: 70 },
  },
  {
    name: 'MDH Chana Masala', brand: 'MDH', barcode: ean13(`${B.mdh}00401`),
    servingSizeG: 5, servingDesc: '2 teaspoons (5 g)',
    per100g: { energy_kcal: 350, protein_g: 12, fat_g: 12, carb_g: 48, fiber_g: 24, sugar_g: 4, sodium_mg: 9500 },
  },
  {
    name: 'MDH Pav Bhaji Masala', brand: 'MDH', barcode: ean13(`${B.mdh}00501`),
    servingSizeG: 5, servingDesc: '2 teaspoons (5 g)',
    per100g: { energy_kcal: 380, protein_g: 12, fat_g: 13, carb_g: 52, fiber_g: 25, sugar_g: 4, sodium_mg: 8800 },
  },
  {
    name: 'Everest Garam Masala', brand: 'Everest', barcode: ean13(`${B.everest}00201`),
    servingSizeG: 3, servingDesc: '1 teaspoon (3 g)',
    per100g: { energy_kcal: 375, protein_g: 11, fat_g: 12, carb_g: 54, fiber_g: 28, sugar_g: 3, sodium_mg: 220 },
  },
  {
    name: 'Everest Chicken Masala', brand: 'Everest', barcode: ean13(`${B.everest}00301`),
    servingSizeG: 8, servingDesc: '2 teaspoons (8 g)',
    per100g: { energy_kcal: 390, protein_g: 12, fat_g: 14, carb_g: 52, fiber_g: 24, sugar_g: 4, sodium_mg: 9200 },
  },
  {
    name: 'Everest Turmeric Powder', brand: 'Everest', barcode: ean13(`${B.everest}00401`),
    servingSizeG: 3, servingDesc: '1 teaspoon (3 g)',
    per100g: { energy_kcal: 349, protein_g: 8, fat_g: 4, carb_g: 65, fiber_g: 21, sugar_g: 2.5, sodium_mg: 55 },
  },

  // --- Tata / Fortune / Aashirvaad ----------------------------------------
  {
    name: 'Tata Salt Iodised', brand: 'Tata', barcode: ean13(`${B.tata}00101`),
    servingSizeG: 1.5, servingDesc: '1/4 teaspoon (1.5 g)',
    per100g: { energy_kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 38760 },
  },
  {
    name: 'Tata Tea Gold', brand: 'Tata', barcode: ean13(`${B.tata}00201`),
    servingSizeG: 2, servingDesc: '1 cup (2 g leaves)',
    per100g: { energy_kcal: 250, protein_g: 20, fat_g: 0.5, carb_g: 45, fiber_g: 8, sugar_g: 0, sodium_mg: 30 },
  },
  {
    name: 'Tata Sampann Toor Dal', brand: 'Tata', barcode: ean13(`${B.tata}00301`),
    servingSizeG: 100, servingDesc: '1/2 cup uncooked (100 g)',
    per100g: { energy_kcal: 343, protein_g: 22.3, fat_g: 1.7, carb_g: 62, fiber_g: 9, sugar_g: 2, sodium_mg: 15 },
  },
  {
    name: 'Tata Salt Lite', brand: 'Tata', barcode: ean13(`${B.tata}00401`),
    servingSizeG: 1.5, servingDesc: '1/4 teaspoon (1.5 g)',
    per100g: { energy_kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 19500 },
  },
  {
    name: 'Fortune Sunlite Refined Sunflower Oil', brand: 'Fortune', barcode: ean13(`${B.fortune}00101`),
    servingSizeG: 14, servingDesc: '1 tablespoon (14 g)',
    per100g: { energy_kcal: 900, protein_g: 0, fat_g: 100, carb_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0 },
  },
  {
    name: 'Aashirvaad Whole Wheat Atta', brand: 'Aashirvaad', barcode: ean13(`${B.itc}00201`),
    servingSizeG: 100, servingDesc: '100 g flour (about 3 medium rotis)',
    per100g: { energy_kcal: 340, protein_g: 12.6, fat_g: 1.5, carb_g: 72, fiber_g: 11, sugar_g: 0, sodium_mg: 5 },
  },

  // --- Sunfeast / Bingo (ITC) ---------------------------------------------
  {
    name: 'Sunfeast Dark Fantasy Choco Fills', brand: 'Sunfeast', barcode: ean13(`${B.itc}00301`),
    servingSizeG: 30, servingDesc: '2 cookies (30 g)',
    per100g: { energy_kcal: 480, protein_g: 5, fat_g: 20, carb_g: 70, fiber_g: 2.5, sugar_g: 35, sodium_mg: 300 },
  },
  {
    name: 'Sunfeast YiPPee Magic Masala Noodles', brand: 'Sunfeast', barcode: ean13(`${B.itc}00401`),
    servingSizeG: 70, servingDesc: '1 cake (70 g)',
    per100g: { energy_kcal: 436, protein_g: 9.5, fat_g: 15, carb_g: 63, fiber_g: 2.5, sugar_g: 3, sodium_mg: 1250 },
  },
  {
    name: 'Sunfeast Pasta Treat Masala', brand: 'Sunfeast', barcode: ean13(`${B.itc}00501`),
    servingSizeG: 70, servingDesc: '1 pack (70 g)',
    per100g: { energy_kcal: 385, protein_g: 11, fat_g: 8, carb_g: 68, fiber_g: 3, sugar_g: 4, sodium_mg: 1050 },
  },
  {
    name: 'Sunfeast Marie Light', brand: 'Sunfeast', barcode: ean13(`${B.itc}00601`),
    servingSizeG: 15, servingDesc: '5 biscuits (15 g)',
    per100g: { energy_kcal: 433, protein_g: 7, fat_g: 11, carb_g: 77, fiber_g: 1.5, sugar_g: 17, sodium_mg: 270 },
  },
  {
    name: 'Bingo Mad Angles Masala', brand: 'Bingo', barcode: ean13(`${B.itc}00701`),
    servingSizeG: 30, servingDesc: '1 bowl (30 g)',
    per100g: { energy_kcal: 520, protein_g: 6.5, fat_g: 28, carb_g: 62, fiber_g: 3, sugar_g: 3, sodium_mg: 950 },
  },
  {
    name: 'Bingo Original Style Salt Sprinkled', brand: 'Bingo', barcode: ean13(`${B.itc}00801`),
    servingSizeG: 30, servingDesc: '1 bowl (30 g)',
    per100g: { energy_kcal: 536, protein_g: 7, fat_g: 30, carb_g: 59, fiber_g: 3, sugar_g: 2.5, sodium_mg: 900 },
  },

  // --- PepsiCo India (Kurkure / Lay's / Quaker / beverages) ----------------
  {
    name: 'Kurkure Masala Munch', brand: 'Kurkure', barcode: ean13(`${B.pepsicoIndia}00201`),
    servingSizeG: 30, servingDesc: '1 bowl (30 g)',
    per100g: { energy_kcal: 543, protein_g: 7, fat_g: 31, carb_g: 59, fiber_g: 3.5, sugar_g: 3, sodium_mg: 1150 },
  },
  {
    name: 'Kurkure Green Chutney Rajasthani Style', brand: 'Kurkure', barcode: ean13(`${B.pepsicoIndia}00301`),
    servingSizeG: 30, servingDesc: '1 bowl (30 g)',
    per100g: { energy_kcal: 536, protein_g: 6.5, fat_g: 30, carb_g: 60, fiber_g: 3.5, sugar_g: 3.5, sodium_mg: 1100 },
  },
  {
    name: "Lay's India's Magic Masala", brand: "Lay's", barcode: ean13(`${B.pepsicoIndia}00401`),
    servingSizeG: 30, servingDesc: '1 bowl (30 g)',
    per100g: { energy_kcal: 536, protein_g: 6.5, fat_g: 30, carb_g: 60, fiber_g: 3, sugar_g: 3, sodium_mg: 1000 },
  },
  {
    name: "Lay's Classic Salted", brand: "Lay's", barcode: ean13(`${B.pepsicoIndia}00501`),
    servingSizeG: 30, servingDesc: '1 bowl (30 g)',
    per100g: { energy_kcal: 530, protein_g: 6.5, fat_g: 30, carb_g: 58, fiber_g: 3, sugar_g: 1.5, sodium_mg: 650 },
  },
  {
    name: "Lay's American Style Cream & Onion", brand: "Lay's", barcode: ean13(`${B.pepsicoIndia}00601`),
    servingSizeG: 30, servingDesc: '1 bowl (30 g)',
    per100g: { energy_kcal: 536, protein_g: 6, fat_g: 30, carb_g: 60, fiber_g: 3, sugar_g: 3, sodium_mg: 780 },
  },
  {
    name: 'Quaker Oats', brand: 'Quaker', barcode: ean13(`${B.pepsicoIndia}00701`),
    servingSizeG: 40, servingDesc: '1/2 cup (40 g)',
    per100g: { energy_kcal: 379, protein_g: 12.5, fat_g: 6.5, carb_g: 67, fiber_g: 10, sugar_g: 1, sodium_mg: 6 },
  },
  {
    name: 'Pepsi', brand: 'Pepsi', barcode: ean13(`${B.pepsicoIndia}00801`),
    servingSizeG: 250, servingDesc: '1 glass (250 ml)',
    per100g: { energy_kcal: 45, protein_g: 0, fat_g: 0, carb_g: 11.2, fiber_g: 0, sugar_g: 11.2, sodium_mg: 10 },
  },
  {
    name: 'Mirinda Orange', brand: 'Mirinda', barcode: ean13(`${B.pepsicoIndia}00901`),
    servingSizeG: 250, servingDesc: '1 glass (250 ml)',
    per100g: { energy_kcal: 51, protein_g: 0, fat_g: 0, carb_g: 12.8, fiber_g: 0, sugar_g: 12.5, sodium_mg: 15 },
  },
  {
    name: '7UP Lemon Lime', brand: '7UP', barcode: ean13(`${B.pepsicoIndia}01001`),
    servingSizeG: 250, servingDesc: '1 glass (250 ml)',
    per100g: { energy_kcal: 41, protein_g: 0, fat_g: 0, carb_g: 10.2, fiber_g: 0, sugar_g: 10, sodium_mg: 12 },
  },

  // --- Coca-Cola India -----------------------------------------------------
  {
    name: 'Coca-Cola Original Taste', brand: 'Coca-Cola', barcode: ean13(`${B.cocacolaIndia}00201`),
    servingSizeG: 250, servingDesc: '1 glass (250 ml)',
    per100g: { energy_kcal: 42, protein_g: 0, fat_g: 0, carb_g: 10.6, fiber_g: 0, sugar_g: 10.6, sodium_mg: 4 },
  },
  {
    name: 'Thums Up', brand: 'Thums Up', barcode: ean13(`${B.cocacolaIndia}00301`),
    servingSizeG: 300, servingDesc: '1 can (300 ml)',
    per100g: { energy_kcal: 44, protein_g: 0, fat_g: 0, carb_g: 11, fiber_g: 0, sugar_g: 11, sodium_mg: 10 },
  },
  {
    name: 'Sprite', brand: 'Sprite', barcode: ean13(`${B.cocacolaIndia}00401`),
    servingSizeG: 250, servingDesc: '1 glass (250 ml)',
    per100g: { energy_kcal: 40, protein_g: 0, fat_g: 0, carb_g: 9.8, fiber_g: 0, sugar_g: 9.8, sodium_mg: 10 },
  },
  {
    name: 'Fanta Orange', brand: 'Fanta', barcode: ean13(`${B.cocacolaIndia}00501`),
    servingSizeG: 250, servingDesc: '1 glass (250 ml)',
    per100g: { energy_kcal: 51, protein_g: 0, fat_g: 0, carb_g: 12.8, fiber_g: 0, sugar_g: 12.3, sodium_mg: 10 },
  },
  {
    name: 'Limca Lemon-Lime', brand: 'Limca', barcode: ean13(`${B.cocacolaIndia}00601`),
    servingSizeG: 250, servingDesc: '1 glass (250 ml)',
    per100g: { energy_kcal: 41, protein_g: 0, fat_g: 0, carb_g: 10.2, fiber_g: 0, sugar_g: 10, sodium_mg: 15 },
  },
  {
    name: 'Maaza Mango Drink', brand: 'Maaza', barcode: ean13(`${B.cocacolaIndia}00701`),
    servingSizeG: 250, servingDesc: '1 glass (250 ml)',
    per100g: { energy_kcal: 70, protein_g: 0.1, fat_g: 0, carb_g: 17.5, fiber_g: 0, sugar_g: 16.5, sodium_mg: 25 },
  },
  {
    name: 'Coca-Cola Zero Sugar', brand: 'Coca-Cola', barcode: ean13(`${B.cocacolaIndia}00801`),
    servingSizeG: 300, servingDesc: '1 can (300 ml)',
    per100g: { energy_kcal: 0.2, protein_g: 0, fat_g: 0, carb_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 10 },
  },

  // --- Red Bull -------------------------------------------------------------
  {
    name: 'Red Bull Energy Drink', brand: 'Red Bull', barcode: '9002490100070', documented: true,
    servingSizeG: 250, servingDesc: '1 can (250 ml)',
    per100g: { energy_kcal: 44, protein_g: 0, fat_g: 0, carb_g: 11, fiber_g: 0, sugar_g: 10.8, sodium_mg: 80 },
  },

  // --- Mondelez India (Oreo / Cadbury / Bournvita) --------------------------
  {
    name: 'Oreo Original', brand: 'Oreo', barcode: ean13(`${B.mondelezIndia}00201`),
    servingSizeG: 24, servingDesc: '6 biscuits (24 g)',
    per100g: { energy_kcal: 474, protein_g: 5, fat_g: 20, carb_g: 70, fiber_g: 2.5, sugar_g: 38, sodium_mg: 560 },
  },
  {
    name: 'Cadbury Dairy Milk', brand: 'Cadbury', barcode: ean13(`${B.mondelezIndia}00301`),
    servingSizeG: 27, servingDesc: '1/2 bar (27 g)',
    per100g: { energy_kcal: 534, protein_g: 7.3, fat_g: 29.5, carb_g: 59, fiber_g: 1.8, sugar_g: 56, sodium_mg: 180 },
  },
  {
    name: 'Cadbury Perk', brand: 'Cadbury', barcode: ean13(`${B.mondelezIndia}00401`),
    servingSizeG: 12, servingDesc: '1 bar (12 g)',
    per100g: { energy_kcal: 505, protein_g: 6.5, fat_g: 25, carb_g: 64, fiber_g: 2, sugar_g: 52, sodium_mg: 170 },
  },
  {
    name: 'Cadbury 5 Star', brand: 'Cadbury', barcode: ean13(`${B.mondelezIndia}00501`),
    servingSizeG: 45, servingDesc: '1 bar (45 g)',
    per100g: { energy_kcal: 520, protein_g: 6, fat_g: 27, carb_g: 63, fiber_g: 2, sugar_g: 48, sodium_mg: 190 },
  },
  {
    name: 'Bournvita Chocolate Health Drink', brand: 'Cadbury', barcode: ean13(`${B.mondelezIndia}00601`),
    servingSizeG: 20, servingDesc: '2 heaped teaspoons (20 g)',
    per100g: { energy_kcal: 388, protein_g: 7, fat_g: 4.5, carb_g: 80, fiber_g: 2, sugar_g: 70, sodium_mg: 350 },
  },

  // --- Malt drinks / supplements -------------------------------------------
  {
    name: 'Horlicks Classic Malt', brand: 'Horlicks', barcode: ean13(`${B.horlicks}00201`),
    servingSizeG: 25, servingDesc: '3 heaped teaspoons (25 g)',
    per100g: { energy_kcal: 378, protein_g: 12, fat_g: 2, carb_g: 73, fiber_g: 1.5, sugar_g: 47, sodium_mg: 300 },
  },
  {
    name: 'Complan Kesar Badam', brand: 'Complan', barcode: ean13(`${B.complan}00201`),
    servingSizeG: 30, servingDesc: '2 heaped tablespoons (30 g)',
    per100g: { energy_kcal: 420, protein_g: 20, fat_g: 3, carb_g: 74, fiber_g: 1.5, sugar_g: 60, sodium_mg: 300 },
  },

  // --- Spreads / margarine --------------------------------------------------
  {
    name: 'Nutralite Table Margarine', brand: 'Nutralite', barcode: ean13(`${B.nutralite}00201`),
    servingSizeG: 10, servingDesc: '1 teaspoon (10 g)',
    per100g: { energy_kcal: 720, protein_g: 0.5, fat_g: 80, carb_g: 0.5, fiber_g: 0, sugar_g: 0.5, sodium_mg: 650 },
  },

  // --- South Indian masala houses -------------------------------------------
  {
    name: 'Aachi Sambar Powder', brand: 'Aachi', barcode: ean13(`${B.aachi}00201`),
    servingSizeG: 5, servingDesc: '2 teaspoons (5 g)',
    per100g: { energy_kcal: 340, protein_g: 12, fat_g: 8, carb_g: 52, fiber_g: 24, sugar_g: 5, sodium_mg: 9000 },
  },
  {
    name: 'Aachi Rasam Powder', brand: 'Aachi', barcode: ean13(`${B.aachi}00301`),
    servingSizeG: 4, servingDesc: '2 teaspoons (4 g)',
    per100g: { energy_kcal: 330, protein_g: 13, fat_g: 7, carb_g: 50, fiber_g: 22, sugar_g: 4, sodium_mg: 8800 },
  },
  {
    name: 'Sakthi Sambar Powder', brand: 'Sakthi', barcode: ean13(`${B.sakthi}00201`),
    servingSizeG: 5, servingDesc: '2 teaspoons (5 g)',
    per100g: { energy_kcal: 335, protein_g: 12, fat_g: 8, carb_g: 52, fiber_g: 24, sugar_g: 5, sodium_mg: 9100 },
  },
  {
    name: 'Sakthi Chicken Masala', brand: 'Sakthi', barcode: ean13(`${B.sakthi}00301`),
    servingSizeG: 8, servingDesc: '2 teaspoons (8 g)',
    per100g: { energy_kcal: 380, protein_g: 13, fat_g: 12, carb_g: 54, fiber_g: 22, sugar_g: 4, sodium_mg: 8600 },
  },
  {
    name: '777 Mixed Vegetable Pickle', brand: '777', barcode: ean13(`${B.s777}00201`),
    servingSizeG: 15, servingDesc: '1 tablespoon (15 g)',
    per100g: { energy_kcal: 180, protein_g: 2, fat_g: 12, carb_g: 14, fiber_g: 4, sugar_g: 9, sodium_mg: 6500 },
  },
  {
    name: 'Eastern Meat Masala', brand: 'Eastern', barcode: ean13(`${B.eastern}00201`),
    servingSizeG: 8, servingDesc: '2 teaspoons (8 g)',
    per100g: { energy_kcal: 375, protein_g: 13, fat_g: 11, carb_g: 55, fiber_g: 22, sugar_g: 5, sodium_mg: 8400 },
  },

  // --- Weikfield / Ching's / Knorr / Top Ramen ------------------------------
  {
    name: 'Weikfield Vanilla Custard Powder', brand: 'Weikfield', barcode: ean13(`${B.weikfield}00201`),
    servingSizeG: 25, servingDesc: '2 tablespoons (25 g)',
    per100g: { energy_kcal: 380, protein_g: 0.5, fat_g: 0.5, carb_g: 94, fiber_g: 0.5, sugar_g: 2, sodium_mg: 90 },
  },
  {
    name: 'Weikfield Corn Flour', brand: 'Weikfield', barcode: ean13(`${B.weikfield}00301`),
    servingSizeG: 15, servingDesc: '2 tablespoons (15 g)',
    per100g: { energy_kcal: 354, protein_g: 0.3, fat_g: 0.1, carb_g: 88, fiber_g: 0.3, sugar_g: 0, sodium_mg: 15 },
  },
  {
    name: "Ching's Secret Schezwan Chutney", brand: "Ching's Secret", barcode: ean13(`${B.chings}00201`),
    servingSizeG: 20, servingDesc: '1 tablespoon (20 g)',
    per100g: { energy_kcal: 180, protein_g: 2, fat_g: 8, carb_g: 25, fiber_g: 3, sugar_g: 12, sodium_mg: 3800 },
  },
  {
    name: "Ching's Secret Hakka Noodles", brand: "Ching's Secret", barcode: ean13(`${B.chings}00301`),
    servingSizeG: 85, servingDesc: '1 nest (85 g)',
    per100g: { energy_kcal: 355, protein_g: 10, fat_g: 1.5, carb_g: 74, fiber_g: 2, sugar_g: 2, sodium_mg: 25 },
  },
  {
    name: 'Knorr Sweet Corn Veg Soup', brand: 'Knorr', barcode: ean13(`${B.knorr}00201`),
    servingSizeG: 44, servingDesc: '1 bowl, prepared (200 ml)',
    per100g: { energy_kcal: 380, protein_g: 5, fat_g: 4, carb_g: 78, fiber_g: 2, sugar_g: 5, sodium_mg: 2600 },
  },
  {
    name: 'Knorr Soupy Noodles Mast Masala', brand: 'Knorr', barcode: ean13(`${B.knorr}00301`),
    servingSizeG: 67, servingDesc: '1 pack (67 g)',
    per100g: { energy_kcal: 425, protein_g: 9.5, fat_g: 13, carb_g: 66, fiber_g: 3, sugar_g: 3, sodium_mg: 1300 },
  },
  {
    name: 'Top Ramen Masala Noodles', brand: 'Top Ramen', barcode: ean13(`${B.topRamen}00201`),
    servingSizeG: 70, servingDesc: '1 pack (70 g)',
    per100g: { energy_kcal: 437, protein_g: 9, fat_g: 16, carb_g: 61, fiber_g: 2.5, sugar_g: 3, sodium_mg: 1200 },
  },

  // --- Mother Dairy ----------------------------------------------------------
  {
    name: 'Mother Dairy Full Cream Milk', brand: 'Mother Dairy', barcode: ean13(`${B.motherDairy}00201`),
    servingSizeG: 200, servingDesc: '1 glass (200 ml)',
    per100g: { energy_kcal: 87, protein_g: 3.2, fat_g: 6.0, carb_g: 4.9, fiber_g: 0, sugar_g: 4.9, sodium_mg: 52 },
  },
  {
    name: 'Mother Dairy Dahi', brand: 'Mother Dairy', barcode: ean13(`${B.motherDairy}00301`),
    servingSizeG: 100, servingDesc: '1 serving (100 g)',
    per100g: { energy_kcal: 62, protein_g: 3.2, fat_g: 3.3, carb_g: 4.7, fiber_g: 0, sugar_g: 4.7, sodium_mg: 50 },
  },
  {
    name: 'Mother Dairy Toned Milk', brand: 'Mother Dairy', barcode: ean13(`${B.motherDairy}00401`),
    servingSizeG: 200, servingDesc: '1 glass (200 ml)',
    per100g: { energy_kcal: 58, protein_g: 3.1, fat_g: 3.0, carb_g: 4.9, fiber_g: 0, sugar_g: 4.9, sodium_mg: 52 },
  },

  // --- Paper Boat / Raw Pressery / Yoga Bar / HealthKart ---------------------
  {
    name: 'Paper Boat Aamras', brand: 'Paper Boat', barcode: ean13(`${B.paperBoat}00201`),
    servingSizeG: 200, servingDesc: '1 pack (200 ml)',
    per100g: { energy_kcal: 68, protein_g: 0.2, fat_g: 0, carb_g: 17, fiber_g: 0.3, sugar_g: 15.5, sodium_mg: 35 },
  },
  {
    name: 'Paper Boat Jaljeera', brand: 'Paper Boat', barcode: ean13(`${B.paperBoat}00301`),
    servingSizeG: 250, servingDesc: '1 pack (250 ml)',
    per100g: { energy_kcal: 26, protein_g: 0.1, fat_g: 0, carb_g: 6.5, fiber_g: 0, sugar_g: 5.5, sodium_mg: 120 },
  },
  {
    name: 'Raw Pressery Almond Milk Unsweetened', brand: 'Raw Pressery', barcode: ean13(`${B.rawPressery}00201`),
    servingSizeG: 200, servingDesc: '1 glass (200 ml)',
    per100g: { energy_kcal: 29, protein_g: 1, fat_g: 2.5, carb_g: 0.5, fiber_g: 0.3, sugar_g: 0, sodium_mg: 45 },
  },
  {
    name: 'Raw Pressery Protein Shake Chocolate', brand: 'Raw Pressery', barcode: ean13(`${B.rawPressery}00301`),
    servingSizeG: 200, servingDesc: '1 bottle (200 ml)',
    per100g: { energy_kcal: 68, protein_g: 6, fat_g: 2, carb_g: 7, fiber_g: 0.5, sugar_g: 5, sodium_mg: 90 },
  },
  {
    name: 'Yoga Bar Nuts & Seeds Muesli', brand: 'Yoga Bar', barcode: ean13(`${B.yogaBar}00201`),
    servingSizeG: 50, servingDesc: '3/4 cup (50 g)',
    per100g: { energy_kcal: 437, protein_g: 12, fat_g: 15, carb_g: 62, fiber_g: 9, sugar_g: 12, sodium_mg: 60 },
  },
  {
    name: 'Yoga Bar Choco Almond Protein Bar', brand: 'Yoga Bar', barcode: ean13(`${B.yogaBar}00301`),
    servingSizeG: 60, servingDesc: '1 bar (60 g)',
    per100g: { energy_kcal: 380, protein_g: 20, fat_g: 9, carb_g: 55, fiber_g: 8, sugar_g: 12, sodium_mg: 220 },
  },
  {
    name: 'HealthKart Whey Protein Premium Chocolate', brand: 'HealthKart', barcode: ean13(`${B.healthKart}00201`),
    servingSizeG: 30, servingDesc: '1 scoop (30 g)',
    per100g: { energy_kcal: 380, protein_g: 72, fat_g: 5, carb_g: 12, fiber_g: 1, sugar_g: 5, sodium_mg: 280 },
  },

  // --- Kellogg's / Dabur / Patanjali -----------------------------------------
  {
    name: "Kellogg's Corn Flakes Real Almond & Honey", brand: "Kellogg's", barcode: ean13(`${B.kelloggs}00201`),
    servingSizeG: 30, servingDesc: '1 bowl (30 g)',
    per100g: { energy_kcal: 378, protein_g: 7.5, fat_g: 1, carb_g: 82, fiber_g: 3, sugar_g: 18, sodium_mg: 350 },
  },
  {
    name: "Kellogg's Chocos", brand: "Kellogg's", barcode: ean13(`${B.kelloggs}00301`),
    servingSizeG: 30, servingDesc: '1 bowl (30 g)',
    per100g: { energy_kcal: 387, protein_g: 7, fat_g: 2.5, carb_g: 80, fiber_g: 5, sugar_g: 32, sodium_mg: 350 },
  },
  {
    name: 'Dabur Real Fruit Power Mixed Fruit', brand: 'Dabur', barcode: ean13(`${B.dabur}00201`),
    servingSizeG: 200, servingDesc: '1 glass (200 ml)',
    per100g: { energy_kcal: 55, protein_g: 0.3, fat_g: 0, carb_g: 13.5, fiber_g: 0.2, sugar_g: 12.5, sodium_mg: 10 },
  },
  {
    name: 'Dabur Chyawanprash', brand: 'Dabur', barcode: ean13(`${B.dabur}00301`),
    servingSizeG: 10, servingDesc: '1 teaspoon (10 g)',
    per100g: { energy_kcal: 300, protein_g: 1.5, fat_g: 0.5, carb_g: 73, fiber_g: 2, sugar_g: 55, sodium_mg: 120 },
  },
  {
    name: "Patanjali Cow's Pure Ghee", brand: 'Patanjali', barcode: ean13(`${B.patanjali}00201`),
    servingSizeG: 14, servingDesc: '1 tablespoon (14 g)',
    per100g: { energy_kcal: 900, protein_g: 0, fat_g: 100, carb_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 4 },
  },
  {
    name: 'Patanjali Atta Noodles', brand: 'Patanjali', barcode: ean13(`${B.patanjali}00301`),
    servingSizeG: 70, servingDesc: '1 pack (70 g)',
    per100g: { energy_kcal: 398, protein_g: 10.5, fat_g: 12.5, carb_g: 62, fiber_g: 4, sugar_g: 2.5, sodium_mg: 850 },
  },
  {
    name: 'Patanjali Pure Honey', brand: 'Patanjali', barcode: ean13(`${B.patanjali}00401`),
    servingSizeG: 21, servingDesc: '1 tablespoon (21 g)',
    per100g: { energy_kcal: 304, protein_g: 0.3, fat_g: 0, carb_g: 82, fiber_g: 0.2, sugar_g: 82, sodium_mg: 10 },
  },

  // --- International home-market SKUs ----------------------------------------
  {
    name: 'Nutella Hazelnut Spread', brand: 'Ferrero', barcode: '3017620422003', documented: true,
    servingSizeG: 15, servingDesc: '1 tablespoon (15 g)',
    per100g: { energy_kcal: 539, protein_g: 6.3, fat_g: 30.9, carb_g: 57.5, fiber_g: 3.4, sugar_g: 56.3, sodium_mg: 41 },
  },
  {
    name: 'Ferrero Rocher T16', brand: 'Ferrero', barcode: ean13(`${B.ferrero}00201`),
    servingSizeG: 12.5, servingDesc: '1 piece (12.5 g)',
    per100g: { energy_kcal: 590, protein_g: 8, fat_g: 41, carb_g: 45, fiber_g: 3, sugar_g: 40, sodium_mg: 55 },
  },
  {
    name: 'Coca-Cola Classic 330 ml Can', brand: 'Coca-Cola', barcode: '5449000000996', documented: true,
    servingSizeG: 330, servingDesc: '1 can (330 ml)',
    per100g: { energy_kcal: 42, protein_g: 0, fat_g: 0, carb_g: 10.6, fiber_g: 0, sugar_g: 10.6, sodium_mg: 4 },
  },
  {
    name: 'Heinz Tomato Ketchup', brand: 'Heinz', barcode: ean13(`${B.heinz}00201`),
    servingSizeG: 17, servingDesc: '1 tablespoon (17 g)',
    per100g: { energy_kcal: 99, protein_g: 1.2, fat_g: 0.1, carb_g: 22.6, fiber_g: 0.4, sugar_g: 21.2, sodium_mg: 950 },
  },
  {
    name: 'Barilla Spaghetti No. 5', brand: 'Barilla', barcode: '8076800195057', documented: true,
    servingSizeG: 56, servingDesc: '2 oz dry (56 g)',
    per100g: { energy_kcal: 359, protein_g: 12.5, fat_g: 1.5, carb_g: 71.7, fiber_g: 3, sugar_g: 2.5, sodium_mg: 5 },
  },
  {
    name: 'Bisleri Mineral Water', brand: 'Bisleri', barcode: ean13(`${B.bisleri}00201`),
    servingSizeG: 1000, servingDesc: '1 bottle (1 L)',
    per100g: { energy_kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 8 },
  },
]
