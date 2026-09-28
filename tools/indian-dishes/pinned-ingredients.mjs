/**
 * The reviewed, corpus-validated ingredient pin list shared by the dish tools.
 *
 * Every entry was resolved against the shipped corpora (apps/mobile/assets/
 * ifct.db and nutrition.db) and is re-validated at run time by BOTH consumers
 * (dish-ingredient-suggestions.mjs and curate-drafts.mjs) — a stale or
 * mistyped id fails the build instead of silently shipping a wrong mapping.
 *
 * Grams are typical raw amounts in a family-size pot; curate-drafts uses the
 * ids as slot mappings and derives mass fractions from the family models.
 */
export const PINNED = {
  // Vegetables — the usual dominant slot
  aloo: { foodId: 'ifct:F006', label: 'Potato (Aloo)', grams: 200 },
  matar: { foodId: 'ifct:D061', label: 'Green peas (Matar)', grams: 100 },
  gobi: { foodId: 'ifct:D036', label: 'Cauliflower (Gobi)', grams: 200 },
  palak: { foodId: 'ifct:C033', label: 'Spinach (Palak)', grams: 200 },
  bhindi: { foodId: 'ifct:D056', label: 'Okra (Bhindi)', grams: 200 },
  baingan: { foodId: 'ifct:D010', label: 'Brinjal (Baingan)', grams: 200 },
  karela: { foodId: 'ifct:D004', label: 'Bitter gourd (Karela)', grams: 150 },
  lauki: { foodId: 'ifct:D008', label: 'Bottle gourd (Lauki)', grams: 200 },
  ghiya: { foodId: 'ifct:D008', label: 'Bottle gourd (Lauki)', grams: 200 },
  turai: { foodId: 'ifct:D068', label: 'Ridge gourd (Turai)', grams: 200 },
  // D073 is the real Tinda (Praecitrullus fistulosus); D066 is pumpkin — the
  // previous pin pointed at pumpkin leaves/pumpkin rows and only passed
  // existence checks, which is exactly the class of error the label-vs-name
  // audit in curate-drafts now catches.
  tinda: { foodId: 'ifct:D073', label: 'Tinda, tender', grams: 150 },
  kaddu: { foodId: 'ifct:D066', label: 'Pumpkin (Kaddu)', grams: 150 },
  shimla: { foodId: 'ifct:D033', label: 'Capsicum, green (Shimla mirch)', grams: 100 },
  gajar: { foodId: 'ifct:F002', label: 'Carrot (Gajar)', grams: 100 },
  mooli: { foodId: 'ifct:F010', label: 'Radish (Mooli)', grams: 100 },
  kakdi: { foodId: 'ifct:D043', label: 'Cucumber (Kakdi)', grams: 100 },
  kheera: { foodId: 'ifct:D043', label: 'Cucumber (Kheera)', grams: 100 },
  methi: { foodId: 'ifct:C020', label: 'Fenugreek leaves (Methi)', grams: 150 },
  sarson: { foodId: 'ifct:C026', label: 'Mustard greens (Sarson)', grams: 150 },
  beans: { foodId: 'ifct:D049', label: 'French beans', grams: 100 },
  sem: { foodId: 'ifct:D032', label: 'Broad beans (Sem)', grams: 100 },
  kathal: { foodId: 'ifct:D051', label: 'Jackfruit, raw (Kathal)', grams: 150 },
  khumb: { foodId: 'ifct:J001', label: 'Button mushroom (Khumb)', grams: 100 },
  mushroom: { foodId: 'ifct:J001', label: 'Button mushroom', grams: 100 },
  arbi: { foodId: 'ifct:F004', label: 'Colocasia (Arbi)', grams: 150 },
  soya: { foodId: 'ifct:B025', label: 'Soybean', grams: 60 },
  // Proteins
  chicken: { foodId: 'ifct:N001', label: 'Chicken, leg, skinless', grams: 250 },
  mutton: { foodId: 'ifct:O001', label: 'Goat meat (Mutton)', grams: 250 },
  gosht: { foodId: 'ifct:O001', label: 'Goat meat (Mutton)', grams: 250 },
  egg: { foodId: 'ifct:M001', label: 'Egg, whole, raw', grams: 100 },
  anda: { foodId: 'ifct:M001', label: 'Egg, whole, raw (Anda)', grams: 100 },
  fish: { foodId: 'ifct:S006', label: 'Rohu fish', grams: 200 },
  machli: { foodId: 'ifct:S006', label: 'Rohu fish (Machli)', grams: 200 },
  prawn: { foodId: 'ifct:S008', label: 'Prawns', grams: 150 },
  jhinga: { foodId: 'ifct:S008', label: 'Prawns (Jhinga)', grams: 150 },
  crab: { foodId: 'ifct:Q002', label: 'Sea crab', grams: 150 },
  pork: { foodId: 'ifct:O048', label: 'Pork', grams: 200 },
  duck: { foodId: 'ifct:N011', label: 'Duck, meat, with skin', grams: 200 },
  // Dairy
  paneer: { foodId: 'ifct:L003', label: 'Paneer', grams: 100 },
  doodh: { foodId: 'ifct:L002', label: 'Milk, cow', grams: 150 },
  milk: { foodId: 'ifct:L002', label: 'Milk, cow', grams: 150 },
  // Pulses & legumes
  dal: { foodId: 'ifct:B021', label: 'Red gram dal (Toor)', grams: 100 },
  toor: { foodId: 'ifct:B021', label: 'Red gram dal (Toor)', grams: 100 },
  arhar: { foodId: 'ifct:B021', label: 'Red gram dal (Arhar)', grams: 100 },
  masoor: { foodId: 'ifct:B013', label: 'Lentil dal (Masoor)', grams: 100 },
  moong: { foodId: 'ifct:B010', label: 'Green gram dal (Moong)', grams: 100 },
  mung: { foodId: 'ifct:B010', label: 'Green gram dal (Moong)', grams: 100 },
  urad: { foodId: 'ifct:B003', label: 'Black gram dal (Urad)', grams: 100 },
  chana: { foodId: 'ifct:B002', label: 'Bengal gram, whole (Chana)', grams: 100 },
  chhole: { foodId: 'ifct:B002', label: 'Bengal gram, whole (Chhole)', grams: 150 },
  chole: { foodId: 'ifct:B002', label: 'Bengal gram, whole (Chole)', grams: 150 },
  rajma: { foodId: 'ifct:B020', label: 'Rajmah, red', grams: 100 },
  lobhia: { foodId: 'ifct:B006', label: 'Cowpea (Lobhia)', grams: 100 },
  chawli: { foodId: 'ifct:B006', label: 'Cowpea (Chawli)', grams: 100 },
  besan: { foodId: 'ifct:B001', label: 'Bengal gram dal (Besan)', grams: 60 },
  // Grains, flours, bread bases
  rice: { foodId: 'ifct:A015', label: 'Rice, raw, milled', grams: 150 },
  chawal: { foodId: 'ifct:A015', label: 'Rice, raw, milled (Chawal)', grams: 150 },
  poha: { foodId: 'ifct:A011', label: 'Rice flakes (Poha)', grams: 60 },
  murmura: { foodId: 'ifct:A012', label: 'Puffed rice (Murmura)', grams: 40 },
  rava: { foodId: 'ifct:A022', label: 'Semolina (Rava/Suji)', grams: 80 },
  suji: { foodId: 'ifct:A022', label: 'Semolina (Suji)', grams: 80 },
  sooji: { foodId: 'ifct:A022', label: 'Semolina (Sooji)', grams: 80 },
  upma: { foodId: 'ifct:A022', label: 'Semolina (upma base)', grams: 80 },
  atta: { foodId: 'ifct:A019', label: 'Wheat flour, atta', grams: 80 },
  maida: { foodId: 'ifct:A018', label: 'Wheat flour, refined (Maida)', grams: 80 },
  roti: { foodId: 'ifct:A019', label: 'Wheat flour, atta (roti base)', grams: 60 },
  chapati: { foodId: 'ifct:A019', label: 'Wheat flour, atta (chapati base)', grams: 60 },
  phulka: { foodId: 'ifct:A019', label: 'Wheat flour, atta (phulka base)', grams: 60 },
  paratha: { foodId: 'ifct:A019', label: 'Wheat flour, atta (paratha base)', grams: 80 },
  puri: { foodId: 'ifct:A019', label: 'Wheat flour, atta (puri base)', grams: 60 },
  bhature: { foodId: 'ifct:A018', label: 'Wheat flour, refined (bhatura base)', grams: 80 },
  bajra: { foodId: 'ifct:A003', label: 'Bajra (pearl millet)', grams: 80 },
  jowar: { foodId: 'ifct:A005', label: 'Jowar (sorghum)', grams: 80 },
  ragi: { foodId: 'ifct:A010', label: 'Ragi (finger millet)', grams: 80 },
  makki: { foodId: 'ifct:A006', label: 'Maize, dry (Makki)', grams: 80 },
  dalia: { foodId: 'ifct:A021', label: 'Wheat, bulgur (Dalia)', grams: 80 },
  // Fats & sweets
  ghee: { foodId: 'ifct:T013', label: 'Ghee', grams: 14 },
  oil: { foodId: 'ifct:T012', label: 'Sunflower oil', grams: 14 },
  gur: { foodId: 'ifct:I001', label: 'Jaggery (Gur)', grams: 20 },
  jaggery: { foodId: 'ifct:I001', label: 'Jaggery', grams: 20 },
  // Aromatics & spices (secondary slot)
  onion: { foodId: 'ifct:G017', label: 'Onion, big', grams: 50 },
  pyaz: { foodId: 'ifct:G017', label: 'Onion, big (Pyaz)', grams: 50 },
  piyaz: { foodId: 'ifct:G017', label: 'Onion, big (Piyaz)', grams: 50 },
  tomato: { foodId: 'ifct:D076', label: 'Tomato, ripe, local', grams: 50 },
  tamatar: { foodId: 'ifct:D076', label: 'Tomato (Tamatar)', grams: 50 },
  garlic: { foodId: 'ifct:G011', label: 'Garlic, big clove', grams: 10 },
  lehsun: { foodId: 'ifct:G011', label: 'Garlic (Lehsun)', grams: 10 },
  ginger: { foodId: 'ifct:G014', label: 'Ginger, fresh (Adrak)', grams: 10 },
  adrak: { foodId: 'ifct:G014', label: 'Ginger, fresh (Adrak)', grams: 10 },
  mirch: { foodId: 'ifct:G001', label: 'Green chillies', grams: 10 },
  dhania: { foodId: 'ifct:G009', label: 'Coriander leaves', grams: 10 },
  pudina: { foodId: 'ifct:G016', label: 'Mint leaves', grams: 10 },
  jeera: { foodId: 'ifct:G025', label: 'Cumin seeds', grams: 5 },
  haldi: { foodId: 'ifct:G033', label: 'Turmeric powder', grams: 3 },
  imli: { foodId: 'ifct:E064', label: 'Tamarind, pulp (Imli)', grams: 20 },
  // Fruits & nuts
  kela: { foodId: 'ifct:E012', label: 'Banana, ripe (Kela)', grams: 100 },
  aam: { foodId: 'ifct:E036', label: 'Mango, ripe', grams: 100 },
  kaju: { foodId: 'ifct:H005', label: 'Cashew nut', grams: 20 },
  badam: { foodId: 'ifct:H001', label: 'Almond', grams: 20 },
}

/** Multi-word phrases checked before single tokens, longest first. */
export const PHRASES = {
  'shimla mirch': PINNED.shimla,
  'palak paneer': null, // handled by both tokens naturally
}
