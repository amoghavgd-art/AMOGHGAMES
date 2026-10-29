export const CONFIG = {
  LIVE: true,                         // false = demo mode (kill switch)
  AGENT_ID: "antigravity-preview-09-2026",
  AGENT_MODEL: "gemini-4-argon",
  GAMESMITH_AGENT: "gamesmith-v1",
  FLASH_MODEL: "gemini-4-argon",
  NANO_BANANA_MODEL: "gemini-3.1-flash-image",
  MAX_AGENT_TOKENS: 400_000,
  AGENT_TIMEOUT_MS: 240_000,
  IMAGE_TIMEOUT_MS: 25_000,
  RUNS_PER_SESSION: 15,               // overridden by ?admin=<token>
};
