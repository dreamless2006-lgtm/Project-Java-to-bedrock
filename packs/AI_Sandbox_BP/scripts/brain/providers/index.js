// Provider registry: one builder/parser pair per wire protocol. The brain only
// sees {build(cfg, req) -> {uri, method, headers, body}} and {parse(status, body)}.
import { buildAnthropicRequest, parseAnthropicResponse, ANTHROPIC_MODELS } from "./anthropic.js";
import { buildOpenAICompatRequest, parseOpenAICompatResponse, OPENAI_COMPAT_PRESETS } from "./openai_compat.js";
import { buildGeminiRequest, parseGeminiResponse, GEMINI_MODELS } from "./gemini.js";

export const PROVIDERS = {
    anthropic:  { label: "Claude (Anthropic)",   build: buildAnthropicRequest,    parse: parseAnthropicResponse,    defaultModel: ANTHROPIC_MODELS.best, needsKey: true },
    openai:     { label: "ChatGPT (OpenAI)",     build: buildOpenAICompatRequest, parse: parseOpenAICompatResponse, defaultModel: OPENAI_COMPAT_PRESETS.openai.model, needsKey: true },
    xai:        { label: "Grok (xAI)",           build: buildOpenAICompatRequest, parse: parseOpenAICompatResponse, defaultModel: OPENAI_COMPAT_PRESETS.xai.model, needsKey: true },
    gemini:     { label: "Gemini (Google)",      build: buildGeminiRequest,       parse: parseGeminiResponse,       defaultModel: GEMINI_MODELS.fast, needsKey: true },
    player2:    { label: "Player2 app (local)",  build: buildOpenAICompatRequest, parse: parseOpenAICompatResponse, defaultModel: "", needsKey: false },
    openrouter: { label: "OpenRouter",           build: buildOpenAICompatRequest, parse: parseOpenAICompatResponse, defaultModel: OPENAI_COMPAT_PRESETS.openrouter.model, needsKey: true },
    ollama:     { label: "Ollama (local)",       build: buildOpenAICompatRequest, parse: parseOpenAICompatResponse, defaultModel: OPENAI_COMPAT_PRESETS.ollama.model, needsKey: false },
    lmstudio:   { label: "LM Studio (local)",    build: buildOpenAICompatRequest, parse: parseOpenAICompatResponse, defaultModel: "", needsKey: false },
    custom:     { label: "Custom OpenAI-compatible", build: buildOpenAICompatRequest, parse: parseOpenAICompatResponse, defaultModel: "", needsKey: false },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);

export function getProvider(id) {
    return PROVIDERS[id] || null;
}
