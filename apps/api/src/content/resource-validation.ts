import { z } from 'zod';
import { ValidationError } from '../error';

/** Reject a resource field without placing private material in the error contract. */
export function invalidResourceField(field: string): never {
  throw new ValidationError(
    new z.ZodError([{ code: 'custom', path: [field], message: 'Invalid resource input' }]),
  );
}
