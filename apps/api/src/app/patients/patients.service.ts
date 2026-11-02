import { Injectable, NotFoundException } from '@nestjs/common';
import type { Page, Patient } from '@trialmatch/shared';
import {
  PatientCreateSchema,
  PatientListQuerySchema,
  PatientUpdateSchema,
} from '@trialmatch/shared';
import { and, count, desc, eq, ilike, or, sql, SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { FieldError, VersionConflict } from '../common/errors';
import { InjectDb, pgErrorCode, PG_UNIQUE_VIOLATION } from '../db/database';
import type { Db } from '../db/database';
import { patients } from '../db/schema';

type PatientRow = typeof patients.$inferSelect;

const likePattern = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Every query is scoped to the owner. Another user's patient id behaves exactly
 * like one that doesn't exist (404), so ids can't be probed.
 */
@Injectable()
export class PatientsService {
  constructor(@InjectDb() private readonly db: Db) {}

  async list(
    ownerId: number,
    query: z.output<typeof PatientListQuerySchema>,
  ): Promise<Page<Patient>> {
    const filters: SQL[] = [eq(patients.ownerId, ownerId)];
    if (query.search) {
      const p = likePattern(query.search);
      // Matches the pseudonym or any listed condition.
      filters.push(
        or(
          ilike(patients.pseudonym, p),
          sql`exists (select 1 from unnest(${patients.conditions}) c where c ilike ${p})`,
        ) as SQL,
      );
    }
    const where = and(...filters);
    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select()
        .from(patients)
        .where(where)
        .orderBy(desc(patients.updatedAt), desc(patients.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ total: count() }).from(patients).where(where),
    ]);
    return {
      items: rows.map(toPatient),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(ownerId: number, id: number): Promise<Patient> {
    const row = await this.db.query.patients.findFirst({
      where: and(eq(patients.id, id), eq(patients.ownerId, ownerId)),
    });
    if (!row) throw new NotFoundException('Patient not found.');
    return toPatient(row);
  }

  async create(
    ownerId: number,
    input: z.output<typeof PatientCreateSchema>,
  ): Promise<Patient> {
    return this.uniquePseudonym(async () => {
      const [row] = await this.db
        .insert(patients)
        .values({ ...input, notes: input.notes ?? null, ownerId })
        .returning();
      return toPatient(row);
    });
  }

  async update(
    ownerId: number,
    id: number,
    input: z.output<typeof PatientUpdateSchema>,
  ): Promise<Patient> {
    const { version, ...fields } = input;
    const [row] = await this.uniquePseudonym(() =>
      this.db
        .update(patients)
        .set({
          ...fields,
          version: sql`${patients.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(patients.id, id),
            eq(patients.ownerId, ownerId),
            eq(patients.version, version),
          ),
        )
        .returning(),
    );
    if (row) return toPatient(row);
    throw new VersionConflict(await this.get(ownerId, id));
  }

  async remove(ownerId: number, id: number, version: number): Promise<void> {
    const deleted = await this.db
      .delete(patients)
      .where(
        and(
          eq(patients.id, id),
          eq(patients.ownerId, ownerId),
          eq(patients.version, version),
        ),
      )
      .returning({ id: patients.id });
    if (!deleted.length) throw new VersionConflict(await this.get(ownerId, id));
  }

  private async uniquePseudonym<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
        throw new FieldError(
          'pseudonym',
          'You already have a patient with this pseudonym.',
        );
      }
      throw err;
    }
  }
}

function toPatient(p: PatientRow): Patient {
  return {
    id: p.id,
    pseudonym: p.pseudonym,
    age: p.age,
    sex: p.sex,
    conditions: p.conditions,
    medications: p.medications,
    notes: p.notes,
    version: p.version,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}
