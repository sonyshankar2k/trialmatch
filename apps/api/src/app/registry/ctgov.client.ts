import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiError } from '@trialmatch/shared';
import type { Env } from '../config';
import type { CtgovStudy } from './ctgov-mapper';

/** Fields a search result row needs, so a page of results stays small. */
const SEARCH_FIELDS = [
  'NCTId',
  'BriefTitle',
  'OfficialTitle',
  'OverallStatus',
  'Phase',
  'Condition',
  'LeadSponsorName',
  'MinimumAge',
  'MaximumAge',
  'Sex',
  'LastUpdatePostDate',
].join(',');

const STATUS_FILTER: Record<string, string | undefined> = {
  recruiting: 'RECRUITING',
  not_yet_recruiting: 'NOT_YET_RECRUITING',
  any: undefined,
};

interface CacheEntry {
  expires: number;
  study: CtgovStudy;
}

/**
 * HTTP client for the ClinicalTrials.gov API v2 (public, no key).
 * - Every call has a timeout, and registry failures become a 502 with a message
 *   a person can act on, never a hanging request or a 500.
 * - Study records are cached for a few minutes: previewing then importing
 *   fetches the same record twice, and the registry asks clients to go easy.
 */
@Injectable()
export class CtgovClient {
  private readonly log = new Logger(CtgovClient.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly cache = new Map<string, CacheEntry>();
  static readonly CACHE_TTL_MS = 5 * 60_000;
  static readonly CACHE_MAX = 200;

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = config.get('CTGOV_BASE_URL', { infer: true });
    this.timeoutMs = config.get('CTGOV_TIMEOUT_MS', { infer: true });
  }

  async search(q: {
    condition?: string;
    term?: string;
    status: string;
    pageToken?: string;
    pageSize: number;
  }): Promise<{
    studies: CtgovStudy[];
    totalCount?: number;
    nextPageToken?: string;
  }> {
    const params: Record<string, string | undefined> = {
      'query.cond': q.condition || undefined,
      'query.term': q.term || undefined,
      'filter.overallStatus': STATUS_FILTER[q.status],
      pageSize: String(q.pageSize),
      pageToken: q.pageToken,
      countTotal: q.pageToken ? undefined : 'true',
    };
    const narrowed = {
      ...params,
      // Interventional studies only: observational studies and expanded access
      // programs have no eligibility criteria to match patients against.
      'filter.advanced': 'AREA[StudyType]INTERVENTIONAL',
      fields: SEARCH_FIELDS,
    };
    try {
      return await this.getJson('/studies', narrowed);
    } catch (err) {
      // If the registry ever rejects the narrowing options, the plain search still works.
      if (!(err instanceof RegistryRejected)) throw err;
      return this.getJson('/studies', params);
    }
  }

  async getStudy(nctId: string): Promise<CtgovStudy> {
    const cached = this.cache.get(nctId);
    if (cached && cached.expires > Date.now()) return cached.study;
    const study = await this.getJson<CtgovStudy>(
      `/studies/${nctId}`,
      {},
      () => {
        throw new NotFoundException({
          statusCode: 404,
          message: `${nctId} isn't on ClinicalTrials.gov. Check the NCT ID.`,
        } satisfies ApiError);
      },
    );
    this.cache.delete(nctId);
    this.cache.set(nctId, {
      study,
      expires: Date.now() + CtgovClient.CACHE_TTL_MS,
    });
    // Oldest first: drop the oldest entry when full.
    if (this.cache.size > CtgovClient.CACHE_MAX) {
      this.cache.delete(this.cache.keys().next().value as string);
    }
    return study;
  }

  /** Forget cached records (tests, and re-reading a record that just changed). */
  clearCache() {
    this.cache.clear();
  }

  private async getJson<T>(
    path: string,
    params: Record<string, string | undefined>,
    onNotFound?: () => never,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      this.log.warn(`ClinicalTrials.gov request failed: ${String(err)}`);
      throw unavailable();
    }
    if (res.status === 404 && onNotFound) onNotFound();
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      this.log.warn(
        `ClinicalTrials.gov answered ${res.status} for ${url.pathname}: ${detail}`,
      );
      if (res.status === 400) throw new RegistryRejected();
      throw unavailable();
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw unavailable();
    }
  }
}

/** The registry answered 400: it didn't accept the request. */
class RegistryRejected extends BadGatewayException {
  constructor() {
    super({
      statusCode: 502,
      message:
        'ClinicalTrials.gov could not run this search. Try simpler words.',
    } satisfies ApiError);
  }
}

const unavailable = () =>
  new BadGatewayException({
    statusCode: 502,
    message: "ClinicalTrials.gov didn't respond. Try again in a minute.",
  } satisfies ApiError);
