import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Problem } from '@fillco/contracts';
import { AllocationError, InvalidPaymentTermError, MissingExchangeRateError } from '@fillco/domain';
import { Prisma } from '@fillco/db';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from './errors';

function zodToFieldErrors(err: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** Turns every error into application/problem+json and never leaks internals on 5xx. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    const problem = this.toProblem(exception);
    if (problem.status >= 500) {
      this.logger.error(
        `${req.method} ${req.originalUrl} → ${String(exception)}`,
        (exception as Error)?.stack,
      );
    }
    res.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(e: unknown): Problem {
    const make = (status: number, title: string, code: string, extra: Partial<Problem> = {}): Problem => ({
      type: `https://fillco.app/problems/${code.toLowerCase()}`,
      title,
      status,
      code,
      ...extra,
    });

    if (e instanceof AppError) {
      return make(e.status, e.message, e.code, { data: e.data, errors: e.fieldErrors });
    }
    if (isZodError(e)) {
      return make(400, 'Some fields are invalid', 'VALIDATION', { errors: zodToFieldErrors(e) });
    }
    if (e instanceof MissingExchangeRateError) {
      return make(422, `${e.message}. Add it under Settings → Exchange rates.`, 'MISSING_EXCHANGE_RATE', {
        data: { fromCurrency: e.fromCurrency, toCurrency: e.toCurrency, date: e.onDate },
      });
    }
    if (e instanceof AllocationError || e instanceof InvalidPaymentTermError || e instanceof RangeError) {
      return make(422, e.message, 'BUSINESS_RULE');
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      switch (e.code) {
        case 'P2002':
          return make(
            409,
            `A record with this ${String((e.meta?.target as string[] | undefined)?.join(', ') ?? 'value')} already exists`,
            'DUPLICATE',
          );
        case 'P2025':
          return make(404, 'Record not found', 'NOT_FOUND');
        case 'P2003':
          return make(409, 'This record is referenced by other records', 'REFERENCED');
        case 'P2010':
        case 'P2034':
          break;
      }
      const msg = String(e.meta?.message ?? e.message);
      if (/immutable|Only draft|over-allocated/.test(msg)) return make(409, cleanPgMessage(msg), 'INTEGRITY');
    }
    if (e instanceof Prisma.PrismaClientUnknownRequestError || e instanceof Error) {
      const msg = e.message;
      // Messages raised by our own database triggers are safe and useful to show.
      if (/is not allowed: records are immutable|Only draft records|over-allocated/.test(msg)) {
        return make(409, cleanPgMessage(msg), 'INTEGRITY');
      }
    }
    if (e instanceof HttpException) {
      const status = e.getStatus();
      return make(status, e.message, status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR');
    }
    return make(500, 'Unexpected error. The problem has been logged.', 'INTERNAL');
  }
}

/** Duck-typed so it also works when zod is loaded twice (ESM + CJS copies). */
function isZodError(e: unknown): e is ZodError {
  return (
    e instanceof ZodError ||
    (e instanceof Error && e.name === 'ZodError' && Array.isArray((e as ZodError).issues))
  );
}

function cleanPgMessage(msg: string): string {
  const m =
    /(?:ERROR:|message: ")?\s*((?:Only draft|Sales order line|Purchase order line|UPDATE on|DELETE on)[^"\n]*)/.exec(
      msg,
    );
  return m?.[1]?.trim() ?? 'The change conflicts with existing data';
}
