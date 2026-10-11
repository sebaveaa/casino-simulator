/**
 * Thrown by stubs whose implementation belongs to a later issue. The backend
 * maps it to HTTP 501 (`not_implemented`).
 */
export class NotImplementedError extends Error {
  constructor(what: string, issue: string) {
    super(`${what} is not implemented yet (see ${issue})`);
    this.name = "NotImplementedError";
  }
}
