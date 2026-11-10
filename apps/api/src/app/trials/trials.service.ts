import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  Criterion,
  CriterionInput,
  Page,
  Trial,
  TrialSummary,
} from '@trialmatch/shared';
import {
  TrialCreateSchema,
  TrialListQuerySchema,
  TrialUpdateSchema,
} from '@trialmatch/shared';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  or,
  sql,
  SQL,
} from 'drizzle-orm';
import type { z } from 'zod';
import { FieldError, VersionConflict } from '../common/errors';
import {
  InjectDb,
  pgConstraint,
  pgErrorCode,
  PG_UNIQUE_VIOLATION,
} from '../db/database';
import type { Db } from '../db/database';
import { trialCriteria, trials, users } from '../db/schema';

type TrialRow = typeof trials.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** `%` and `_` typed by a user are literal characters, not wildcards. */
const likePattern = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

@Injectable()
export class TrialsService {
  constructor(@InjectDb() private readonly db: Db) {}

  async list(
    query: z.output<typeof TrialListQuerySchema>,
  ): Promise<Page<TrialSummary>> {
    const filters: SQL[] = [];
    if (query.search) {
      const p = likePattern(query.search);
      filters.push(
        or(
          ilike(trials.title, p),
          ilike(trials.condition, p),
          ilike(trials.nctId, p),
          ilike(trials.sponsor, p),
        ) as SQL,
      );
    }
    if (query.phase) filters.push(eq(trials.phase, query.phase));
    if (query.status) filters.push(eq(trials.status, query.status));
    const where = filters.length ? and(...filters) : undefined;

    const criteriaCount = sql<number>`(select count(*)::int from ${trialCriteria} where ${trialCriteria.trialId} = ${trials.id})`;
    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select({ trial: trials, createdBy: users.displayName, criteriaCount })
        .from(trials)
        .innerJoin(users, eq(users.id, trials.createdById))
        .where(where)
        .orderBy(desc(trials.updatedAt), desc(trials.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ total: count() }).from(trials).where(where),
    ]);

    return {
      items: rows.map(({ trial, createdBy, criteriaCount }) =>
        toSummary(toTrial(trial, createdBy, []), criteriaCount),
      ),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Which of these NCT IDs are already trials here: NCT ID → trial id. */
  async idsByNct(nctIds: string[]): Promise<Map<string, number>> {
    if (!nctIds.length) return new Map();
    const rows = await this.db
      .select({ id: trials.id, nctId: trials.nctId })
      .from(trials)
      .where(inArray(trials.nctId, nctIds));
    return new Map(rows.map((r) => [r.nctId as string, r.id]));
  }

  async get(id: number, db: Db | Tx = this.db): Promise<Trial> {
    const [row] = await db
      .select({ trial: trials, createdBy: users.displayName })
      .from(trials)
      .innerJoin(users, eq(users.id, trials.createdById))
      .where(eq(trials.id, id));
    if (!row) throw new NotFoundException('Trial not found.');
    const criteria = await db
      .select()
      .from(trialCriteria)
      .where(eq(trialCriteria.trialId, id))
      .orderBy(asc(trialCriteria.type), asc(trialCriteria.ordinal));
    return toTrial(row.trial, row.createdBy, criteria);
  }

  async create(
    input: z.output<typeof TrialCreateSchema>,
    userId: number,
    provenance: Pick<Trial, 'source' | 'sourceLastUpdated'> = {
      source: 'manual',
      sourceLastUpdated: null,
    },
  ): Promise<Trial> {
    const { criteria, ...fields } = input;
    return this.uniqueNct(() =>
      this.db.transaction(async (tx) => {
        const [trial] = await tx
          .insert(trials)
          .values({
            ...fields,
            ...provenance,
            nctId: fields.nctId ?? null,
            createdById: userId,
          })
          .returning();
        await this.replaceCriteria(tx, trial.id, criteria);
        return this.get(trial.id, tx);
      }),
    );
  }

  /**
   * Optimistic concurrency: the UPDATE only matches the version the client read.
   * If someone saved in between, nothing changes and the client gets 409 + the current record.
   */
  async update(
    id: number,
    input: z.output<typeof TrialUpdateSchema>,
  ): Promise<Trial> {
    const { version, criteria, ...fields } = input;
    const result = await this.uniqueNct(() =>
      this.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(trials)
          .set({
            ...fields,
            version: sql`${trials.version} + 1`,
            updatedAt: new Date(),
          })
          .where(and(eq(trials.id, id), eq(trials.version, version)))
          .returning({ id: trials.id });
        if (!updated) return null;
        if (criteria) await this.replaceCriteria(tx, id, criteria);
        return this.get(id, tx);
      }),
    );
    if (result) return result;
    throw new VersionConflict(await this.get(id)); // 404 if it was deleted instead
  }

  async remove(id: number, version: number): Promise<void> {
    const deleted = await this.db
      .delete(trials)
      .where(and(eq(trials.id, id), eq(trials.version, version)))
      .returning({ id: trials.id });
    if (!deleted.length) throw new VersionConflict(await this.get(id));
  }

  /** Criteria are numbered within their type, in the order given: I1, I2… / E1, E2… */
  private async replaceCriteria(
    tx: Tx,
    trialId: number,
    criteria: CriterionInput[],
  ) {
    await tx.delete(trialCriteria).where(eq(trialCriteria.trialId, trialId));
    if (!criteria.length) return;
    const next = { inclusion: 0, exclusion: 0 };
    await tx.insert(trialCriteria).values(
      criteria.map((c) => ({
        trialId,
        type: c.type,
        text: c.text,
        ordinal: ++next[c.type],
      })),
    );
  }

  private async uniqueNct<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (
        pgErrorCode(err) === PG_UNIQUE_VIOLATION &&
        pgConstraint(err) === 'trials_nct_id_key'
      ) {
        throw new FieldError(
          'nctId',
          'Another trial already uses this NCT ID.',
        );
      }
      throw err;
    }
  }
}

function toTrial(
  t: TrialRow,
  createdBy: string,
  criteria: (typeof trialCriteria.$inferSelect)[],
): Trial {
  return {
    id: t.id,
    nctId: t.nctId,
    title: t.title,
    condition: t.condition,
    phase: t.phase,
    status: t.status,
    sponsor: t.sponsor,
    summary: t.summary,
    minAge: t.minAge,
    maxAge: t.maxAge,
    sex: t.sex,
    source: t.source,
    sourceLastUpdated: t.sourceLastUpdated,
    criteria: criteria.map((c): Criterion => ({
      id: c.id,
      type: c.type,
      text: c.text,
      code: `${c.type === 'inclusion' ? 'I' : 'E'}${c.ordinal}`,
    })),
    version: t.version,
    createdBy,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

function toSummary(t: Trial, criteriaCount: number): TrialSummary {
  return {
    id: t.id,
    nctId: t.nctId,
    title: t.title,
    condition: t.condition,
    phase: t.phase,
    status: t.status,
    sponsor: t.sponsor,
    minAge: t.minAge,
    maxAge: t.maxAge,
    sex: t.sex,
    source: t.source,
    sourceLastUpdated: t.sourceLastUpdated,
    version: t.version,
    createdBy: t.createdBy,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    criteriaCount,
  };
}
