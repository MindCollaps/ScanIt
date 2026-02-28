import { spawn } from 'node:child_process';
import { logger as rootLogger } from '../../server/logger.js';

const log = rootLogger.child({ module: 'command-runner' });

export interface CommandOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class CommandError extends Error {
  public readonly stdout: string;
  public readonly stderr: string;
  public readonly exitCode: number;

  public constructor(command: string, stdout: string, stderr: string, exitCode: number) {
    super(`${command} failed (exit ${exitCode}); stderr=${stderr}`);
    this.name = 'CommandError';
    this.stdout = stdout;
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

/**
 * Executes a command with timeout support and captures text output.
 *
 * Uses `spawn` instead of `execFile` so the `close` event fires only after
 * all stdio streams have been consumed **and** the child process has fully
 * exited — guaranteeing that any files written by the child are flushed to
 * disk before the promise settles.
 */
export const runCommand = (
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<CommandOutput> => {
  return new Promise((resolve, reject) => {
    const fullCmd = [command, ...args].join(' ');
    log.debug({ cmd: fullCmd, timeoutMs }, 'Spawning command');

    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });

    const pid = child.pid;
    log.debug({ pid, cmd: command }, 'Process spawned');

    let stdout = '';
    let stderr = '';
    let settled = false;

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      log.trace({ pid, stream: 'stdout', chunk: text.trim() }, 'stdout data');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      log.debug({ pid, stream: 'stderr', chunk: text.trim() }, 'stderr data');
    });

    child.on('error', (err) => {
      log.error({ pid, error: String(err) }, 'Process error event');
      if (settled) return;
      settled = true;
      reject(new CommandError(command, stdout, stderr || String(err), 1));
    });

    child.on('close', (code) => {
      log.debug(
        { pid, exitCode: code, stdoutLen: stdout.length, stderrLen: stderr.length },
        'Process closed',
      );
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(new CommandError(command, stdout, stderr, code ?? 1));
        return;
      }
      resolve({ stdout, stderr, exitCode: 0 });
    });
  });
};
