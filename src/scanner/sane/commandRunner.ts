import { execFile } from 'node:child_process';

export interface CommandOutput {
  stdout: string;
  stderr: string;
}

/**
 * Executes a command with timeout support and captures text output.
 */
export const runCommand = (
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<CommandOutput> => {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        timeout: timeoutMs,
        encoding: 'utf-8',
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${command} failed: ${error.message}; stderr=${stderr}`));
          return;
        }

        resolve({
          stdout,
          stderr,
        });
      },
    );
  });
};
