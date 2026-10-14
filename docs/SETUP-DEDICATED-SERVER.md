# Setup: Bedrock Dedicated Server (direct HTTP edition)

This is the "bots think inside the server" setup. The server calls the model
over HTTPS itself; nothing else needs to run.

## 1. Build and install the packs

```bash
python3 tools/build_mcaddon.py --edition bds
```

Install `dist/ai-sandbox-<version>-bds.mcaddon` into the server world
(behaviour pack + resource pack), and enable the **Beta APIs** experiment on
that world (do this on a client, then copy the world to the server, or edit
the world with experiments on before uploading).

## 2. Allow the network modules

Scripts may only use `@minecraft/server-net` when the server allows it. Create
(or edit) the config folder named after this pack's **script module UUID**:

```
bedrock-server/
  config/
    e2a9d4c1-6f3b-4a87-8d25-1c7e0b9f4a63/
      permissions.json
      variables.json      (optional)
      secrets.json
```

`permissions.json`:

```json
{
  "allowed_modules": [
    "@minecraft/server",
    "@minecraft/server-ui",
    "@minecraft/server-admin",
    "@minecraft/server-net"
  ],
  "module_permissions": {
    "@minecraft/server-net": {
      "allowed_uris": [
        "https://api.anthropic.com/",
        "https://api.openai.com/",
        "https://generativelanguage.googleapis.com/",
        "https://api.x.ai/",
        "https://openrouter.ai/"
      ],
      "force_https": true,
      "max_body_bytes": 1048576,
      "max_concurrent_requests": 4
    }
  }
}
```

Add `http://127.0.0.1:4315/` (Player2 app) or `http://127.0.0.1:11434/`
(Ollama) to `allowed_uris` and set `force_https` to false if you use a
local model. Leaving `module_permissions` out disables the limits entirely.

## 3. Put the API key in secrets.json

Secrets are injected straight into HTTP headers; the script never sees the
value. Because the whole header value comes from the secret, OpenAI-style
keys must include the `Bearer ` prefix:

```json
{
  "aisb.apiKey.anthropic": "sk-ant-...",
  "aisb.apiKey.openai": "Bearer sk-...",
  "aisb.apiKey.xai": "Bearer xai-...",
  "aisb.apiKey.gemini": "AIza...",
  "aisb.apiKey.openrouter": "Bearer sk-or-...",
  "aisb.apiKey.player2": "<player2 game key>"
}
```

Only add the providers you use. The names `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `XAI_API_KEY`, `GEMINI_API_KEY` and
`OPENROUTER_API_KEY` are accepted too.

## 4. Optional: variables.json

Any of these override what operators set in the in-game menu:

```json
{
  "aisb.provider": "anthropic",
  "aisb.model": "claude-haiku-5-5",
  "aisb.effort": "low",
  "aisb.maxBrains": 8,
  "aisb.autonomy": "full",
  "aisb.chatVolume": 2,
  "aisb.callByName": false,
  "aisb.freeBuild": true,
  "aisb.keepAlive": true,
  "aisb.serverRules": "Speak English. No griefing.",
  "aisb.budget.softTokens": 400000,
  "aisb.budget.hardTokens": 1000000,
  "aisb.budget.windowMinutes": 60,
  "aisb.baseUrl.custom": "http://127.0.0.1:1234/v1"
}
```

## 5. Start the server and check

Join, then type `!ai status`. You should see `transport: direct http` and,
after a bot thinks, token usage in the budget line. If it says bots cannot
think, the message names the missing key or the module permission.

Keeping bots alive when nobody is online: `keepAlive` (Behavior tab) keeps
ticking areas around up to four bot clusters, so companions keep building and
parasites keep evolving.
