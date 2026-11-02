import { z } from 'zod';
import { PageQuerySchema, VersionSchema, text } from './common.js';

/**
 * De-identified patient profiles: a pseudonym (never a real name), age, sex and
 * clinical facts. Each user sees only the patients they created.
 */
const listOfTerms = z.array(text(200)).max(50).default([]);

const patientFields = {
  pseudonym: z
    .string()
    .trim()
    .regex(
      /^[A-Za-z0-9-]{2,30}$/,
      'Letters, digits and dashes only (e.g. P-0042). Never a real name.',
    ),
  age: z.number().int().min(0).max(120),
  sex: z.enum(['female', 'male']),
  conditions: listOfTerms,
  medications: listOfTerms,
  /** Free-text clinical summary (labs, history). Week 2's AI matching reads this. */
  notes: z.string().trim().max(10_000).nullable().optional(),
};

export const PatientCreateSchema = z.object(patientFields);
export type PatientCreateInput = z.input<typeof PatientCreateSchema>;

export const PatientUpdateSchema = z.object({
  pseudonym: patientFields.pseudonym.optional(),
  age: patientFields.age.optional(),
  sex: patientFields.sex.optional(),
  conditions: z.array(text(200)).max(50).optional(),
  medications: z.array(text(200)).max(50).optional(),
  notes: patientFields.notes,
  version: VersionSchema,
});
export type PatientUpdateInput = z.input<typeof PatientUpdateSchema>;

export const PatientListQuerySchema = PageQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
});

export interface Patient {
  id: number;
  pseudonym: string;
  age: number;
  sex: 'female' | 'male';
  conditions: string[];
  medications: string[];
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}
