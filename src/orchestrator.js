import { config, getProvider } from './config.js';
import { callProvider } from './providers.js';
import { callChatGPT } from './chatgpt.js';
import { callCopilot } from './copilot.js';

const loginProviders = {
  chatgpt: callChatGPT,
  copilot: callCopilot,
};

function getSelectedProviders(requested) {
  const names = requested?.length ? requested : config.defaultProviders;
  const selected = [];
  const seen = new Set();

  for (const name of names) {
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);

    const provider = getProvider(name);
    if (!provider) {
      throw new Error(`Unsupported provider "${name}". Choose chatgpt, copilot, deepseek, github, or openai.`);
    }
    if (!provider.enabled) {
      throw new Error(`${name} is not configured. Add its API key in .env.`);
    }
    selected.push(provider);
  }

  return selected;
}

async function callSelectedProvider(provider, prompt, options) {
  if (loginProviders[provider.name]) {
    return loginProviders[provider.name](prompt, options);
  }
  return callProvider(provider.name, prompt, {
    model: provider.model,
    apiKey: provider.apiKey,
    timeoutMs: config.timeoutMs,
  });
}

export async function runTask(task, options = {}) {
  const mode = (options.mode || config.defaultMode || 'parallel').toLowerCase();
  if (!['single', 'parallel'].includes(mode)) {
    throw new Error(`Unsupported mode "${mode}". Choose "single" or "parallel".`);
  }

  const selected = getSelectedProviders(options.providers);

  if (!selected.length) {
    throw new Error('No AI providers are configured. Sign in to ChatGPT or Copilot, or add provider API keys in .env.');
  }

  const prompt = buildPrompt(task, options);

  if (mode === 'single') {
    const primary = selected[0];
    options.onProviderStart?.(primary.name);
    try {
      const result = await callSelectedProvider(primary, prompt, options);
      options.onProviderResult?.(result);
      return {
        mode,
        provider: result.provider,
        model: result.model,
        content: result.content,
      };
    } catch (error) {
      options.onProviderResult?.({
        provider: primary.name,
        model: primary.model || 'default',
        content: error.message || String(error),
        error: true,
      });
      throw error;
    }
  }

  const maxConcurrency = Math.min(config.maxConcurrency || 1, selected.length);
  const results = new Array(selected.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < selected.length) {
      const index = nextIndex;
      nextIndex += 1;
      const provider = selected[index];

      try {
        options.onProviderStart?.(provider.name);
        results[index] = await callSelectedProvider(provider, prompt, options);
        options.onProviderResult?.(results[index]);
      } catch (error) {
        results[index] = {
          provider: provider.name,
          model: provider.model || 'default',
          content: error.message || String(error),
          error: true,
        };
        options.onProviderResult?.(results[index]);
      }
    }
  }

  await Promise.all(
    Array.from({ length: maxConcurrency }, () => worker())
  );

  const fulfilled = results.filter((result) => !result.error);
  const rejected = results.filter((result) => result.error).map((result) => `${result.provider}: ${result.content}`);

  if (!fulfilled.length) {
    throw new Error(`All providers failed: ${rejected.join('; ')}`);
  }

  return {
    mode,
    selectedProviders: selected.map((p) => p.name),
    results: fulfilled,
    failures: rejected,
    mergedSummary: mergeResponses(fulfilled),
  };
}

function buildPrompt(task, options = {}) {
  const taskText = typeof task === 'string' ? task : JSON.stringify(task, null, 2);
  const history = Array.isArray(options.history)
    ? options.history
        .filter((entry) => ['user', 'assistant'].includes(entry.role) && typeof entry.content === 'string')
        .slice(-20)
        .map((entry) => `${entry.role === 'user' ? 'User' : 'Wraith'}: ${entry.content}`)
        .join('\n')
    : '';
  const conversation = history ? `\nConversation so far:\n${history}\n` : '';
  const context = options.context ? `\nContext:\n${options.context}` : '';
  const constraints = options.constraints ? `\nConstraints:\n${options.constraints}` : '';
  return `You are Wraith, a multi-provider coding agent.\n${conversation}Current user message:\n${taskText}${context}${constraints}\n\nPlease provide a concise but high-quality answer. Prefer correctness, maintainability, scalable architecture, and efficient implementation choices.`;
}

function mergeResponses(responses) {
  return responses
    .map((r) => `## ${r.provider} (${r.model})\n${r.content}`)
    .join('\n\n---\n\n');
}
