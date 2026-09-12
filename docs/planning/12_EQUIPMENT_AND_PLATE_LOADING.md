# Equipment and Plate Loading Specification

## Overview
This component computes optimal barbell and dumbbell plate configurations based on user-defined equipment inventories, preventing physically impossible recommendations.

## 1. Equipment Inventory Model
```typescript
interface EquipmentInventory {
  bars: Bar[];
  plates: PlateStack[];
}

interface Bar {
  id: string;
  name: string; // e.g., "Olympic Bar", "DB Handle"
  weight: number;
  type: 'barbell' | 'dumbbell' | 'ez_bar' | 'trap_bar';
  count: number;
}

interface PlateStack {
  weight: number;
  count: number;
}
```

**The Specific Example**:
- Bars: 2x DB handles (2kg each), 1x EZ bar (8kg), 1x Short straight bar (10kg).
- Plates: 6 x 5kg, 4 x 2.5kg.

## 2. Plate Calculator Algorithm
- **Symmetric Loading**: Barbell and EZ bar setups must be symmetric. (e.g., you cannot put 5kg on the left and 2.5kg on the right).
- **Respect Inventory**: Total plates used cannot exceed the available `count`.
- **Total vs. Per-Hand**: 
  - Barbell load = Bar Weight + 2 * sum(plate weights on one side).
  - Dumbbell load (per hand) = DB Handle Weight + 2 * sum(plate weights on one side).
- **Feedback**:
  - Show exact loading visualization if possible.
  - **Unachievable Target**: If the target weight (e.g., 25kg) is impossible with the inventory, show the nearest lower (22.5kg) AND higher (27.5kg) achievable loads.
  - **Competition**: Handle logic where a user does supersets (e.g., EZ Bar Curls and DB Press) and both require the same plates.

## 3. Test Cases Required
1. **Symmetry**: Ensure 2.5kg plates are distributed in pairs.
2. **Inventory Depletion**: Prevent using eight 5kg plates if only six exist.
3. **Odd Plates**: What happens if the user owns an odd number of plates (e.g., three 2.5kg plates)? Only two can be used on a bar.
4. **Decimal Plates**: Fractional plates (0.5kg, 1.25kg) calculate correctly.
5. **Unit Conversion**: Mixing lbs and kg plates (convert everything to standard internal unit, preferably kg, for math).
6. **Tie-breaking**: If 20kg can be achieved via (10kg + 10kg) or (5x4), prefer the configuration with fewer total plates.

## 4. Progression Rule
The Progressive Overload system **must never** recommend a weight that cannot be assembled from the user's inventory. 
If the math dictates an increase from 40kg to 42kg, but the user lacks fractional plates and can only make 40kg or 45kg, the system suggests 40kg with more reps instead.

## 5. Plate Loading Algorithm (Greedy Knapsack)
The core logic for `calculatePlates(targetWeight, equipmentInventory)`:
1. Subtract the bar weight from the `targetWeight`.
2. Divide by 2 (calculating for one side of the bar).
3. Sort available `plates` in descending order by weight.
4. Iterate through the sorted plates (Greedy approach).
5. For each plate size, add pairs until `weight_remaining < plate_weight` or `inventory_count_for_plate` is exhausted.
6. If exact match is impossible, return the closest lower bound and upper bound configurations.

## 6. Simultaneous Bar Usage
When a user groups a Barbell Squat and an EZ Bar Curl into a Superset:
- The `equipment` engine maintains a transient `session_inventory` state.
- Plates loaded onto the Squat bar are temporarily subtracted from the available pool when calculating the Curl bar.
