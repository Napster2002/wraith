const RETRY_DELAY_MS = 250;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value) {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeText(entry)).filter(Boolean).join('\n');
  }
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') {
      return value.text.trim();
    }
    if (typeof value.content === 'string') {
      return value.content.trim();
    }
    if (typeof value.message === 'string') {
      return value.message.trim();
    }
  }
  return '';
}

async function postJson(url, payload, headers = {}, timeoutMs = 60000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Provider request failed (${response.status}): ${text}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function callProvider(providerName, prompt, options = {}) {
  const { model, apiKey, timeoutMs = 60000 } = options;

  if (!apiKey) {
    throw new Error(`${providerName} is not configured. Add its API key to .env.`);
  }

  const providerConfig = {
    openai: {
      url: 'https://api.openai.com/v1/chat/completions',
      build: (message) => ({
        model,
        messages: [{ role: 'user', content: message }],
        temperature: 0.2,
      }),
      headers: (key) => ({ Authorization: `Bearer ${key}` }),
      parser: (json) => normalizeText(json.choices?.[0]?.message?.content || ''),
    },
    anthropic: {
      url: 'https://api.anthropic.com/v1/messages',
      build: (message) => ({
        model,
        max_tokens: 2000,
        messages: [{ role: 'user', content: message }],
      }),
      headers: (key) => ({
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      }),
      parser: (json) => normalizeText(json.content || ''),
    },
    deepseek: {
      url: 'https://api.deepseek.com/v1/chat/completions',
      build: (message) => ({
        model,
        messages: [{ role: 'user', content: message }],
        temperature: 0.2,
      }),
      headers: (key) => ({ Authorization: `Bearer ${key}` }),
      parser: (json) => normalizeText(json.choices?.[0]?.message?.content || ''),
    },
    github: {
      url: 'https://models.github.ai/inference/chat/completions',
      build: (message) => ({
        model,
        messages: [{ role: 'user', content: message }],
        temperature: 0.2,
      }),
      headers: (key) => ({ Authorization: `Bearer ${key}` }),
      parser: (json) => normalizeText(json.choices?.[0]?.message?.content || ''),
    },
  };

  const provider = providerConfig[providerName];
  if (!provider) {
    throw new Error(`Unsupported provider: ${providerName}`);
  }

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const body = provider.build(prompt);
      const payload = await postJson(provider.url, body, provider.headers(apiKey), timeoutMs);
      const content = provider.parser(payload);
      if (!content) {
        throw new Error(`Provider ${providerName} returned an empty response.`);
      }
      return {
        provider: providerName,
        model,
        content,
      };
    } catch (err) {
      lastErr = err;
      if (attempt < 2) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }

  throw lastErr || new Error(`Provider ${providerName} failed unexpectedly.`);
}
