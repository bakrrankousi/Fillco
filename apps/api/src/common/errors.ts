/** Application errors mapped to RFC 7807 problem responses by the global filter. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly data?: unknown,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, id?: string) {
    super(404, 'NOT_FOUND', id ? `${entity} ${id} not found` : `${entity} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = 'CONFLICT', data?: unknown) {
    super(409, code, message, data);
  }
}

/** The request is well-formed but breaks a business rule. */
export class BusinessRuleError extends AppError {
  constructor(
    message: string,
    code = 'BUSINESS_RULE',
    data?: unknown,
    fieldErrors?: Record<string, string[]>,
  ) {
    super(422, code, message, data, fieldErrors);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission for this action') {
    super(403, 'FORBIDDEN', message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Please sign in') {
    super(401, 'UNAUTHENTICATED', message);
  }
}

export class StaleVersionError extends ConflictError {
  constructor(entity: string) {
    super(`${entity} was changed by someone else. Reload and try again.`, 'STALE_VERSION');
  }
}

export function assertVersion(entity: string, current: number, expected: number): void {
  if (current !== expected) throw new StaleVersionError(entity);
}
