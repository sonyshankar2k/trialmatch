// Shared between the NestJS API and the React app: one source of truth for
// request validation (Zod) and response types. Change a field here and both
// apps fail to compile until they are updated.
export * from './lib/common.js';
export * from './lib/auth.js';
export * from './lib/trials.js';
export * from './lib/patients.js';
