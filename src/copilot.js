import { CopilotClient } from '@github/copilot-sdk';
import { config } from './config.js';

export async function callCopilot(prompt, options = {}) {
  const authVariables = new Set(['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN']);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !authVariables.has(name)),
  );
  const client = new CopilotClient({ useLoggedInUser: true, env });
  let session;

  try {
    await client.start();
    session = await client.createSession({
      model: config.providers.copilot.model,
      streaming: false,
      workingDirectory: options.workingDirectory || process.cwd(),
      availableTools: [],
    });
    const response = await session.sendAndWait({ prompt }, config.timeoutMs);
    const content = response?.data.content.trim();

    if (!content) {
      throw new Error('GitHub Copilot returned an empty response.');
    }

    return {
      provider: 'copilot',
      model: config.providers.copilot.model,
      content,
    };
  } finally {
    try {
      if (session) {
        await session.disconnect();
      }
    } finally {
      const cleanupErrors = await client.stop();
      if (cleanupErrors.length) {
        throw new AggregateError(cleanupErrors, 'Failed to cleanly stop the GitHub Copilot runtime.');
      }
    }
  }
}
