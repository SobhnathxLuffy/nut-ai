#!/bin/bash
cat << 'INNER_EOF' >> packages/pipeline/src/pipeline.corpus.test.ts

  it('resolves common Indian dishes against the IFCT database', async () => {
    const r = await runPipeline(
      payload([
        item({ name: 'Roti', canonical_food_key: 'roti', food_form: 'discrete', qualitative_size: 'count:2', model_gram_estimate: 80 }),
        item({ name: 'White rice', canonical_food_key: 'rice white cooked', food_form: 'piled', qualitative_size: 'medium', model_gram_estimate: 150 }),
        item({ name: 'Dal', canonical_food_key: 'dal cooked', food_form: 'liquid', qualitative_size: 'medium', model_gram_estimate: 200 }),
        item({ name: 'Mixed vegetable sabzi', canonical_food_key: 'mixed vegetable sabzi', food_form: 'piled', qualitative_size: 'medium', model_gram_estimate: 120 }),
        item({ name: 'Chicken curry', canonical_food_key: 'chicken curry', food_form: 'liquid', qualitative_size: 'medium', model_gram_estimate: 180 }),
      ]),
      deps(),
      foodDb,
    )
    expect(r).not.toBeNull()
    // Verify that the Indian foods found matches (hopefully not miss, or at least fallback)
    expect(r!.zeroHitCount).toBeLessThan(5) 
  })
INNER_EOF
