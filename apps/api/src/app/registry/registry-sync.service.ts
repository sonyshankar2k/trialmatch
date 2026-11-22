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
  type TrialUpdateApplyInput,
} from '@trialmatch/shared';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/database';
import { trials, trialUpdates, users } from '../db/schema';
import { TrialsService, type Tx } from '../trials/trials.service';
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
    if (!row) return null;
    const { trial, diff } = await this.live(this.db, row.update);
    return toTrialUpdate(row, { ...diff, trialVersion: trial.version });
  }

  /**
   * The pending update compared with the trial as it is now (local saves since
   * it was detected count): the registry's version against the baseline the
   * trial still has, and the trial's current values next to it.
   */
  private async live(db: Db | Tx, update: UpdateRow) {
    const [{ snapshot }] = await db
      .select({ snapshot: trials.sourceSnapshot })
      .from(trials)
      .where(eq(trials.id, update.trialId));
    const trial = await this.trials.get(update.trialId, db);
    return {
      trial,
      diff: diffRegistry(
        snapshot ?? trialAsRegistryInput(trial),
        update.snapshot,
        trial,
      ),
    };
  }

  /**
   * Take the registry's values for the changed fields, and its criteria changes
   * (removed criteria go, added ones are appended; local wording of the others
   * is kept). The comparison is worked out again against the trial now, which
   * must be at `version` (the version the person saw it against): 409 if not,
   * as for a stale `revision`. Removed criteria the trial has reworded need
   * `reconciled`. Resolving and saving commit together; any failure leaves the
   * update pending.
   */
  async apply(
    updateId: number,
    { revision, version, reconciled }: TrialUpdateApplyInput,
    userId: number,
  ): Promise<Trial> {
    return this.db.transaction(async (tx) => {
      const update = await this.resolve(
        tx,
        updateId,
        revision,
        'applied',
        userId,
      );
      const { trial, diff } = await this.live(tx, update);
      const { added, removed } = diff.criteria;
      if (removed.some((c) => !c.inTrial) && !reconciled)
        throw new BadRequestException({
          statusCode: 400,
          message:
            'Some criteria removed on ClinicalTrials.gov are worded differently here, so Apply cannot remove them. Check your versions, then confirm and apply.',
        } satisfies ApiError);
      const patch: Record<string, unknown> = {};
      for (const { field } of diff.fields) {
        patch[field] = update.snapshot[field];
        // Ages move together, so the range stays valid.
        if (field === 'minAge' || field === 'maxAge') {
          patch['minAge'] = update.snapshot.minAge;
          patch['maxAge'] = update.snapshot.maxAge;
        }
      }
      if (added.length || removed.length) {
        const gone = new Set(
          removed.filter((c) => c.inTrial).map(criterionKey),
        );
        patch['criteria'] = [
          ...trial.criteria
            .map(({ type, text }) => ({ type, text }))
            .filter((c) => !gone.has(criterionKey(c))),
          ...added,
        ];
      }
      const parsed = TrialUpdateSchema.safeParse({ ...patch, version });
      if (!parsed.success)
        throw new BadRequestException({
          statusCode: 400,
          message: `Applying this update would leave the trial invalid (${parsed.error.issues
            .map((i) => `${i.path.join('.') || 'trial'}: ${i.message}`)
            .join(
              '; ',
            )}). Edit the trial here first, for example remove criteria you no longer need, then apply.`,
        } satisfies ApiError);
      // History records what was actually applied.
      await tx
        .update(trialUpdates)
        .set({ fields: diff.fields, criteria: diff.criteria })
        .where(eq(trialUpdates.id, update.id));
      return this.trials.update(
        trial.id,
        parsed.data,
        {
          sourceSnapshot: update.snapshot,
          sourceLastUpdated: update.registryLastUpdated,
        },
        tx,
      );
    });
  }

  /** Keep the trial as it is; the registry's version (the revision reviewed) counts as seen. */
  async dismiss(
    updateId: number,
    revision: number,
    userId: number,
  ): Promise<Trial> {
    return this.db.transaction(async (tx) => {
      const update = await this.resolve(
        tx,
        updateId,
        revision,
        'dismissed',
        userId,
      );
      await tx
        .update(trials)
        .set({
          sourceSnapshot: update.snapshot,
          sourceLastUpdated: update.registryLastUpdated,
        })
        .where(eq(trials.id, update.trialId));
      return this.trials.get(update.trialId, tx);
    });
  }

  /** Fetch, compare, and record the result (a pending update, or the new snapshot). */
  private async check(trial: Trial): Promise<void> {
    const nctId = trial.nctId as string;
    // The registry request happens outside the transaction; the comparison inside it.
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
    await this.db.transaction(async (tx) => {
      // Waits for any Apply / Keep on this trial, then reads the baseline they left.
      const snapshot = await this.lockTrial(tx, trial.id);
      const current = await this.trials.get(trial.id, tx);
      const [pending] = await tx
        .select()
        .from(trialUpdates)
        .where(
          and(
            eq(trialUpdates.trialId, trial.id),
            eq(trialUpdates.status, 'pending'),
          ),
        );
      // Under the lock, before comparing: a response older than the newest
      // record TrialMatch has (accepted baseline or pending update) changes
      // nothing, so a delayed answer can't replace, clear or roll back newer state.
      if (
        isOutdated(converted.lastUpdated, [
          current.sourceLastUpdated,
          pending?.registryLastUpdated,
        ])
      )
        return;
      const diff = diffRegistry(
        snapshot ?? trialAsRegistryInput(current),
        converted.trial,
        current,
      );
      const now = new Date();
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
      if (!pending)
        await tx.insert(trialUpdates).values({ trialId: trial.id, ...values });
      else if (!sameChange(pending, values))
        // Someone may be reviewing the old one: a new revision makes their decision stale.
        await tx
          .update(trialUpdates)
          .set({ ...values, revision: sql`${trialUpdates.revision} + 1` })
          .where(eq(trialUpdates.id, pending.id));
      await tx
        .update(trials)
        // A trial imported before Week 8 keeps the baseline it was compared
        // with, so later comparisons (and Apply) start from the same place.
        .set({
          sourceCheckedAt: now,
          ...(snapshot
            ? {}
            : { sourceSnapshot: trialAsRegistryInput(current) }),
        })
        .where(eq(trials.id, trial.id));
    });
  }

  /** Row-locks the trial for the rest of the transaction; returns its snapshot. */
  private async lockTrial(tx: Tx, trialId: number) {
    const [row] = await tx
      .select({ snapshot: trials.sourceSnapshot })
      .from(trials)
      .where(eq(trials.id, trialId))
      .for('update');
    if (!row) throw new NotFoundException('Trial not found.');
    return row.snapshot;
  }

  /**
   * Marks a pending update resolved, under the trial's lock so a check cannot
   * raise the same change meanwhile. Only the revision the person reviewed can
   * be resolved, and only once.
   */
  private async resolve(
    tx: Tx,
    id: number,
    revision: number,
    status: 'applied' | 'dismissed',
    userId: number,
  ): Promise<UpdateRow> {
    const [found] = await tx
      .select({ trialId: trialUpdates.trialId })
      .from(trialUpdates)
      .where(eq(trialUpdates.id, id));
    if (!found)
      throw new NotFoundException(
        'This update is no longer pending: the trial is in step with ClinicalTrials.gov.',
      );
    await this.lockTrial(tx, found.trialId);
    const [row] = await tx
      .select()
      .from(trialUpdates)
      .where(eq(trialUpdates.id, id));
    if (!row)
      throw new NotFoundException(
        'This update is no longer pending: the trial is in step with ClinicalTrials.gov.',
      );
    const conflict = (message: string) =>
      new ConflictException({ statusCode: 409, message } satisfies ApiError);
    if (row.status === 'applied')
      throw conflict('Someone already applied this update.');
    if (row.status === 'dismissed')
      throw conflict('Someone already chose to keep the current version.');
    if (row.revision !== revision)
      throw conflict(
        'ClinicalTrials.gov changed this study again since you looked. Review the latest changes.',
      );
    const [resolved] = await tx
      .update(trialUpdates)
      .set({ status, resolvedAt: new Date(), resolvedById: userId })
      .where(eq(trialUpdates.id, id))
      .returning();
    return resolved;
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

/**
 * Registry records are ordered by their last-update date (YYYY-MM-DD, so string
 * order is date order). A record dated the same day as the newest known one is
 * not outdated: its content is compared as usual. An undated record can't be
 * shown to be newer, so it is outdated once TrialMatch has any dated record,
 * and accepted only when nothing known is dated either.
 */
export function isOutdated(
  date: string | null,
  known: (string | null | undefined)[],
): boolean {
  const newest = known
    .filter((d): d is string => !!d)
    .sort()
    .at(-1);
  if (!newest) return false;
  return date === null || date < newest;
}

/**
 * The same registry record seen again (e.g. Check now twice): keep the
 * revision. Local saves don't count; the comparison follows the trial anyway.
 */
const sameChange = (
  row: UpdateRow,
  v: Pick<UpdateRow, 'registryLastUpdated' | 'snapshot'>,
) =>
  row.registryLastUpdated === v.registryLastUpdated &&
  stable(row.snapshot) === stable(v.snapshot);

/** JSON with sorted keys: jsonb does not keep the key order it was given. */
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : 1,
          ),
        )
      : x,
  );

const criterionKey = (c: CriterionInput) =>
  `${c.type}\u0000${c.text.replace(/\s+/g, ' ').trim()}`;

function toTrialUpdate(
  row: { update: UpdateRow; nctId: string | null; resolvedBy: string | null },
  live: Pick<TrialUpdate, 'fields' | 'criteria' | 'trialVersion'>,
): TrialUpdate {
  const u = row.update;
  return {
    id: u.id,
    revision: u.revision,
    trialId: u.trialId,
    nctId: row.nctId ?? (u.snapshot as RegistryTrialInput).nctId,
    registryLastUpdated: u.registryLastUpdated,
    trialVersion: live.trialVersion,
    fields: live.fields,
    criteria: live.criteria,
    warnings: u.warnings,
    status: u.status,
    detectedAt: u.detectedAt.toISOString(),
    resolvedAt: u.resolvedAt?.toISOString() ?? null,
    resolvedBy: row.resolvedBy,
  };
}
