import { Codex } from '@openai/codex-sdk';
import { config } from './config.js';

export async function callChatGPT(prompt, options = {}) {
  const thread = new Codex().startThread({
    workingDirectory: options.workingDirectory || process.cwd(),
    skipGitRepoCheck: true,
    approvalPolicy: 'never',
    sandboxMode: 'read-only',
    ...(config.providers.chatgpt.model ? { model: config.providers.chatgpt.model } : {}),
  });
  const result = await thread.run(prompt);

  if (!result.finalResponse?.trim()) {
    throw new Error('ChatGPT Codex returned an empty response.');
  }

  return {
    provider: 'chatgpt',
    model: config.providers.chatgpt.model || 'Codex default',
    content: result.finalResponse.trim(),
  };
}
