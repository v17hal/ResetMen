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

      /**
       * A sentence, not a field dump.
       *
       * This used to send `email: Invalid email`, which is how a developer reads a Zod
       * issue and not how anybody else reads anything. It went straight to the customer,
       * prefixed with a field name they never saw a label for.
       *
       * The structured `fields` array still goes in the meta, where clients that want to
       * highlight a particular input can find it — that is what it is for.
       */
      const readable =
        fields.length === 1
          ? sentence(fields[0]!.message)
          : fields.map((f) => sentence(f.message)).join(' ');

      throw AppError.validation(readable, { fields });
    }

    return result.data;
  }
}

/** Capitalised and full-stopped, so several can be read as one paragraph. */
function sentence(message: string): string {
  const trimmed = message.trim();
  if (trimmed === '') return 'That value is not valid.';
  const capitalised = trimmed[0]!.toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}
