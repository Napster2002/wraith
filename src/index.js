#!/usr/bin/env node
import { config } from './config.js';
import { runTask } from './orchestrator.js';

const args = process.argv.slice(2);

function printHelp() {
  console.log(`Wraith Agent

Usage:
  npm run auth:chatgpt
  npm run auth:copilot
  npm start -- --providers chatgpt "task description"
  npm start -- --providers copilot "task description"
  npm start -- --providers chatgpt,copilot --mode parallel "task description"
  node src/index.js "task description"
  node src/index.js --task "task description"
  node src/index.js --providers deepseek,github "task description"
  node src/index.js --mode single --providers chatgpt "task description"

Options:
  --task, -t         Task to execute
  --providers        Comma-separated names: chatgpt,copilot,deepseek,github,openai
  --mode             single or parallel (default: ${config.defaultMode})
  --context          Extra context for the task
  --constraints      Extra constraints or requirements
  auth <provider>    Sign in to ChatGPT or GitHub Copilot
  --help, -h         Show this help

Environment:
  Default providers: ${config.defaultProviders.join(', ')}
  Copy .env.example to .env. API keys are only needed for openai, deepseek, and github.
`);
}

function parseArgs(argsList) {
  const options = {
    providers: [],
    mode: config.defaultMode,
  };

  for (let i = 0; i < argsList.length; i += 1) {
    const arg = argsList[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      return options;
    }
    if (arg === '--task' || arg === '-t') {
      options.task = argsList[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--providers') {
      const value = argsList[i + 1] || '';
      options.providers = value.split(',').map((p) => p.trim()).filter(Boolean);
      i += 1;
      continue;
    }
    if (arg === '--mode') {
      options.mode = argsList[i + 1] || config.defaultMode;
      i += 1;
      continue;
    }
    if (arg === '--context') {
      options.context = argsList[i + 1] || '';
      i += 1;
      continue;
    }
    if (arg === '--constraints') {
      options.constraints = argsList[i + 1] || '';
      i += 1;
      continue;
    }
    if (!options.task) {
      options.task = arg;
    }
  }

  return options;
}

async function main() {
  if (args[0] === 'auth') {
    try {
      const { login } = await import('./auth.js');
      if (!args[1]) {
        throw new Error('Choose a provider: chatgpt or copilot.');
      }
      await login(args[1]);
      console.log(`Signed in to ${args[1]}.`);
    } catch (error) {
      console.error(`\nWraith sign-in failed:\n${error.message || String(error)}`);
      process.exitCode = 1;
    }
    return;
  }

  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    return;
  }

  if (!options.task) {
    printHelp();
    process.exitCode = 1;
    return;
  }

  console.log(`Wraith ready. Requested providers: ${options.providers.join(', ') || 'configured defaults'}`);

  try {
    const result = await runTask(options.task, {
      providers: options.providers,
      mode: options.mode,
      context: options.context,
      constraints: options.constraints,
      onProviderStart: (provider) => console.log(`[${provider}] working...`),
      onProviderResult: (providerResult) => {
        if (providerResult.error) {
          console.error(`[${providerResult.provider}] failed: ${providerResult.content}`);
        } else {
          console.log(`[${providerResult.provider}] response received.`);
        }
      },
    });

    if (result.mode === 'single') {
      console.log(`\n[${result.provider}] ${result.model}\n`);
      console.log(result.content);
      return;
    }

    console.log('\nWraith multi-provider synthesis:\n');
    console.log(result.mergedSummary);

    if (result.failures.length) {
      console.log('\nWarnings:');
      for (const failure of result.failures) {
        console.log(`- ${failure}`);
      }
    }
  } catch (error) {
    console.error('\nWraith failed:');
    console.error(error.message || String(error));
    process.exitCode = 1;
  }
}

main();
