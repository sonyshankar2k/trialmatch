import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
/** Marks a route that needs no sign-in (everything else does). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
