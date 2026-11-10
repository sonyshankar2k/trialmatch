import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CtgovStudy } from '../ctgov-mapper';

/** A ClinicalTrials.gov v2 study record from this folder (used by tests). */
export const fixture = (name: 'bullets' | 'cohorts' | 'numbered') =>
  JSON.parse(
    readFileSync(join(__dirname, `${name}.json`), 'utf8'),
  ) as CtgovStudy;
