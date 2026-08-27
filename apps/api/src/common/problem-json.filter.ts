import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { AppError } from './errors.js';
import type { ErrorCode, ProblemDetail } from './errors.js';

const ERROR_BASE = 'https://api.reset.app/errors';

function codeToSlug(code: ErrorCode): string {
  return code.toLowerCase().replace(/_/g, '-');
}

/**
 * Prisma error codes that are caused by the request, not by the server.
 *
 * `P2023` is the one that matters in practice: any path parameter that is not a UUID —
 * `/bookings/not-a-uuid` — reaches Prisma as a `where` clause, and Prisma throws while
 * parsing it. Left unmapped that surfaces as a 500, which is wrong twice over. The caller
 * cannot tell a bad request from a broken server, and every scan of the API writes an
 * ERROR line, burying the real incident the log is there to reveal.
 *
 * Duck-typed rather than imported: matching on the code keeps the filter free of a
 * dependency on the Prisma runtime, which it otherwise has no reason to load.
 */
const PRISMA_REQUEST_ERRORS: Record<string, { status: HttpStatus; code: ErrorCode }> = {
  // Inconsistent column data — a malformed UUID or enum value in the query.
  P2023: { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_FAILED' },
  // An operation depended on a record that does not exist.
  P2025: { status: HttpStatus.NOT_FOUND, code: 'NOT_FOUND' },
};

function prismaErrorCode(exception: unknown): string | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined;
  const code = (exception as { code?: unknown }).code;
  return typeof code === 'string' && code in PRISMA_REQUEST_ERRORS ? code : undefined;
}

/** Every error leaves the API as RFC 9457 problem+json with a stable `code`. */
@Catch()
export class ProblemJsonFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemJsonFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const problem = this.toProblem(exception, request.url);

    if (problem.status >= 500) {
      // Log the message and stack explicitly. Passing the raw error as a context object
      // serialises to `{}` for most Error subclasses (non-enumerable properties), which is
      // exactly the log line you do not want to find while a store is losing bookings.
      const message = exception instanceof Error ? exception.message : String(exception);
      const stack = exception instanceof Error ? exception.stack : undefined;

      this.logger.error(
        `Unhandled error on ${request.method} ${request.url} — ${message}`,
        stack,
      );
    }

    response.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(exception: unknown, instance: string): ProblemDetail {
    if (exception instanceof AppError) {
      return {
        type: `${ERROR_BASE}/${codeToSlug(exception.code)}`,
        title: exception.title,
        status: exception.getStatus(),
        code: exception.code,
        detail: exception.detail,
        instance,
        meta: exception.meta,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code: ErrorCode =
        status === HttpStatus.NOT_FOUND
          ? 'NOT_FOUND'
          : status === HttpStatus.UNAUTHORIZED
            ? 'UNAUTHENTICATED'
            : status === HttpStatus.FORBIDDEN
              ? 'FORBIDDEN'
              : status < 500
                ? 'VALIDATION_FAILED'
                : 'INTERNAL';

      return {
        type: `${ERROR_BASE}/${codeToSlug(code)}`,
        title: exception.message,
        status,
        code,
        instance,
      };
    }

    const prismaCode = prismaErrorCode(exception);
    if (prismaCode !== undefined) {
      const { status, code } = PRISMA_REQUEST_ERRORS[prismaCode]!;
      return {
        type: `${ERROR_BASE}/${codeToSlug(code)}`,
        title: status === HttpStatus.NOT_FOUND ? 'Not found' : 'Invalid request',
        status,
        code,
        instance,
      };
    }

    return {
      type: `${ERROR_BASE}/internal`,
      title: 'Something went wrong',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL',
      instance,
    };
  }
}
