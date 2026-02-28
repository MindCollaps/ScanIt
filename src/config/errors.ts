/**
 * Error classes for the config subsystem.
 */

export class ConfigValidationError extends Error {
  public readonly issues: string[];

  public constructor(message: string, issues: string[]) {
    super(message);
    this.name = 'ConfigValidationError';
    this.issues = issues;
  }
}

export class ConfigLoadError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ConfigLoadError';
  }
}
