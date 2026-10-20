import { createInterface } from 'node:readline';
import { config } from './config.js';
import { runTask } from './orchestrator.js';

function send(event, data) {
  process.stdout.write(`${JSON.stringify({ event, data })}\n`);
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let request;

for await (const line of input) {
  request = JSON.parse(line);
  break;
}

if (!request) {
  throw new Error('No chat request was provided.');
}

try {
  const providers = Array.isArray(request.providers) && request.providers.length
    ? request.providers
    : config.defaultProviders;
  send('start', { message: `Wraith is working with ${providers.join(', ')}...` });
  const result = await runTask(request.message, {
    providers,
    mode: providers.length === 1 ? 'single' : 'parallel',
    history: Array.isArray(request.history) ? request.history.slice(-20) : [],
    workingDirectory: process.cwd(),
    onProviderStart: (provider) => send('provider_start', { provider }),
    onProviderResult: (providerResult) => send('provider_result', providerResult),
  });
  send('done', result);
} catch (error) {
  send('error', { message: error.message || String(error) });
  process.exitCode = 1;
}
