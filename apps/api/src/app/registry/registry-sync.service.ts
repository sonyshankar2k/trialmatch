import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  TrialUpdateSchema,
  type ApiError,
  type CriterionInput,
  type RegistrySyncResult,
  type RegistryTrialInput,
  type Trial,
  type TrialUpdate,
} from '@trialmatch/shared';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/database';
import { trials, trialUpdates, users } from '../db/schema';
import { TrialsService } from '../trials/trials.service';
import { NotATrialError, studyToTrial } from './ctgov-mapper';
import { CtgovClient } from './ctgov.client';
import {
  diffRegistry,
  hasChanges,
  trialAsRegistryInput,
} from './registry-diff';

type UpdateRow = typeof trialUpdates.$inferSelect;

/**
 * Week 8: keeps imported trials in step with ClinicalTrials.gov.
 *
 * A check fetches the registry record and compares it with the version
 * TrialMatch last took (the trial's snapshot). Differences become one pending
 * update per trial; nothing on the trial changes until a person applies the
 * update (registry values win for the listed fields) or keeps the trial as it
 * is. Either way the snapshot moves on, so the same change is not raised again.
 */
@Injectable()
export class RegistrySyncService {
  private readonly log = new Logger(RegistrySyncService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly ctgov: CtgovClient,
    private readonly trials: TrialsService,
  ) {}

  /**
   * Every imported trial. One cheap request per 100 trials asks for last-update
   * dates; only trials whose date moved (or that have no snapshot yet) are
   * fetched in full and compared.
   */
  async syncAll(): Promise<RegistrySyncResult> {
    const rows = await this.db
      .select({
        id: trials.id,
        nctId: trials.nctId,
        sourceLastUpdated: trials.sourceLastUpdated,
        hasSnapshot: sql<boolean>`${trials.sourceSnapshot} is not null`,
        pendingDate: sql<
          string | null
        >`(select ${trialUpdates.registryLastUpdated} from ${trialUpdates} where ${trialUpdates.trialId} = ${trials.id} and ${trialUpdates.status} = 'pending')`,
      })
      .from(trials)
      .where(
        and(eq(trials.source, 'clinicaltrials_gov'), isNotNull(trials.nctId)),
      );
    const failed: string[] = [];
    const checkedAt = new Date();
    let dates: Map<string, string | null>;
    try {
      dates = await this.ctgov.lastUpdated(rows.map((r) => r.nctId as string));
    } catch {
      return {
        checked: rows.length,
        updated: await this.pendingCount(rows.map((r) => r.id)),
        failed: rows.map((r) => r.nctId as string),
        checkedAt: checkedAt.toISOString(),
      };
    }
    const unchanged: number[] = [];
    for (const row of rows) {
      const nctId = row.nctId as string;
      if (!dates.has(nctId)) {
        failed.push(nctId);
        continue;
      }
      const seen = row.pendingDate ?? row.sourceLastUpdated;
      if (row.hasSnapshot && dates.get(nctId) === seen) {
        unchanged.push(row.id);
        continue;
      }
      try {
        await this.check(await this.trials.get(row.id));
      } catch (err) {
        this.log.warn(`Registry check of ${nctId} failed: ${String(err)}`);
        failed.push(nctId);
      }
    }
    if (unchanged.length)
      await this.db
        .update(trials)
        .set({ sourceCheckedAt: checkedAt })
        .where(inArray(trials.id, unchanged));
    const result = {
      checked: rows.length,
      updated: await this.pendingCount(rows.map((r) => r.id)),
      failed,
      checkedAt: checkedAt.toISOString(),
    };
    this.log.log(
      `Registry sync: ${result.checked} checked, ${result.updated} with updates, ${failed.length} failed`,
    );
    return result;
  }

  /** Check one trial now. Returns its pending update, or null when it is in step. */
  async checkTrial(trialId: number): Promise<TrialUpdate | null> {
    const trial = await this.trials.get(trialId);
    if (trial.source !== 'clinicaltrials_gov' || !trial.nctId)
      throw new BadRequestException(
        'Only trials imported from ClinicalTrials.gov can be checked.',
      );
    await this.check(trial);
    return this.pending(trialId);
  }

  async pending(trialId: number): Promise<TrialUpdate | null> {
    const [row] = await this.select().where(
      and(
        eq(trialUpdates.trialId, trialId),
        eq(trialUpdates.status, 'pending'),
      ),
    );
    return row ? toTrialUpdate(row) : null;
  }

  /**
   * Take the registry's values for the changed fields, and its criteria changes
   * (removed criteria go, added ones are appended; local wording of the others
   * is kept). `version` is the trial version the person read: 409 if stale.
   */
  async apply(
    updateId: number,
    version: number,
    userId: number,
  ): Promise<Trial> {
    const update = await this.claim(updateId, 'applied', userId);
    try {
      const trial = await this.trials.get(update.trialId);
      const patch: Record<string, unknown> = {};
      for (const { field } of update.fields) {
        patch[field] = update.snapshot[field];
        // Ages move together, so the range stays valid.
        if (field === 'minAge' || field === 'maxAge') {
          patch['minAge'] = update.snapshot.minAge;
          patch['maxAge'] = update.snapshot.maxAge;
        }
      }
      const { added, removed } = update.criteria;
      if (added.length || removed.length) {
        const gone = new Set(removed.map(criterionKey));
        patch['criteria'] = [
          ...trial.criteria
            .map(({ type, text }) => ({ type, text }))
            .filter((c) => !gone.has(criterionKey(c))),
          ...added,
        ];
      }
      return await this.trials.update(
        trial.id,
        TrialUpdateSchema.parse({ ...patch, version }),
        {
          sourceSnapshot: update.snapshot,
          sourceLastUpdated: update.registryLastUpdated,
        },
      );
    } catch (err) {
      await this.unclaim(updateId); // e.g. a 409: the person reloads and tries again
      throw err;
    }
  }

  /** Keep the trial as it is; the registry's version counts as seen. */
  async dismiss(updateId: number, userId: number): Promise<Trial> {
    const update = await this.claim(updateId, 'dismissed', userId);
    await this.db
      .update(trials)
      .set({
        sourceSnapshot: update.snapshot,
        sourceLastUpdated: update.registryLastUpdated,
      })
      .where(eq(trials.id, update.trialId));
    return this.trials.get(update.trialId);
  }

  /** Fetch, compare, and record the result (a pending update, or the new snapshot). */
  private async check(trial: Trial): Promise<void> {
    const nctId = trial.nctId as string;
    const [{ snapshot }] = await this.db
      .select({ snapshot: trials.sourceSnapshot })
      .from(trials)
      .where(eq(trials.id, trial.id));
    const study = await this.ctgov.getStudy(nctId, { fresh: true });
    let converted: ReturnType<typeof studyToTrial>;
    try {
      converted = studyToTrial(study);
    } catch (err) {
      if (!(err instanceof NotATrialError)) throw err;
      throw new UnprocessableEntityException({
        statusCode: 422,
        message: err.message,
      } satisfies ApiError);
    }
    const diff = diffRegistry(
      snapshot ?? trialAsRegistryInput(trial),
      converted.trial,
      trial,
    );
    const now = new Date();
    await this.db.transaction(async (tx) => {
      if (!hasChanges(diff)) {
        // In step (or the registry changed back): the registry's version is the new baseline.
        await tx
          .delete(trialUpdates)
          .where(
            and(
              eq(trialUpdates.trialId, trial.id),
              eq(trialUpdates.status, 'pending'),
            ),
          );
        await tx
          .update(trials)
          .set({
            sourceSnapshot: converted.trial,
            sourceLastUpdated: converted.lastUpdated,
            sourceCheckedAt: now,
          })
          .where(eq(trials.id, trial.id));
        return;
      }
      const values = {
        registryLastUpdated: converted.lastUpdated,
        fields: diff.fields,
        criteria: diff.criteria,
        snapshot: converted.trial,
        warnings: converted.warnings,
        detectedAt: now,
      };
      await tx
        .insert(trialUpdates)
        .values({ trialId: trial.id, ...values })
        .onConflictDoUpdate({
          target: trialUpdates.trialId,
          targetWhere: sql`${trialUpdates.status} = 'pending'`,
          set: values,
        });
      await tx
        .update(trials)
        .set({ sourceCheckedAt: now })
        .where(eq(trials.id, trial.id));
    });
  }

  /** Marks a pending update resolved; only one person can win. */
  private async claim(
    id: number,
    status: 'applied' | 'dismissed',
    userId: number,
  ): Promise<UpdateRow> {
    const [row] = await this.db
      .update(trialUpdates)
      .set({ status, resolvedAt: new Date(), resolvedById: userId })
      .where(and(eq(trialUpdates.id, id), eq(trialUpdates.status, 'pending')))
      .returning();
    if (row) return row;
    const [exists] = await this.db
      .select({ status: trialUpdates.status })
      .from(trialUpdates)
      .where(eq(trialUpdates.id, id));
    if (!exists) throw new NotFoundException('Update not found.');
    throw new ConflictException({
      statusCode: 409,
      message:
        exists.status === 'applied'
          ? 'Someone already applied this update.'
          : 'Someone already chose to keep the current version.',
    } satisfies ApiError);
  }

  private async unclaim(id: number) {
    await this.db
      .update(trialUpdates)
      .set({ status: 'pending', resolvedAt: null, resolvedById: null })
      .where(eq(trialUpdates.id, id));
  }

  private async pendingCount(trialIds: number[]): Promise<number> {
    if (!trialIds.length) return 0;
    const [{ n }] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(trialUpdates)
      .where(
        and(
          inArray(trialUpdates.trialId, trialIds),
          eq(trialUpdates.status, 'pending'),
        ),
      );
    return n;
  }

  private select() {
    return this.db
      .select({
        update: trialUpdates,
        nctId: trials.nctId,
        resolvedBy: users.displayName,
      })
      .from(trialUpdates)
      .innerJoin(trials, eq(trials.id, trialUpdates.trialId))
      .leftJoin(users, eq(users.id, trialUpdates.resolvedById));
  }
}

const criterionKey = (c: CriterionInput) =>
  `${c.type}\u0000${c.text.replace(/\s+/g, ' ').trim()}`;

function toTrialUpdate(row: {
  update: UpdateRow;
  nctId: string | null;
  resolvedBy: string | null;
}): TrialUpdate {
  const u = row.update;
  return {
    id: u.id,
    trialId: u.trialId,
    nctId: row.nctId ?? (u.snapshot as RegistryTrialInput).nctId,
    registryLastUpdated: u.registryLastUpdated,
    fields: u.fields,
    criteria: u.criteria,
    warnings: u.warnings,
    status: u.status,
    detectedAt: u.detectedAt.toISOString(),
    resolvedAt: u.resolvedAt?.toISOString() ?? null,
    resolvedBy: row.resolvedBy,
  };
}
