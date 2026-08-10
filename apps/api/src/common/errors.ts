import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Error codes and the problem+json shape come from `@reset/types`, not from a second copy
 * here.
 *
 * Clients switch on `code`, never on `title` or `detail` — those are display copy and will
 * change. The same union is emitted to the Flutter app as a Dart enum, so adding a member
 * is a contract change across all four surfaces and belongs in one file.
 */
export { ERROR_CODES } from '@reset/types';
export type { ErrorCode, ProblemDetail } from '@reset/types';

import type { ErrorCode } from '@reset/types';

export class AppError extends HttpException {
  constructor(
    readonly code: ErrorCode,
    status: HttpStatus,
    readonly title: string,
    readonly detail?: string,
    readonly meta?: Record<string, unknown>,
  ) {
    super({ code, title, detail, meta }, status);
  }

  static notFound(what: string): AppError {
    return new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, `${what} not found`);
  }

  static validation(detail: string, meta?: Record<string, unknown>): AppError {
    return new AppError(
      'VALIDATION_FAILED',
      HttpStatus.UNPROCESSABLE_ENTITY,
      'Validation failed',
      detail,
      meta,
    );
  }

  /**
   * Lost the race for a slot. The refreshed slot list travels with the error so the client
   * can re-render in place instead of making the user retry by hand — a 409 during payment
   * is the worst moment in the whole flow to hand someone a dead end.
   */
  static slotTaken(refreshedSlots: unknown): AppError {
    return new AppError(
      'SLOT_TAKEN',
      HttpStatus.CONFLICT,
      'Slot no longer available',
      'Someone booked this time while you were deciding.',
      { refreshedSlots },
    );
  }

  static slotUnavailable(detail: string, meta?: Record<string, unknown>): AppError {
    return new AppError(
      'SLOT_UNAVAILABLE',
      HttpStatus.CONFLICT,
      'That time is not available',
      detail,
      meta,
    );
  }

  static storeClosed(detail: string): AppError {
    return new AppError('STORE_CLOSED', HttpStatus.CONFLICT, 'Store is closed', detail);
  }
}
