import { Injectable, PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

import { AppError } from './errors.js';

/**
 * Validates a request against a Zod schema.
 *
 * The same schemas will be shared with the web and admin front-ends via `@reset/types`, so
 * a field cannot drift between the server's expectation and the client's form — there is
 * only one definition.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      const fields = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));

      throw AppError.validation(
        fields.map((f) => `${f.path}: ${f.message}`).join('; '),
        { fields },
      );
    }

    return result.data;
  }
}
