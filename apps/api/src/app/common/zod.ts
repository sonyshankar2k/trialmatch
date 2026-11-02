import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { IdSchema } from '@trialmatch/shared';

export { createZodDto };

/** Route param `:id` validated as a positive 32-bit integer (400 otherwise, never a 500). */
export class IdParam extends createZodDto(z.object({ id: IdSchema })) {}
