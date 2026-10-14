# Optional: Bedrock Dedicated Server with in-server HTTP

The standard `Real-AI-<version>.mcaddon` works on a dedicated server exactly
like on a Realm: install it and run the bridge (see
[SETUP-REALM-BRIDGE.md](SETUP-REALM-BRIDGE.md) with `connect.mode: "server"`).

This page is the alternative for server admins who do not want a bridge
account: a server-only build where the server calls the model over HTTPS
itself. It adds the server-net modules (beta modules that only a Bedrock
Dedicated Server can load), so unlike the standard build it needs the Beta
APIs experiment on the world.

## 1. Build and install the server variant

```bash
python3 tools/build_mcaddon.py --variant server
```

Install `dist/Real-AI-<version>-server.mcaddon` into the server world
(behaviour pack + resource pack), and enable the **Beta APIs** experiment on
that world (do this on a client, then copy the world to the server, or edit
the world with experiments on before uploading).

## 2. Allow the network modules

Scripts may only use `@minecraft/server-net` when the server allows it. Create
(or edit) the config folder named after this pack's **script module UUID**:

```
bedrock-server/
  config/
    a294f652-accc-488c-93d0-20c6201bd9d0/
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
  "realai.apiKey.anthropic": "sk-ant-...",
  "realai.apiKey.openai": "Bearer sk-...",
  "realai.apiKey.xai": "Bearer xai-...",
  "realai.apiKey.gemini": "AIza...",
  "realai.apiKey.openrouter": "Bearer sk-or-...",
  "realai.apiKey.player2": "<player2 game key>"
}
```

Only add the providers you use. The names `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `XAI_API_KEY`, `GEMINI_API_KEY` and
`OPENROUTER_API_KEY` are accepted too.

## 4. Optional: variables.json

Any of these override what operators set in the in-game menu:

```json
{
  "realai.provider": "anthropic",
  "realai.model": "claude-haiku-5-5",
  "realai.effort": "low",
  "realai.worldPlayers": 8,
  "realai.wildSpawns": false,
  "realai.mixProviders": true,
  "realai.showThoughts": false,
  "realai.maxBrains": 12,
  "realai.autonomy": "full",
  "realai.chatVolume": 2,
  "realai.callByName": false,
  "realai.freeBuild": true,
  "realai.keepAlive": true,
  "realai.serverRules": "Speak English. No griefing.",
  "realai.budget.softTokens": 400000,
  "realai.budget.hardTokens": 1000000,
  "realai.budget.windowMinutes": 60,
  "realai.baseUrl.custom": "http://127.0.0.1:1234/v1"
}
```

## 5. Start the server and check

Join, then type `!ai status`. You should see `transport: direct http`, the
residents listed, and, after a bot thinks, token usage in the budget line.
If it says bots cannot think, the message names the missing key or the
module permission.

Keeping bots alive when nobody is online: `keepAlive` (Behavior tab) keeps
ticking areas around up to four bot clusters, so residents and companions
keep building and exploring between your visits.
