# Glossary

*   **Gram pathway:** The sequence of steps taken to convert a logged food amount into base grams.
*   **Portion source:** The origin of a portion size definition (e.g., USDA, user-defined).
*   **Gram band:** A predefined range of acceptable gram values for a portion.
*   **Evidence hierarchy:** The order of precedence used when multiple sources provide conflicting data.
*   **Confidence band:** A statistical range indicating the reliability of an AI estimation.
*   **Stratum:** A distinct layer or category in confidence scoring.
*   **Pathway:** (in confidence context) The specific logical route taken to assign a confidence score.
*   **Repair:** The process of automatically fixing inconsistent or corrupt data entries.
*   **Question bank:** A repository of predefined queries used to test the AI evaluation systems.
*   **Expected value gating:** A validation step where an output must fall within an expected range before acceptance.
*   **Clamp:** Applying minimum and maximum limits to a numerical value.
*   **Atwater recalculation:** Re-evaluating caloric content based on standard macronutrient energy values.
*   **Energy density:** The amount of energy (calories) per unit of weight or volume of food.
*   **Resolver:** A system component that translates natural language queries into structured database operations.
*   **FTS5:** A SQLite extension module providing full-text search capabilities.
*   **BM25 scoring:** A ranking function used in information retrieval to estimate relevance.
*   **Nutrition source:** An external or internal database providing nutritional information.
*   **Source adapter:** A translation layer connecting a specific nutrition source to the core system.
*   **Source routing:** The logic dictating which nutrition source to query for specific data.
*   **Dish family:** A group of closely related recipes or food variations.
*   **Recipe version:** A specific iteration of a recipe, preserving its state at a given point in time.
*   **Household recipe:** A customized recipe specific to an individual user's household.
*   **Food concept key:** A unique identifier linking synonymous food items across different databases.
*   **Canonical ID:** The primary, standardized identifier for a specific entity.
*   **Tracking type:** The method used to measure an exercise (e.g., weight/reps, time/distance).
*   **Set type:** The classification of an exercise set (e.g., working, warm-up, drop-set).
*   **Working set:** A primary exercise set intended to stimulate muscle growth or strength.
*   **Warm-up set:** A preliminary set performed with lighter weight to prepare for working sets.
*   **e1RM (estimated 1-rep max):** The theoretical maximum weight a user can lift for one repetition.
*   **PR (personal record):** A user's best performance for a specific exercise and rep range.
*   **RIR (reps in reserve):** The estimated number of additional repetitions a user could have performed.
*   **RPE (rate of perceived exertion):** A subjective scale measuring the intensity of an exercise set.
*   **Session RPE:** The overall perceived intensity of a complete workout session.
*   **Volume-load:** The total amount of work performed, calculated as sets * reps * weight.
*   **Day completeness:** A metric indicating whether a user has logged all necessary data for a day.
*   **Eligible day:** A day that meets the criteria for being included in statistical calculations.
*   **EWMA (exponentially weighted moving average):** A statistical method giving more weight to recent data points.
*   **TDEE (Total Daily Energy Expenditure):** The total number of calories burned in a day.
*   **BMR (Basal Metabolic Rate):** The number of calories required to maintain basic physiological functions at rest.
*   **Adaptive TDEE:** A TDEE calculation that adjusts over time based on user logging and weight changes.
*   **Sync state:** The current synchronization status of a data entity (e.g., synced, pending, error).
*   **Revision:** An incrementing number tracking the version of a synchronized entity.
*   **Tombstone:** A marker indicating that an entity has been deleted, used for synchronization purposes.
*   **Outbox queue:** A temporary storage for actions pending synchronization to the server.
*   **IFCT:** Indian Food Composition Tables, a comprehensive database of Indian food data.
*   **USDA FDC:** United States Department of Agriculture FoodData Central.
*   **ODbL:** Open Database License, a copyleft license intended for data and databases.
*   **Node-purity:** A design principle where architectural nodes maintain strict independence and avoid side-effects.
*   **Golden queries:** A set of benchmark search queries used to test the accuracy of the search engine.
