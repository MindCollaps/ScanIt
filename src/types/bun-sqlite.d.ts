declare module 'bun:sqlite' {
  export class Database {
    constructor(
      filename: string,
      options?: { create?: boolean; readonly?: boolean; readwrite?: boolean },
    );
    exec(sql: string): void;
    prepare<T = Record<string, unknown>>(sql: string): Statement<T>;
    close(): void;
    transaction<F extends (...args: unknown[]) => unknown>(fn: F): F;
  }

  export class Statement<T = Record<string, unknown>> {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: unknown[]): T | null;
    all(...params: unknown[]): T[];
    values(...params: unknown[]): unknown[][];
  }
}
