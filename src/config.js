import dotenv from 'dotenv';

dotenv.config();

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
}

export const config = {
  defaultMode: (process.env.WRAITH_DEFAULT_MODE || 'parallel').toLowerCase(),
  defaultProviders: (process.env.WRAITH_DEFAULT_PROVIDERS || 'chatgpt')
    .split(',')
    .map((provider) => provider.trim().toLowerCase())
    .filter(Boolean),
  maxConcurrency: toPositiveInt(process.env.WRAITH_MAX_CONCURRENCY, 3),
  timeoutMs: toPositiveInt(process.env.WRAITH_TIMEOUT_MS, 60000),
  logLevel: process.env.WRAITH_LOG_LEVEL || 'info',
  providers: {
    openai: {
      apiKey: process.env.OPENAI_API_KEY || '',
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      enabled: Boolean(process.env.OPENAI_API_KEY),
    },
    chatgpt: {
      model: process.env.WRAITH_CHATGPT_MODEL || '',
      enabled: true,
    },
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      enabled: Boolean(process.env.DEEPSEEK_API_KEY),
    },
    github: {
      apiKey: process.env.GITHUB_MODELS_TOKEN || process.env.GITHUB_TOKEN || '',
      model: process.env.GITHUB_MODELS_MODEL || 'openai/gpt-4.1-mini',
      enabled: Boolean(process.env.GITHUB_MODELS_TOKEN || process.env.GITHUB_TOKEN),
    },
    copilot: {
      model: process.env.WRAITH_COPILOT_MODEL || 'auto',
      enabled: true,
    },
  },
};

export function getEnabledProviders() {
  return Object.entries(config.providers)
    .filter(([name, provider]) => provider.enabled && !['chatgpt', 'copilot'].includes(name))
    .map(([name, provider]) => ({ name, ...provider }));
}

export function getProvider(name) {
  const provider = config.providers[name];
  return provider ? { name, ...provider } : undefined;
}
