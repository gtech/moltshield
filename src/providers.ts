/**
 * MoltShield LLM Providers
 *
 * Unified interface for calling different LLM providers.
 */

import type { ResolvedConfig } from "./types.js";

// ============================================================================
// Provider Interface
// ============================================================================

interface RequestOpts {
  model: string;
  maxTokens: number;
  timeout: number;
  providerOrder?: string[];
  allowFallbacks?: boolean;
}

interface Provider {
  name: string;
  getEndpoint(config: ResolvedConfig): string;
  getHeaders(config: ResolvedConfig): Record<string, string>;
  buildTextBody(system: string, user: string, opts: RequestOpts): object;
  buildVisionBody(image: string, mime: string, prompt: string, opts: RequestOpts): object;
  parseResponse(data: unknown): string;
}

// ============================================================================
// Provider Implementations
// ============================================================================

const anthropicProvider: Provider = {
  name: "anthropic",

  getEndpoint(config) {
    return config.endpoint;
  },

  getHeaders(config) {
    const isOAuthToken = !config.apiKey.startsWith("sk-ant-");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    };
    if (isOAuthToken) {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
    } else {
      headers["x-api-key"] = config.apiKey;
    }
    return headers;
  },

  buildTextBody(system, user, opts) {
    return {
      model: opts.model,
      max_tokens: opts.maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    };
  },

  buildVisionBody(image, mime, prompt, opts) {
    return {
      model: opts.model,
      max_tokens: opts.maxTokens,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mime, data: image },
          },
          { type: "text", text: prompt },
        ],
      }],
    };
  },

  parseResponse(data) {
    return (data as { content: Array<{ text?: string }> }).content[0]?.text || "";
  },
};

const openaiStyleProvider = (name: string, referer?: string): Provider => ({
  name,

  getEndpoint(config) {
    return config.endpoint;
  },

  getHeaders(config) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`,
    };
    if (referer) {
      headers["HTTP-Referer"] = referer;
      headers["X-Title"] = "MoltShield";
    }
    return headers;
  },

  buildTextBody(system, user, opts) {
    const body: Record<string, unknown> = {
      model: opts.model,
      max_tokens: opts.maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    };
    // OpenRouter provider routing
    if (opts.providerOrder?.length) {
      body.provider = {
        order: opts.providerOrder,
        allow_fallbacks: opts.allowFallbacks ?? true,
      };
    }
    return body;
  },

  buildVisionBody(image, mime, prompt, opts) {
    const body: Record<string, unknown> = {
      model: opts.model,
      max_tokens: opts.maxTokens,
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mime};base64,${image}` } },
          { type: "text", text: prompt },
        ],
      }],
    };
    // OpenRouter provider routing
    if (opts.providerOrder?.length) {
      body.provider = {
        order: opts.providerOrder,
        allow_fallbacks: opts.allowFallbacks ?? true,
      };
    }
    return body;
  },

  parseResponse(data) {
    return (data as { choices: Array<{ message?: { content?: string } }> })
      .choices[0]?.message?.content || "";
  },
});

const ollamaProvider: Provider = {
  name: "ollama",

  getEndpoint(config) {
    return `${config.endpoint}/api/generate`;
  },

  getHeaders() {
    return { "Content-Type": "application/json" };
  },

  buildTextBody(system, user, opts) {
    return {
      model: opts.model,
      prompt: `${system}\n\n${user}`,
      stream: false,
    };
  },

  buildVisionBody(image, _mime, prompt, opts) {
    return {
      model: opts.model,
      prompt,
      images: [image],
      stream: false,
    };
  },

  parseResponse(data) {
    return (data as { response?: string }).response || "";
  },
};

const providers: Record<string, Provider> = {
  anthropic: anthropicProvider,
  openrouter: openaiStyleProvider("openrouter", "https://github.com/moltshield"),
  openai: openaiStyleProvider("openai"),
  ollama: ollamaProvider,
};

// ============================================================================
// Core Call Function
// ============================================================================

async function callProvider(
  provider: Provider,
  endpoint: string,
  headers: Record<string, string>,
  body: object,
  timeout: number
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`${provider.name} API error: ${response.status}`);
    }

    const data = await response.json();
    return provider.parseResponse(data);
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Call LLM for text completion
 */
export async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  config: ResolvedConfig,
  maxTokens: number = 512
): Promise<string> {
  const provider = providers[config.evaluator];
  if (!provider) {
    throw new Error(`No provider available: ${config.evaluator}`);
  }

  const opts: RequestOpts = {
    model: config.model,
    maxTokens,
    timeout: config.timeout,
    providerOrder: config.providerOrder,
    allowFallbacks: config.allowFallbacks,
  };

  return callProvider(
    provider,
    provider.getEndpoint(config),
    provider.getHeaders(config),
    provider.buildTextBody(systemPrompt, userPrompt, opts),
    config.timeout
  );
}

/**
 * Call LLM for vision/image analysis
 */
export async function callVision(
  imageData: string,
  mimeType: string,
  prompt: string,
  config: ResolvedConfig
): Promise<string> {
  const provider = providers[config.evaluator];
  if (!provider) {
    throw new Error(`No provider available for vision: ${config.evaluator}`);
  }

  const opts: RequestOpts = {
    model: config.visionModel,
    maxTokens: 1024,
    timeout: config.imageTimeout,
    providerOrder: config.providerOrder,
    allowFallbacks: config.allowFallbacks,
  };

  return callProvider(
    provider,
    provider.getEndpoint(config),
    provider.getHeaders(config),
    provider.buildVisionBody(imageData, mimeType, prompt, opts),
    config.imageTimeout
  );
}
