import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditQuerySchema,
  type AuditAction,
  type AuditChange,
  type AuditEntityType,
  type AuditEvent,
  type Page,
} from '@trialmatch/shared';
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { z } from 'zod';
import { InjectDb, type Db, type Tx } from '../db/database';
import { auditEvents, patients, trials, users } from '../db/schema';
import { currentAuditContext } from './audit-context';

type AuditQuery = z.output<typeof AuditQuerySchema>;
type Row = typeof auditEvents.$inferSelect;

export interface AuditRecord {
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: number | null;
  label?: string | null;
  patientId?: number | null;
  trialId?: number | null;
  changes?: AuditChange[];
  details?: Record<string, unknown>;
  /** Only when there is no signed-in user yet (sign-in, sign-up); otherwise the request's user. */
  actorId?: number | null;
}

/** The most an export holds; narrow the filters for more. */
export const EXPORT_LIMIT = 50_000;
const HISTORY_LIMIT = 200;

const likePattern = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Week 9: writes and reads the audit trail. `record` takes the caller's
 * transaction, so an event exists exactly when its change was committed.
 */
@Injectable()
export class AuditService {
  constructor(@InjectDb() private readonly db: Db) {}

  async record(db: Db | Tx, e: AuditRecord): Promise<void> {
    const ctx = currentAuditContext();
    const actorId =
      e.actorId !== undefined ? e.actorId : (ctx?.actorId ?? null);
    await db.insert(auditEvents).values({
      actorId,
      // The name as it was, so the log still reads correctly if it changes.
      actorName:
        actorId === null
          ? null
          : sql`(select ${users.displayName} from ${users} where ${users.id} = ${actorId})`,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      label: e.label?.slice(0, 300) ?? null,
      patientId: e.patientId ?? null,
      trialId: e.trialId ?? null,
      changes: e.changes ?? [],
      details: e.details ?? {},
      requestId: ctx?.requestId ?? null,
      ip: ctx?.ip ?? null,
    });
  }

  /** The admin log: newest first, filtered. */
  async list(query: AuditQuery): Promise<Page<AuditEvent>> {
    const where = this.where(query);
    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select()
        .from(auditEvents)
        .where(where)
        .orderBy(desc(auditEvents.at), desc(auditEvents.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ total: count() }).from(auditEvents).where(where),
    ]);
    return {
      items: rows.map(toAuditEvent),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** The filtered log as CSV (newest first, at most EXPORT_LIMIT rows). The export is itself recorded. */
  async exportCsv(query: AuditQuery): Promise<string> {
    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(this.where(query))
      .orderBy(desc(auditEvents.at), desc(auditEvents.id))
      .limit(EXPORT_LIMIT);
    const { page: _page, pageSize: _size, ...filters } = query;
    await this.record(this.db, {
      action: 'audit.export',
      entityType: 'audit',
      details: { filters, rows: rows.length },
    });
    return toCsv(rows.map(toAuditEvent));
  }

  /** A patient's history, for their owner (404 for anyone else, as for the record). */
  async patientHistory(ownerId: number, patientId: number) {
    const [owned] = await this.db
      .select({ id: patients.id })
      .from(patients)
      .where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId)));
    if (!owned) throw new NotFoundException('Patient not found.');
    return this.history(eq(auditEvents.patientId, patientId));
  }

  /**
   * A trial's history. Trials are shared, patients are not: events about one
   * of someone else's patients (their reviews and referrals) are left out.
   */
  async trialHistory(viewerId: number, trialId: number) {
    const [found] = await this.db
      .select({ id: trials.id })
      .from(trials)
      .where(eq(trials.id, trialId));
    if (!found) throw new NotFoundException('Trial not found.');
    return this.history(
      and(
        eq(auditEvents.trialId, trialId),
        or(isNull(auditEvents.patientId), eq(auditEvents.actorId, viewerId)),
      ) as SQL,
    );
  }

  private async history(where: SQL): Promise<AuditEvent[]> {
    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(where)
      .orderBy(desc(auditEvents.at), desc(auditEvents.id))
      .limit(HISTORY_LIMIT);
    return rows.map(toAuditEvent);
  }

  private where(q: AuditQuery): SQL | undefined {
    const f: SQL[] = [];
    if (q.action) f.push(eq(auditEvents.action, q.action));
    if (q.entityType) f.push(eq(auditEvents.entityType, q.entityType));
    if (q.entityId) f.push(eq(auditEvents.entityId, q.entityId));
    if (q.patientId) f.push(eq(auditEvents.patientId, q.patientId));
    if (q.trialId) f.push(eq(auditEvents.trialId, q.trialId));
    if (q.actor) {
      const p = likePattern(q.actor);
      f.push(
        or(
          ilike(auditEvents.actorName, p),
          inArray(
            auditEvents.actorId,
            this.db
              .select({ id: users.id })
              .from(users)
              .where(ilike(users.email, p)),
          ),
        ) as SQL,
      );
    }
    // Days are UTC; `to` includes the whole day.
    if (q.from) f.push(gte(auditEvents.at, new Date(`${q.from}T00:00:00Z`)));
    if (q.to)
      f.push(
        lt(
          auditEvents.at,
          new Date(Date.parse(`${q.to}T00:00:00Z`) + 24 * 60 * 60 * 1000),
        ),
      );
    return f.length ? and(...f) : undefined;
  }
}

export function toAuditEvent(r: Row): AuditEvent {
  return {
    id: r.id,
    at: r.at.toISOString(),
    actor:
      r.actorId === null
        ? null
        : { id: r.actorId, name: r.actorName ?? `User ${r.actorId}` },
    action: r.action as AuditAction,
    entityType: r.entityType as AuditEntityType,
    entityId: r.entityId,
    label: r.label,
    patientId: r.patientId,
    trialId: r.trialId,
    changes: r.changes,
    details: r.details as AuditEvent['details'],
    requestId: r.requestId,
    ip: r.ip,
  };
}

const CSV_COLUMNS = [
  'id',
  'at',
  'actor_id',
  'actor',
  'action',
  'entity_type',
  'entity_id',
  'label',
  'patient_id',
  'trial_id',
  'changes',
  'details',
  'request_id',
  'ip',
] as const;

/** RFC 4180 CSV. Cells that a spreadsheet would run as a formula are prefixed with '. */
export function toCsv(events: AuditEvent[]): string {
  const cell = (v: unknown) => {
    let s =
      v === null || v === undefined
        ? ''
        : typeof v === 'object'
          ? JSON.stringify(v)
          : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = events.map((e) =>
    [
      e.id,
      e.at,
      e.actor?.id,
      e.actor?.name,
      e.action,
      e.entityType,
      e.entityId,
      e.label,
      e.patientId,
      e.trialId,
      e.changes,
      e.details,
      e.requestId,
      e.ip,
    ]
      .map(cell)
      .join(','),
  );
  return [CSV_COLUMNS.join(','), ...lines].join('\r\n') + '\r\n';
}
