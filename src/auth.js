import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited ${signal ? `with signal ${signal}` : `with code ${code}`}.`));
    });
  });
}

export async function login(provider) {
  if (provider === 'chatgpt') {
    await run('npm', ['exec', '--', 'codex', 'login']);
    return;
  }

  if (provider === 'copilot') {
    await run('npm', ['exec', '--', 'copilot', 'login']);
    return;
  }

  throw new Error(`Login is not supported for provider "${provider}". Use an API key for DeepSeek or GitHub Models.`);
}
