# AI Chat and Provider Architecture

## Overview
The AI Assistant provides a unified natural language interface spanning both Nutrition and Training domains. It is designed to be privacy-conscious, cost-effective, and resilient, supporting local models, cloud APIs, and Bring-Your-Own (BYO) keys.

## 1. Assistant Capabilities
- Queries structured database records.
- **Intent Types**: Log Food, Log Workout, Query Macros, Query Workout History, Set Goal, General Advice.
- **Read/Write Tools**: Exposed to the LLM via tool-calling (e.g., `search_food(query)`, `create_workout_log(data)`, `get_daily_summary(date)`).

*Example Queries*:
- "I just ran 5k in 25 mins" -> Logs run, estimates calories burned.
- "Had a large chicken biryani" -> Prompts for clarification on portion size/type, then logs.
- "What did I lift on bench last week?" -> Queries history, returns "80kg for 3 sets of 8".

## 2. Execution Order (Waterfall)
1. **Deterministic Parser**: Fast regex/heuristic matching for simple queries ("100g chicken").
2. **Local Model**: On-device SLM (Small Language Model) attempts to resolve.
3. **Cloud Provider**: Standard LLM API call if local fails or complex reasoning is needed.
4. **Manual Fallback**: UI prompts user to enter manually if AI fails to parse intent.

## 3. Provider Adapter Architecture
Abstracts the underlying LLM to easily swap models.
- Implementations: `AnthropicAdapter`, `OpenAIAdapter`, `GeminiAdapter`, `LocalAdapter`.
- Standardizes tool calling format and system prompt delivery.

## 4. Key Management & Infrastructure
- **Mobile (BYO Key)**: Users can supply their own API keys, stored securely on-device using `expo-secure-store`.
- **Hosted**: App uses server-side keys through an intermediary proxy to hide secrets.

## 5. Network & Reliability
- **Timeouts**: Strict 10-second timeout for UI responsiveness.
- **Cancellation**: Users can cancel long-running generations.
- **Retry/Backoff**: Exponential backoff on rate limits (429).
- **Idempotency**: Prevents double-logging if the user mashes the send button.

## 6. Cost Ledger Tracking
For hosted models, every request computes approximate token cost and updates a user-specific ledger. Limits are enforced to prevent abuse.

## 7. Schema Validation and Repair
- The LLM output must strictly match defined JSON schemas for tools.
- If invalid, the system automatically loops back with the error to repair the JSON, up to a maximum of 2 retries.

## 8. Security & Privacy
- **No Shared Secrets**: The APK contains no hardcoded LLM API keys.
- **Image Stripping**: EXIF and GPS data are stripped from food/equipment photos locally before upload.
- **Untrusted OCR/Data**: AI output is treated as untrusted and heavily validated before hitting the SQL DB.

## 9. Write Confirmation Policy
Any AI action that modifies the database (adding logs, deleting entries, changing goals) requires explicit user confirmation via a UI summary card ("I am about to log X. Confirm?").

## 10. Local AI Plan
- Support for on-device inference using Gemma 3n (or similar) via E2B/local runtime.
- **Optional Download**: The model is an optional DLC (e.g., 2GB) to save space for low-end devices.
- **Capability Check**: The app benchmarks RAM and chipset on first boot to enable/disable the local AI toggle.

## 11. AI Timeouts and Fallback
- **Simple Regex/Local**: < 1 second.
- **Standard Chat/Log API Call**: Default timeout of **30 seconds**.
- **Complex Photo Analysis**: Default timeout of **60 seconds**.
- Provider cascading: If OpenAI times out, the system automatically retries with Anthropic or Gemini if the user provided fallback keys.

## 12. Prompt Versioning and Eval
- Prompts are stored in the database (`prompts` table) with version numbers.
- Upgrading the app does not overwrite a prompt if the user explicitly customized it, but defaults upgrade automatically.

## 13. Token Cost Formula
- Estimated Cost Ledger: `(Input_Tokens * Input_Rate) + (Output_Tokens * Output_Rate)`.
- Updates `scan_cost_ledger` locally for transparency.
