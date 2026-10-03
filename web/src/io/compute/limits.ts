const mib = 1024 * 1024;

export const computeLimits = {
  jobs: 96,
  inputBytes: 1024 * mib,
  activeInputBytes: 512 * mib,
  workerBytes: 256 * mib,
  residentBytes: 512 * mib,
  idleMs: 60_000,
  cancelMs: 500,
};

export class ResourceLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResourceLimitError";
  }
}
