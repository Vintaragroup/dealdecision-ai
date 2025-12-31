import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const isDocker = existsSync('/.dockerenv') || existsSync('/run/.containerenv');
if (isDocker) {
  // Prevent Vite from attempting to open a browser in containers (xdg-open ENOENT).
  process.env.BROWSER = 'none';
}

// Some pnpm/docker invocations end up passing a literal "--" through to the script.
// If present, strip it so Vite receives the intended flags.
const args = process.argv.slice(2);
const passthroughArgs = args[0] === '--' ? args.slice(1) : args;

const binName = process.platform === 'win32' ? 'vite.cmd' : 'vite';
const viteBin = path.resolve(process.cwd(), 'node_modules', '.bin', binName);

const child = spawn(viteBin, passthroughArgs, {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
