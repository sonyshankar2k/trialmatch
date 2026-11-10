import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  ApiError,
  RegistryPreview,
  RegistrySearchQuerySchema,
  RegistrySearchResult,
  Trial,
} from '@trialmatch/shared';
import { TrialCreateSchema } from '@trialmatch/shared';
import type { z } from 'zod';
import { TrialsService } from '../trials/trials.service';
import { NotATrialError, studyToHit, studyToTrial } from './ctgov-mapper';
import { CtgovClient } from './ctgov.client';

export const REGISTRY_PAGE_SIZE = 10;

@Injectable()
export class RegistryService {
  constructor(
    private readonly ctgov: CtgovClient,
    private readonly trials: TrialsService,
  ) {}

  async search(
    query: z.output<typeof RegistrySearchQuerySchema>,
  ): Promise<RegistrySearchResult> {
    const page = await this.ctgov.search({
      ...query,
      pageSize: REGISTRY_PAGE_SIZE,
    });
    const hits = (page.studies ?? []).map(studyToHit).filter((h) => h !== null);
    const imported = await this.trials.idsByNct(hits.map((h) => h.nctId));
    return {
      items: hits.map((h) => ({
        ...h,
        importedTrialId: imported.get(h.nctId) ?? null,
      })),
      total: page.totalCount ?? null,
      nextPageToken: page.nextPageToken ?? null,
    };
  }

  async preview(nctId: string): Promise<RegistryPreview> {
    const study = await this.ctgov.getStudy(nctId);
    const converted = this.convert(study, nctId);
    const imported = await this.trials.idsByNct([nctId]);
    return {
      nctId,
      ...converted,
      importedTrialId: imported.get(nctId) ?? null,
    };
  }

  /** Creates the trial. 409 (with the existing trial's id) if the study is already here. */
  async import(nctId: string, userId: number): Promise<Trial> {
    const existing = (await this.trials.idsByNct([nctId])).get(nctId);
    if (existing) throw alreadyImported(nctId, existing);
    const { trial, lastUpdated } = this.convert(
      await this.ctgov.getStudy(nctId),
      nctId,
    );
    // The same validation as a trial typed in by hand.
    const input = TrialCreateSchema.parse(trial);
    try {
      return await this.trials.create(input, userId, {
        source: 'clinicaltrials_gov',
        sourceLastUpdated: lastUpdated,
      });
    } catch (err) {
      // Two people importing the same study at once: the unique NCT ID decides.
      const winner = (await this.trials.idsByNct([nctId])).get(nctId);
      if (winner) throw alreadyImported(nctId, winner);
      throw err;
    }
  }

  private convert(study: Parameters<typeof studyToTrial>[0], nctId: string) {
    try {
      const converted = studyToTrial(study);
      if (converted.trial.nctId !== nctId) {
        throw new NotATrialError(
          `ClinicalTrials.gov returned ${converted.trial.nctId} for ${nctId}.`,
        );
      }
      return converted;
    } catch (err) {
      if (err instanceof NotATrialError) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          message: err.message,
        } satisfies ApiError);
      }
      throw err;
    }
  }
}

function alreadyImported(nctId: string, trialId: number) {
  return new ConflictException({
    statusCode: 409,
    message: `${nctId} is already in TrialMatch.`,
    current: { id: trialId },
  } satisfies ApiError);
}
