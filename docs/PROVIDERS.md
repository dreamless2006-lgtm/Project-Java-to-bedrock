# Providers and models

The brain speaks to any of these through one request/parse pair per wire
protocol (`packs/AI_Sandbox_BP/scripts/brain/providers/`). Pick the provider
in the hub (Profiles & Models), with `!ai provider <id> [model]`, or in
`variables.json` on a dedicated server. Keys never live in the world: they
come from the server's `secrets.json` or the bridge's `config.json`.

| id | Service | Default model | Key | Notes |
|---|---|---|---|---|
| `anthropic` | Claude (Anthropic Messages API) | `claude-opus-5-5` | `x-api-key` | Best quality. `claude-haiku-5-5` is ~40x cheaper and plenty for bots. Stable system prompt is cached (`cache_control`); JSON enforced with structured outputs. |
| `openai` | ChatGPT (OpenAI chat completions) | `gpt-5.4-mini` | Bearer | `gpt-5.4-nano` is cheaper. JSON enforced with `response_format: json_schema`. |
| `xai` | Grok (xAI, OpenAI-compatible) | `grok-4.3` | Bearer | Cheaper fast variants exist; set the model id you see in the xAI console. |
| `gemini` | Gemini (Google generateContent) | `gemini-flash-lite-latest` | `x-goog-api-key` | Aliases follow Google's latest; pin e.g. `gemini-3.6-flash` if you want a fixed model. JSON via `responseSchema`. |
| `player2` | Player2 desktop app (local, port 4315) | app-chosen | none | What the Player2NPC Java mod used. The app handles login and billing in Joules; no model field. |
| `player2cloud` | Player2 cloud API | account-chosen | Bearer | `https://api.player2.game/v1`; same contract as the app. |
| `openrouter` | OpenRouter (any model) | `openai/gpt-5.4-mini` | Bearer | Good for trying many models with one key. |
| `ollama` | Ollama (local) | `llama3.1` | none | Needs a model that follows JSON instructions well. |
| `lmstudio` | LM Studio (local) | loaded model | none | OpenAI-compatible server on port 1234. |
| `custom` | Any OpenAI-compatible endpoint | set `baseUrl` + `model` | optional | `aisb.baseUrl.custom` variable or bridge config. |

Model ids above were checked against the providers' official SDK typings
(October 2026); if a provider retires one, set a new id in the menu. Prices
used by the budget tab are in `brain/budget.js` (`PRICES`) and are
approximate for everything except Anthropic.

## Dedicated server secret names

```json
{
  "aisb.apiKey.anthropic": "sk-ant-...",
  "aisb.apiKey.openai": "Bearer sk-...",
  "aisb.apiKey.xai": "Bearer xai-...",
  "aisb.apiKey.gemini": "AIza...",
  "aisb.apiKey.openrouter": "Bearer sk-or-...",
  "aisb.apiKey.player2cloud": "Bearer <token>"
}
```

A secret is injected as the entire header value, so Bearer-style services
need the `Bearer ` prefix inside the secret. Add each provider's host to
`allowed_uris` in `permissions.json`.

## Bridge config

`bridge/config.json` -> `providers.<id>.apiKey` (plain key, no prefix needed)
or environment variables `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`,
`GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `PLAYER2_API_KEY`.

## What the model receives

A stable system block (who the bot is, the rules, the action vocabulary,
the reply format, the modded-content list) that is identical across turns
and bots with the same persona, so providers with prompt caching bill it at
the cached rate; then the bot's memory and one observation. The reply is one
JSON object; providers with structured output enforce the schema, others
get the schema in the prompt and a tolerant parser.
