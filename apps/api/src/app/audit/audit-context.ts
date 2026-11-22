import { Injectable, type NestMiddleware } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

/** The parts of the HTTP request an audit event takes its context from. */
interface AuditRequest {
  user?: { id: number };
  id?: unknown;
  ip?: string;
}

/** Who made the request, and which request: attached to every audit event it records. */
export interface AuditContext {
  actorId: number | null;
  requestId: string | null;
  ip: string | null;
}

const storage = new AsyncLocalStorage<AuditRequest>();

/**
 * Week 9: runs the rest of each request inside an audit context, so services
 * record events without passing the user, request id and address through
 * every call. It holds the request itself and reads those when an event is
 * recorded: the guard identifies the user, and pino assigns the request id,
 * after this middleware has run.
 *
 * (A middleware, not an interceptor: any global interceptor makes Nest open a
 * Server-Sent Events stream before the handler's access check, so a 404 would
 * become a 200 stream that then fails.)
 *
 * Work outside a request (the daily registry check) has no context and is
 * recorded with no actor.
 */
@Injectable()
export class AuditContextMiddleware implements NestMiddleware {
  use(req: AuditRequest, _res: unknown, next: () => void) {
    storage.run(req, next);
  }
}

export function currentAuditContext(): AuditContext | undefined {
  const req = storage.getStore();
  if (!req) return undefined;
  return {
    actorId: req.user?.id ?? null,
    requestId: req.id === undefined ? null : String(req.id).slice(0, 100),
    ip: req.ip?.slice(0, 64) ?? null,
  };
}
