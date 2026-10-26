import { cleanEpgDescription } from '../../shared/utils/epgDescription';
import { runContentIdentity } from './ContentIdentityIngestion';
import { ICacheRepository } from '@/domain/repositories/ICacheRepository';
import { IProgramRepository } from '@/domain/repositories/IProgramRepository';
import { ChannelModel } from '@/infrastructure/database/models/Channel.model';
import { EPGSourceSnapshotModel } from '@/infrastructure/database/models/EPGSourceSnapshot.model';
import { TVProgramBrandModel } from '@/infrastructure/database/models/TVProgramBrand.model';
import { TVReadAiringModel } from '@/infrastructure/database/models/TVReadAiring.model';
import { logger } from '@/shared/utils/logger';
import { DateUtils } from '@/shared/utils/dateUtils';
import { l1Cache } from '@/infrastructure/cache/L1Cache';
import {
  CatalogAssetCandidate,
  buildChannelIdentityMetadata,
  buildProgramBrandKey,
  buildProgramTitleAliases,
  buildSearchTokens,
  buildTimeSlotKey,
  buildTvReadAiringId,
  inferChannelGroup,
  inferEditorialCategory,
  inferPartOfDay,
  inferSportFacet,
  isGenericMovieTitle,
  normalizeTvToken,
  TvTitleResolutionState,
} from '@/shared/utils/tvMetadata';
import { ProgramDeduplicator } from './ProgramDeduplicator';
import { guardExistingMediaIds, runCatalogueLinkShadow } from './CatalogueLinkShadow';
import { assignVerifiedWorkPaths } from './VerifiedWorkLinks';
import { getPrimaryEpgSourceUrl, isTdtChannelsSourceUrl } from '@/shared/config/epgSources';

export interface ResolvedProgramEntry {
  program: any;
  channelDoc: any | null;
  resolvedChannelId: string;
  channelGroup: string;
}

export function scopeResolvedProgramsToCoreSources<T extends Pick<ResolvedProgramEntry, 'program' | 'resolvedChannelId'>>(
  entries: T[],
  primarySourceUrl: string
): T[] {
  const isCoreSource = (sourceFeed: unknown) => {
    const source = String(sourceFeed || '').trim();
    return !source || source === primarySourceUrl || isTdtChannelsSourceUrl(source);
  };
  const coreChannelIds = new Set(
    entries
      .filter((entry) => isCoreSource(entry.program?.sourceFeed))
      .map((entry) => entry.resolvedChannelId)
      .filter(Boolean)
  );
  return entries.filter(
    (entry) => isCoreSource(entry.program?.sourceFeed) || coreChannelIds.has(entry.resolvedChannelId)
  );
}

interface ProgramTitleResolution {
  state: TvTitleResolutionState;
  isResolvedTitle: boolean;
  consumerSuppressed: boolean;
  suppressionReason?: string;
  winnerProgramId?: string;
  winnerSourceFeed?: string;
}

export interface TvReadModelBuildResult {
  date: string;
  airingsUpserted: number;
  brandsUpserted: number;
  generatedAt: string;
}

export class TvReadModelBuilder {
  private readonly log = logger.child('TvReadModelBuilder');

  constructor(
    private readonly programRepository: IProgramRepository,
    private readonly cacheRepository: ICacheRepository
  ) {}

  async rebuildDate(dateAliasOrDate: string): Promise<TvReadModelBuildResult> {
    const date = DateUtils.parseDateAlias(dateAliasOrDate);
    const generatedAt = new Date().toISOString();
    const [programs, channels, snapshots] = await Promise.all([
      this.programRepository.findByDate(date, 'full'),
      ChannelModel.find({ active: true }).lean().exec(),
      EPGSourceSnapshotModel.find({ date }).lean().exec(),
    ]);

    const channelById = new Map(
      channels.map((channel: any) => [String(channel.id), channel] as const)
    );
    const { canonicalChannelById, channelByAlias } =
      this.buildCanonicalChannelMaps(channels as any[]);

    const primarySourceUrl = getPrimaryEpgSourceUrl();
    const suspiciousGroups = this.buildSuspiciousProgrammeGroups(programs);
    const inGroupConfirmationMap = this.buildCrossSourceConfirmationMap(
      programs,
      primarySourceUrl,
      canonicalChannelById,
      channelByAlias,
      channelById
    );
    const confirmationMap = this.buildSecondaryConfirmationMap(
      snapshots as any[],
      channelByAlias
    );

    const resolvedEntries = programs.map((program) => {
      const channelDoc = this.resolveChannelDocument(
        [program.canonicalChannelId, program.channelId],
        canonicalChannelById,
        channelByAlias,
        channelById
      );
      const resolvedChannelId =
        channelDoc?.id || program.canonicalChannelId || program.channelId;
      const channelGroup = inferChannelGroup({
        name: channelDoc?.name || resolvedChannelId,
        type: channelDoc?.type,
        sourceId: channelDoc?.id || resolvedChannelId,
        country: channelDoc?.country,
        countryCode: channelDoc?.countryCode,
      });

      return {
        program,
        channelDoc,
        resolvedChannelId,
        channelGroup,
      } satisfies ResolvedProgramEntry;
    });

    const scopedResolvedEntries = scopeResolvedProgramsToCoreSources(
      resolvedEntries,
      primarySourceUrl
    );
    const titleResolutions = this.buildTitleResolutionMap(scopedResolvedEntries);
    const brands = new Map<string, any>();
    const airingsById = new Map<string, any>();
    const identityYears = new Map<string, unknown>();
    const identityRawYears = new Map<string, unknown>();
    scopedResolvedEntries.forEach(({ program, channelDoc, resolvedChannelId, channelGroup }) => {
      const anomalyKey = this.buildProgrammeGroupKey(program.startTime, program.title);
      const confirmedChannels =
        inGroupConfirmationMap.get(anomalyKey) || confirmationMap.get(anomalyKey);
      const channelIdentity = buildChannelIdentityMetadata({
        name: channelDoc?.name || resolvedChannelId,
        sourceId:
          (Array.isArray(channelDoc?.sourceIds) && channelDoc.sourceIds[0]) ||
          channelDoc?.id ||
          resolvedChannelId,
        country: channelDoc?.country,
        countryCode: channelDoc?.countryCode,
        region: channelDoc?.region,
      });
      const titleResolution = titleResolutions.get(program.id) || {
        state: isGenericMovieTitle(program.title)
          ? 'generic_unresolved'
          : 'specific_source_title',
        isResolvedTitle: !isGenericMovieTitle(program.title),
        consumerSuppressed: isGenericMovieTitle(program.title),
      };
      const rawEditorialCategory = this.resolveEditorialCategory(program);
      const sportFacet = inferSportFacet({
        editorialCategory: rawEditorialCategory,
        genre: program.genre,
        subgenre: program.subgenre,
        title: program.title,
        description: cleanEpgDescription(program.description),
        channelName: channelDoc?.name || resolvedChannelId,
      });
      const editorialCategory =
        rawEditorialCategory === 'Otros' && sportFacet ? 'Deportes' : rawEditorialCategory;
      const brandKey = buildProgramBrandKey(program.title);
      const normalizedTitle = program.normalizedTitle || normalizeTvToken(program.title, ' ');
      const titleAliases = program.titleAliases.length
        ? program.titleAliases
        : buildProgramTitleAliases(program.title);
      const persistedSortOrder = Number(channelDoc?.order);
      const computedSortOrder = Number(channelIdentity.sortOrder ?? 999);
      const effectiveSortOrder = Number.isFinite(persistedSortOrder)
        ? Math.min(persistedSortOrder, computedSortOrder)
        : computedSortOrder;
      const assets = this.buildAiringAssets(program, channelDoc?.logo);
      const programImage = assets.poster?.url || assets.backdrop?.url || assets.primary?.url;
      const airingId = buildTvReadAiringId({
        viewDate: date,
        channelId: resolvedChannelId,
        startTime: program.startTime,
        normalizedTitle,
      });
      const partOfDay = inferPartOfDay(program.startTime);
      const liveNow = false;
      const timingWindow = partOfDay === 'noche' ? 'tonight' : 'today';
      const trustDecision = this.buildTrustDecision(
        program,
        assets,
        primarySourceUrl,
        suspiciousGroups.has(anomalyKey),
        confirmedChannels,
        resolvedChannelId,
        titleResolution
      );
      const relevanceScore =
        (trustDecision.featuredSuppressed ? -100 : 0) +
        (programImage ? 20 : 0) +
        Math.max(0, 20 - channelIdentity.sortOrder) +
        (trustDecision.sourceAgreement === 'merged' ? 10 : 0);

      const item = {
        id: airingId,
        date,
        viewDate: date,
        channel: {
          id: resolvedChannelId,
          name: channelDoc?.name || resolvedChannelId,
          normalizedName:
            canonicalChannelById.get(resolvedChannelId)?.normalizedName ||
            channelDoc?.normalizedName ||
            channelIdentity.normalizedName,
          aliases: Array.from(new Set([...(channelDoc?.aliases || []), ...channelIdentity.aliases])),
          sourceIds: Array.from(new Set([...(channelDoc?.sourceIds || []), ...channelIdentity.sourceIds])),
          type: String(channelDoc?.type || channelIdentity.inferredType),
          group: channelGroup,
          subgroups: Array.from(
            new Set([
              channelGroup,
              normalizeTvToken(channelDoc?.type || channelIdentity.inferredType, ' '),
              normalizeTvToken(channelDoc?.region, ' '),
            ].filter(Boolean))
          ),
          sortOrder: effectiveSortOrder,
          icon: channelDoc?.logo || undefined,
          country: channelDoc?.country || undefined,
          countryCode: channelDoc?.countryCode || undefined,
          region: channelDoc?.region || undefined,
          description: channelDoc?.description || undefined,
          distribution: channelIdentity.distribution,
          access: channelIdentity.access,
          operator: channelIdentity.operator,
          providers: channelIdentity.providers,
          contentFacets: channelIdentity.contentFacets,
          market: channelIdentity.market,
          quality: channelIdentity.quality,
          capabilities: channelIdentity.capabilities,
          provenance: {
            ...channelIdentity.provenance,
            sourceIds: Array.from(
              new Set([
                ...channelIdentity.provenance.sourceIds,
                ...(Array.isArray(channelDoc?.sourceIds) ? channelDoc.sourceIds : []),
              ])
            ),
          },
        },
        program: {
          brandKey,
          title: program.title,
          subtitle: program.subtitle,
          normalizedTitle,
          titleAliases,
          editorialCategory,
          genre: program.genre,
          subgenre: program.subgenre,
          genreTags: program.genreTags,
          sportFacet,
          tmdbId: program.tmdbId,
          mediaId: program.mediaId,
          description: cleanEpgDescription(program.description),
          titleResolutionState: titleResolution.state,
          isResolvedTitle: titleResolution.isResolvedTitle,
        },
        airing: {
          id: airingId,
          date,
          start: program.startTime.toISOString(),
          end: program.endTime.toISOString(),
          durationMinutes: program.duration,
          liveNow,
          partOfDay,
          timeSlotKey: buildTimeSlotKey(program.startTime),
        },
        assets,
        availability: {
          live: true,
          catchup: false,
          streaming: false,
        },
        sourceProvenance: {
          schedule: Array.from(
            new Set([
              ...(((program.sourceProvenance as any)?.schedule || []) as string[]),
              ...(program.sourceFeed ? [program.sourceFeed] : []),
            ])
          ),
          metadata: Array.from(
            new Set(
              program.tmdbId
                ? [
                    ...(((program.sourceProvenance as any)?.metadata || []) as string[]),
                    'tmdb',
                  ]
                : (((program.sourceProvenance as any)?.metadata || []) as string[])
            )
          ),
          assets: Array.from(
            new Set(
              [
                ...(((program.sourceProvenance as any)?.assets || []) as string[]),
                ...(assets.fallbackChain || []).map((asset: CatalogAssetCandidate) => asset.source),
              ].filter(Boolean)
            )
          ),
          legacyProgramIds: [program.id],
          titleSource: titleResolution.winnerSourceFeed || program.sourceFeed,
        },
        timingContext: {
          start: program.startTime.toISOString(),
          end: program.endTime.toISOString(),
          liveNow,
          window: timingWindow,
        },
        relevance: {
          score: relevanceScore,
          reason: trustDecision.featuredSuppressed
            ? 'suppressed_low_trust'
            : programImage
              ? 'has_poster'
              : 'channel_priority',
        },
        trustDecision,
        searchTokens: buildSearchTokens([
          program.title,
          program.subtitle,
          normalizedTitle,
          ...titleAliases,
          editorialCategory,
          channelDoc?.name,
          ...(channelDoc?.aliases || []),
        ]),
      };

      if (program.year && !identityYears.has(airingId)) identityYears.set(airingId, program.year);
      // EPG_YEAR_PROVENANCE (off by default): the feed's own year, kept beside the TMDB one.
      const rawXmltvYear = (program.sourceProvenance?.yearProvenance as { rawXmltvYear?: unknown } | undefined)?.rawXmltvYear;
      if (rawXmltvYear && !identityRawYears.has(airingId)) identityRawYears.set(airingId, rawXmltvYear);
      const currentAiring = airingsById.get(airingId);
      if (currentAiring) {
        airingsById.set(airingId, this.mergeAiringItems(currentAiring, item));
      } else {
        airingsById.set(airingId, item);
      }

      if (titleResolution.state !== 'generic_unresolved' && titleResolution.state !== 'generic_suppressed') {
        const currentBrand = brands.get(brandKey);
        if (!currentBrand || (!currentBrand.assets?.poster && assets.poster)) {
          brands.set(brandKey, {
            brandKey,
            title: program.title,
            normalizedTitle,
            titleAliases,
            editorialCategory,
            genre: program.genre,
            genreTags: program.genreTags,
            tmdbId: program.tmdbId,
            assets,
            sourceProvenance: item.sourceProvenance,
            updatedFromDates: Array.from(
              new Set([...(currentBrand?.updatedFromDates || []), date])
            ),
          });
        } else if (currentBrand) {
          currentBrand.titleAliases = Array.from(
            new Set([...(currentBrand.titleAliases || []), ...titleAliases])
          );
          currentBrand.updatedFromDates = Array.from(
            new Set([...(currentBrand.updatedFromDates || []), date])
          );
          currentBrand.sourceProvenance = {
            schedule: Array.from(
              new Set([
                ...(((currentBrand.sourceProvenance?.schedule || []) as string[])),
                ...item.sourceProvenance.schedule,
              ])
            ),
            metadata: Array.from(
              new Set([
                ...(((currentBrand.sourceProvenance?.metadata || []) as string[])),
                ...item.sourceProvenance.metadata,
              ])
            ),
            assets: Array.from(
              new Set([
                ...(((currentBrand.sourceProvenance?.assets || []) as string[])),
                ...item.sourceProvenance.assets,
              ])
            ),
            titleSource:
              (currentBrand.sourceProvenance?.titleSource as string | undefined) ||
              item.sourceProvenance.titleSource,
          };
        }
      }

    });
    const airings = Array.from(airingsById.values());
    // M03-L2: drop a carried mediaId whose catalogue row is missing, foreign or of the other kind (built airing only).
    await guardExistingMediaIds(airings.map((airing) => airing.program));
    // M10: link the work page only on full identity proof; otherwise cards keep the airing route.
    await assignVerifiedWorkPaths(airings.map((airing) => airing.program));
    // M03-L1: no-op unless EPG_CATALOGUE_LINK_MODE=shadow; reads the built programme fields (resolved category), never mutates.
    await runCatalogueLinkShadow(airings.map((airing) => airing.program));

    await TVReadAiringModel.deleteMany({ date }).exec();
    if (airings.length) {
      await TVReadAiringModel.insertMany(airings, { ordered: false });
    }

    const brandOps = Array.from(brands.values()).map((brand) => ({
      updateOne: {
        filter: { brandKey: brand.brandKey },
        update: { $set: brand },
        upsert: true,
      },
    }));
    if (brandOps.length) {
      await TVProgramBrandModel.bulkWrite(brandOps, { ordered: false });
    }
    // 2D-2: no-op unless a CONTENT_IDENTITY_* flag is on; never throws, so it can't break the day.
    await runContentIdentity(date, airings, identityYears, identityRawYears);

    await this.cacheRepository.clear(`v3:tv:read:${date}:*`);
    await this.cacheRepository.clear(`tv:channels:${date}:*`);
    await this.cacheRepository.clear('tv:surface:*');
    await this.cacheRepository.clear('tv:read:item:*');
    await this.cacheRepository.clear('v2:surface:discovery:home:*');
    await this.cacheRepository.clear('v2:football:reconciliation:airings:*');
    await this.cacheRepository.clear('v2:football:*');
    l1Cache.invalidatePrefix(`v3:tv:read:${date}:`);
    l1Cache.invalidatePrefix(`tv:channels:${date}:`);
    l1Cache.invalidatePrefix('tv:surface:');
    l1Cache.invalidatePrefix('tv:read:item:');
    l1Cache.invalidatePrefix('v2:surface:discovery:home:');

    this.log.info('TV read model rebuilt', {
      date,
      airings: airings.length,
      brands: brandOps.length,
    });

    return {
      date,
      airingsUpserted: airings.length,
      brandsUpserted: brandOps.length,
      generatedAt,
    };
  }

  private mergeAiringItems(primary: any, secondary: any): any {
    const preferred = this.pickPreferredAiring(primary, secondary);
    const fallback = preferred === primary ? secondary : primary;
    const mergedAssets = this.mergeAssetSets(preferred.assets, fallback.assets);
    const mergedTrustDecision = this.mergeTrustDecisions(
      preferred.trustDecision,
      fallback.trustDecision,
      mergedAssets
    );

    return {
      ...preferred,
      program: {
        ...preferred.program,
        subtitle: preferred.program.subtitle || fallback.program.subtitle,
        tmdbId: preferred.program.tmdbId || fallback.program.tmdbId,
        mediaId: preferred.program.mediaId || fallback.program.mediaId,
        description: cleanEpgDescription(preferred.program.description) || cleanEpgDescription(fallback.program.description),
        titleAliases: Array.from(
          new Set([...(preferred.program.titleAliases || []), ...(fallback.program.titleAliases || [])])
        ),
      },
      assets: mergedAssets,
      sourceProvenance: {
        schedule: Array.from(
          new Set([
            ...((preferred.sourceProvenance?.schedule || []) as string[]),
            ...((fallback.sourceProvenance?.schedule || []) as string[]),
          ])
        ),
        metadata: Array.from(
          new Set([
            ...((preferred.sourceProvenance?.metadata || []) as string[]),
            ...((fallback.sourceProvenance?.metadata || []) as string[]),
          ])
        ),
        assets: Array.from(
          new Set([
            ...((preferred.sourceProvenance?.assets || []) as string[]),
            ...((fallback.sourceProvenance?.assets || []) as string[]),
          ])
        ),
        legacyProgramIds: Array.from(
          new Set([
            ...(((preferred.sourceProvenance as any)?.legacyProgramIds || []) as string[]),
            ...(((fallback.sourceProvenance as any)?.legacyProgramIds || []) as string[]),
          ])
        ),
        titleSource:
          (preferred.sourceProvenance as any)?.titleSource ||
          (fallback.sourceProvenance as any)?.titleSource,
      },
      relevance:
        preferred.relevance.score >= fallback.relevance.score
          ? preferred.relevance
          : fallback.relevance,
      trustDecision: mergedTrustDecision,
      searchTokens: Array.from(
        new Set([...(preferred.searchTokens || []), ...(fallback.searchTokens || [])])
      ),
    };
  }

  private pickPreferredAiring(left: any, right: any): any {
    const leftHasPoster = this.hasVisualProgramAsset(left?.assets);
    const rightHasPoster = this.hasVisualProgramAsset(right?.assets);
    if (leftHasPoster !== rightHasPoster) {
      return leftHasPoster ? left : right;
    }
    const leftGeneric = ProgramDeduplicator.isGenericTitle(String(left?.program?.title || ''));
    const rightGeneric = ProgramDeduplicator.isGenericTitle(String(right?.program?.title || ''));
    if (leftGeneric !== rightGeneric) {
      return leftGeneric ? right : left;
    }
    if (Boolean(left?.program?.tmdbId) !== Boolean(right?.program?.tmdbId)) {
      return left?.program?.tmdbId ? left : right;
    }
    if (Boolean(left?.trustDecision?.featuredSuppressed) !== Boolean(right?.trustDecision?.featuredSuppressed)) {
      return left?.trustDecision?.featuredSuppressed ? right : left;
    }
    return left.relevance.score >= right.relevance.score ? left : right;
  }

  private mergeAssetSets(primary: any, secondary: any): any {
    const candidates = [
      ...(primary?.fallbackChain || []),
      ...(secondary?.fallbackChain || []),
    ].filter(
      (asset: CatalogAssetCandidate, index: number, assets: CatalogAssetCandidate[]) =>
        index ===
        assets.findIndex(
          (candidate: CatalogAssetCandidate) =>
            candidate?.kind === asset?.kind &&
            candidate?.source === asset?.source &&
            candidate?.url === asset?.url
        )
    );

    const primaryVisual =
      primary?.primary?.kind === 'poster' || primary?.primary?.kind === 'backdrop'
        ? primary.primary
        : undefined;
    const secondaryVisual =
      secondary?.primary?.kind === 'poster' || secondary?.primary?.kind === 'backdrop'
        ? secondary.primary
        : undefined;
    const fallbackVisual =
      candidates.find((candidate: CatalogAssetCandidate) => candidate.kind === 'poster') ||
      candidates.find((candidate: CatalogAssetCandidate) => candidate.kind === 'backdrop');

    return {
      primary: primaryVisual || secondaryVisual || fallbackVisual,
      poster: primary?.poster || secondary?.poster,
      backdrop: primary?.backdrop || secondary?.backdrop,
      channelLogo: primary?.channelLogo || secondary?.channelLogo,
      platformLogo: primary?.platformLogo || secondary?.platformLogo,
      candidates,
      fallbackChain: candidates,
    };
  }

  private buildAiringAssets(program: any, channelLogo?: string): any {
    const sourceCandidates = Array.isArray(program.sourceAssetCandidates)
      ? program.sourceAssetCandidates
      : [];
    const normalizedCandidates: CatalogAssetCandidate[] = sourceCandidates
      .filter(
        (candidate: Record<string, unknown>) =>
          typeof candidate?.url === 'string' && candidate.url.trim()
      )
      .map((candidate: Record<string, unknown>) => ({
        kind: this.normalizeAssetKind(candidate.kind),
        role:
          candidate?.role === 'primary' ||
          candidate?.role === 'fallback'
            ? candidate.role
            : 'fallback',
        source: this.normalizeAssetSource(candidate?.source),
        url: String(candidate.url),
      }))
      .filter((candidate: CatalogAssetCandidate) => {
        if (!channelLogo) return true;
        if (candidate.kind !== 'poster' && candidate.kind !== 'backdrop') return true;
        return candidate.url !== channelLogo;
      });

    if (program.image && program.image !== channelLogo) {
      normalizedCandidates.unshift({
        kind: 'poster',
        role: 'primary',
        source:
          normalizedCandidates.find((candidate: CatalogAssetCandidate) => candidate.url === program.image)?.source ||
          (program.tmdbId ? 'tmdb_poster' : 'epg_program_image'),
        url: program.image,
      });
    }

    if (channelLogo) {
      normalizedCandidates.push({
        kind: 'channelLogo',
        role: 'fallback',
        source: 'channel_icon',
        url: channelLogo,
      });
    }

    const candidates = normalizedCandidates.filter(
      (candidate: CatalogAssetCandidate, index: number, entries: CatalogAssetCandidate[]) =>
        index ===
        entries.findIndex(
          (entry: CatalogAssetCandidate) =>
            entry.kind === candidate.kind &&
            entry.source === candidate.source &&
            entry.url === candidate.url
        )
    );
    candidates.sort(
      (left: CatalogAssetCandidate, right: CatalogAssetCandidate) =>
        this.getAssetPriority(left) - this.getAssetPriority(right)
    );

    const findCandidate = (kind: string) =>
      candidates.find((candidate: CatalogAssetCandidate) => candidate.kind === kind);
    const primaryVisual =
      candidates.find((candidate: CatalogAssetCandidate) => candidate.kind === 'poster') ||
      candidates.find((candidate: CatalogAssetCandidate) => candidate.kind === 'backdrop');

    return {
      primary: primaryVisual,
      poster: findCandidate('poster'),
      backdrop: findCandidate('backdrop'),
      channelLogo: findCandidate('channelLogo'),
      platformLogo: findCandidate('platformLogo'),
      candidates,
      fallbackChain: candidates,
    };
  }

  private normalizeAssetKind(kind: unknown): 'poster' | 'backdrop' | 'channelLogo' | 'platformLogo' {
    const normalized = normalizeTvToken(String(kind || ''), '_');
    if (normalized === 'backdrop') return 'backdrop';
    if (normalized === 'channel_logo' || normalized === 'channellogo') return 'channelLogo';
    if (normalized === 'platform_logo' || normalized === 'platformlogo') return 'platformLogo';
    return 'poster';
  }

  private normalizeAssetSource(
    source: unknown
  ): CatalogAssetCandidate['source'] {
    const normalized = normalizeTvToken(String(source || ''), '_');
    if (normalized === 'tmdb_poster') return 'tmdb_poster';
    if (normalized === 'tmdb_backdrop') return 'tmdb_backdrop';
    if (normalized === 'channel_icon') return 'channel_icon';
    if (normalized === 'platform_logo') return 'platform_logo';
    return 'epg_program_image';
  }

  private getAssetPriority(candidate: CatalogAssetCandidate): number {
    const source = String(candidate?.source || '');
    const kind = String(candidate?.kind || '');
    if (source === 'epg_program_image' && kind === 'poster') return 0;
    if (source === 'epg_program_image' && kind === 'backdrop') return 1;
    if (source === 'tmdb_poster') return 2;
    if (source === 'tmdb_backdrop') return 3;
    if (kind === 'poster') return 4;
    if (kind === 'backdrop') return 5;
    if (kind === 'channelLogo') return 6;
    return 7;
  }

  private hasVisualProgramAsset(assets: any): boolean {
    return Boolean(
      assets?.poster?.url ||
        assets?.backdrop?.url ||
        assets?.primary?.kind === 'poster' ||
        assets?.primary?.kind === 'backdrop'
    );
  }

  private buildTitleResolutionMap(
    entries: ResolvedProgramEntry[]
  ): Map<string, ProgramTitleResolution> {
    const resolutions = new Map<string, ProgramTitleResolution>();
    const entriesByChannel = new Map<string, ResolvedProgramEntry[]>();

    entries.forEach((entry) => {
      const list = entriesByChannel.get(entry.resolvedChannelId) || [];
      list.push(entry);
      entriesByChannel.set(entry.resolvedChannelId, list);
    });

    entries.forEach((entry) => {
      const isGenericMovie = isGenericMovieTitle(entry.program.title);
      resolutions.set(entry.program.id, {
        state: isGenericMovie ? 'generic_unresolved' : 'specific_source_title',
        isResolvedTitle: !isGenericMovie,
        consumerSuppressed: false,
      });
    });

    entries.forEach((entry) => {
      if (entry.channelGroup !== 'tdt' || !isGenericMovieTitle(entry.program.title)) {
        return;
      }

      const channelEntries = entriesByChannel.get(entry.resolvedChannelId) || [];
      const specificCandidate = this.findSpecificMovieOverrideCandidate(entry, channelEntries);
      if (specificCandidate) {
        resolutions.set(entry.program.id, {
          state: 'generic_suppressed',
          isResolvedTitle: false,
          consumerSuppressed: true,
          suppressionReason: 'generic_replaced_by_specific_source',
          winnerProgramId: specificCandidate.program.id,
          winnerSourceFeed: specificCandidate.program.sourceFeed,
        });
        return;
      }

      resolutions.set(entry.program.id, {
        state: 'generic_unresolved',
        isResolvedTitle: false,
        consumerSuppressed: true,
        suppressionReason: 'generic_unresolved',
      });
    });

    return resolutions;
  }

  private findSpecificMovieOverrideCandidate(
    target: ResolvedProgramEntry,
    candidates: ResolvedProgramEntry[]
  ): ResolvedProgramEntry | undefined {
    return candidates
      .filter((candidate) => candidate.program.id !== target.program.id)
      .filter((candidate) =>
        this.isSameProgrammeSlot(target.program, candidate.program)
      )
      .filter((candidate) => this.isSpecificMovieResolutionCandidate(candidate.program))
      .sort((left, right) => this.rankSpecificMovieCandidate(right) - this.rankSpecificMovieCandidate(left))[0];
  }

  private isSameProgrammeSlot(left: any, right: any): boolean {
    const leftStart = new Date(left.startTime).getTime();
    const leftEnd = new Date(left.endTime).getTime();
    const rightStart = new Date(right.startTime).getTime();
    const rightEnd = new Date(right.endTime).getTime();

    if (
      Number.isNaN(leftStart) ||
      Number.isNaN(leftEnd) ||
      Number.isNaN(rightStart) ||
      Number.isNaN(rightEnd)
    ) {
      return false;
    }

    const startDelta = Math.abs(leftStart - rightStart);
    const endDelta = Math.abs(leftEnd - rightEnd);
    const overlaps = leftStart < rightEnd && leftEnd > rightStart;
    const overlapDuration = overlaps
      ? Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart)
      : 0;
    const shorterDuration = Math.max(
      1,
      Math.min(leftEnd - leftStart, rightEnd - rightStart)
    );

    return (
      (startDelta <= 45 * 60_000 && endDelta <= 45 * 60_000) ||
      overlapDuration / shorterDuration >= 0.6
    );
  }

  private isSpecificMovieResolutionCandidate(program: any): boolean {
    if (isGenericMovieTitle(program.title)) {
      return false;
    }

    if (normalizeTvToken(program?.trustFlags?.tmdbKind, ' ') === 'movie') {
      return true;
    }

    const inferredCategory = this.resolveEditorialCategory(program);
    if (inferredCategory === 'Cine') {
      return true;
    }

    const duration = Number(program.duration || program.durationMinutes || 0);
    return duration >= 70;
  }

  private rankSpecificMovieCandidate(candidate: ResolvedProgramEntry): number {
    const sourceFeed = String(candidate.program?.sourceFeed || '');
    const hasPoster = Boolean(
      candidate.program?.image ||
        (Array.isArray(candidate.program?.sourceAssetCandidates) &&
          candidate.program.sourceAssetCandidates.some(
            (asset: Record<string, unknown>) =>
              String(asset?.kind || '').toLowerCase() !== 'channellogo' &&
              typeof asset?.url === 'string' &&
              asset.url
          ))
    );
    return (
      (isTdtChannelsSourceUrl(sourceFeed) ? 100 : 0) +
      (hasPoster ? 20 : 0) +
      (candidate.program?.tmdbId ? 10 : 0)
    );
  }

  private buildCanonicalChannelMaps(channels: any[]): {
    canonicalChannelById: Map<string, any>;
    channelByAlias: Map<string, any>;
  } {
    const canonicalChannelById = new Map<string, any>();
    const channelByAlias = new Map<string, any>();

    channels.forEach((channel: any) => {
      const metadata = buildChannelIdentityMetadata({
        name: channel.name,
        sourceId:
          Array.isArray(channel?.sourceIds) && channel.sourceIds.length
            ? channel.sourceIds[0]
            : channel.id,
        country: channel.country,
        countryCode: channel.countryCode,
        region: channel.region,
      });
      const canonicalId = metadata.canonicalId || String(channel.id);
      const normalizedDoc = {
        ...channel,
        id: canonicalId,
        normalizedName: channel.normalizedName || metadata.normalizedName,
        aliases: Array.from(new Set([...(channel.aliases || []), ...metadata.aliases])),
        sourceIds: Array.from(new Set([...(channel.sourceIds || []), ...metadata.sourceIds])),
        type:
          metadata.inferredGroup === 'tdt' || metadata.inferredGroup === 'autonomico'
            ? metadata.inferredType
            : channel.type || metadata.inferredType,
        order:
          metadata.inferredGroup === 'tdt' && Number(channel.order ?? 999) >= 500
            ? metadata.sortOrder
            : Number(channel.order ?? metadata.sortOrder ?? 999),
      };

      canonicalChannelById.set(
        canonicalId,
        this.pickPreferredChannelDoc(canonicalChannelById.get(canonicalId), normalizedDoc)
      );
    });

    channels.forEach((channel: any) => {
      const metadata = buildChannelIdentityMetadata({
        name: channel.name,
        sourceId:
          Array.isArray(channel?.sourceIds) && channel.sourceIds.length
            ? channel.sourceIds[0]
            : channel.id,
        country: channel.country,
        countryCode: channel.countryCode,
        region: channel.region,
      });
      const canonicalId = metadata.canonicalId || String(channel.id);
      const canonicalChannel = canonicalChannelById.get(canonicalId);
      if (!canonicalChannel) {
        return;
      }

      [
        channel.id,
        channel.name,
        channel.normalizedName,
        ...(channel.aliases || []),
        ...(channel.sourceIds || []),
        ...metadata.aliases,
        ...metadata.sourceIds,
      ]
        .map((value) => normalizeTvToken(value))
        .filter(Boolean)
        .forEach((alias) => {
          channelByAlias.set(alias, canonicalChannel);
        });
    });

    canonicalChannelById.forEach((channel, canonicalId) => {
      [
        canonicalId,
        channel.id,
        channel.name,
        channel.normalizedName,
        ...(channel.aliases || []),
        ...(channel.sourceIds || []),
      ]
        .map((value) => normalizeTvToken(value))
        .filter(Boolean)
        .forEach((alias) => {
          channelByAlias.set(alias, channel);
        });
    });

    return { canonicalChannelById, channelByAlias };
  }

  private pickPreferredChannelDoc(current: any, candidate: any): any {
    if (!current) {
      return candidate;
    }
    const mergeChannelVariants = (preferred: any) => ({
      ...preferred,
      aliases: Array.from(
        new Set([...(current.aliases || []), ...(candidate.aliases || [])])
      ),
      sourceIds: Array.from(
        new Set([...(current.sourceIds || []), ...(candidate.sourceIds || [])])
      ),
    });
    const currentCanonical = buildChannelIdentityMetadata({
      name: current.name,
      sourceId: current.id,
      country: current.country,
      countryCode: current.countryCode,
      region: current.region,
    }).canonicalId;
    const candidateCanonical = buildChannelIdentityMetadata({
      name: candidate.name,
      sourceId: candidate.id,
      country: candidate.country,
      countryCode: candidate.countryCode,
      region: candidate.region,
    }).canonicalId;

    const currentIsCanonical = String(current.id) === currentCanonical;
    const candidateIsCanonical = String(candidate.id) === candidateCanonical;
    if (currentIsCanonical !== candidateIsCanonical) {
      return mergeChannelVariants(candidateIsCanonical ? candidate : current);
    }
    if (Boolean(current.logo) !== Boolean(candidate.logo)) {
      return mergeChannelVariants(candidate.logo ? candidate : current);
    }
    const currentOrder = Number(current.order ?? 999);
    const candidateOrder = Number(candidate.order ?? 999);
    if (currentOrder !== candidateOrder) {
      return mergeChannelVariants(candidateOrder < currentOrder ? candidate : current);
    }
    const preferred =
      (candidate.aliases || []).length > (current.aliases || []).length
        ? candidate
        : current;
    return mergeChannelVariants(preferred);
  }

  private resolveChannelDocument(
    identifiers: Array<string | undefined | null>,
    canonicalChannelById: Map<string, any>,
    channelByAlias: Map<string, any>,
    channelById: Map<string, any>
  ): any | null {
    for (const identifier of identifiers) {
      const raw = String(identifier || '').trim();
      if (!raw) {
        continue;
      }

      const normalized = normalizeTvToken(raw);
      const resolvedByAlias =
        channelByAlias.get(normalized) ||
        channelByAlias.get(normalizeTvToken(raw, ' '));
      if (resolvedByAlias) {
        return resolvedByAlias;
      }

      const resolvedCanonical = canonicalChannelById.get(raw);
      if (resolvedCanonical) {
        return resolvedCanonical;
      }

      const legacyDoc = channelById.get(raw);
      if (legacyDoc) {
        const legacyResolved =
          channelByAlias.get(normalizeTvToken(legacyDoc.id)) ||
          channelByAlias.get(normalizeTvToken(legacyDoc.name)) ||
          legacyDoc;
        if (legacyResolved) {
          return legacyResolved;
        }
      }
    }

    return null;
  }

  private resolveEditorialCategory(program: any): string {
    const inferred = inferEditorialCategory(
      program.genre,
      program.title,
      program.description
    );
    if (inferred !== 'Otros') {
      return inferred;
    }

    const tmdbKind = normalizeTvToken(program?.trustFlags?.tmdbKind, ' ');
    if (tmdbKind === 'movie') {
      return 'Cine';
    }
    if (tmdbKind === 'series' || tmdbKind === 'tv') {
      return 'Series';
    }

    const epgMovieSignal = normalizeTvToken(
      [program.genre, program.description].filter(Boolean).join(' '),
      ' '
    );
    if (/(^| )(cine|pelicula|película|film|western|thriller|comedia|drama|accion|acción|terror|aventura)( |$)/.test(epgMovieSignal)) {
      return 'Cine';
    }

    return inferred;
  }

  private buildTrustDecision(
    program: any,
    assets: any,
    primarySourceUrl: string,
    isSuspiciousGroup: boolean,
    confirmedChannels: Set<string> | undefined,
    resolvedChannelId: string,
    titleResolution: ProgramTitleResolution
  ) {
    const sourceSchedule = Array.from(
      new Set([
        ...(((program.sourceProvenance as any)?.schedule || []) as string[]),
        ...(program.sourceFeed ? [program.sourceFeed] : []),
      ])
    ).filter(Boolean);
    const hasSecondarySignal = sourceSchedule.some((source) => source !== primarySourceUrl);
    const hasPoster = this.hasVisualProgramAsset(assets);
    const isGenericTitle = ProgramDeduplicator.isGenericTitle(String(program.title || ''));
    const confirmed =
      !confirmedChannels?.size || this.isConfirmedChannel(resolvedChannelId, confirmedChannels);
    const consumerSuppressed = Boolean(titleResolution.consumerSuppressed);
    const suppressionReason =
      titleResolution.suppressionReason ||
      (consumerSuppressed ? 'generic_unresolved' : undefined);
    const featuredSuppressed =
      consumerSuppressed ||
      (isSuspiciousGroup && confirmedChannels?.size && !confirmed) ||
      (isGenericTitle && !hasSecondarySignal && !hasPoster);
    const confidence =
      featuredSuppressed ? 'low' : hasPoster || hasSecondarySignal ? 'high' : isGenericTitle ? 'low' : 'medium';
    const sourceAgreement =
      sourceSchedule.length > 1
        ? 'merged'
        : sourceSchedule[0] === primarySourceUrl
          ? 'primary_only'
          : sourceSchedule.length === 1
            ? 'secondary_only'
            : 'single_source';

    return {
      confidence,
      sourceAgreement,
      featuredSuppressed,
      consumerSuppressed,
      suppressionReason,
      reasons: [
        ...(isSuspiciousGroup ? ['fanout_checked'] : []),
        ...(isGenericTitle ? ['generic_title'] : []),
        ...(hasPoster ? ['has_visual_asset'] : ['missing_visual_asset']),
        ...(hasSecondarySignal ? ['secondary_confirmed'] : []),
        ...(titleResolution.state === 'generic_suppressed' ? ['generic_replaced_by_specific_source'] : []),
        ...(titleResolution.state === 'generic_unresolved' ? ['generic_unresolved'] : []),
        ...(featuredSuppressed ? ['featured_suppressed'] : []),
      ],
    } as const;
  }

  private mergeTrustDecisions(primary: any, secondary: any, mergedAssets: any) {
    const reasons = Array.from(
      new Set([...(primary?.reasons || []), ...(secondary?.reasons || [])])
    );
    const featuredSuppressed = Boolean(primary?.featuredSuppressed && secondary?.featuredSuppressed);
    const confidenceRank = { low: 1, medium: 2, high: 3 } as const;
    const primaryConfidence = primary?.confidence || 'low';
    const secondaryConfidence = secondary?.confidence || 'low';
    const sourceAgreement =
      primary?.sourceAgreement === 'merged' || secondary?.sourceAgreement === 'merged'
        ? 'merged'
        : primary?.sourceAgreement || secondary?.sourceAgreement || 'single_source';

    const strongest =
      confidenceRank[primaryConfidence as keyof typeof confidenceRank] >=
      confidenceRank[secondaryConfidence as keyof typeof confidenceRank]
        ? primaryConfidence
        : secondaryConfidence;

    return {
      confidence:
        !featuredSuppressed && this.hasVisualProgramAsset(mergedAssets) && strongest === 'low'
          ? 'medium'
          : strongest,
      sourceAgreement,
      featuredSuppressed,
      consumerSuppressed:
        Boolean(primary?.consumerSuppressed) || Boolean(secondary?.consumerSuppressed),
      suppressionReason:
        primary?.suppressionReason || secondary?.suppressionReason,
      reasons,
    };
  }

  private buildSuspiciousProgrammeGroups(programs: any[]): Set<string> {
    const grouped = new Map<string, any[]>();
    programs.forEach((program) => {
      const key = this.buildProgrammeGroupKey(program.startTime, program.title);
      const current = grouped.get(key) || [];
      current.push(program);
      grouped.set(key, current);
    });

    return new Set(
      Array.from(grouped.entries())
        .filter(([, group]) => {
          if (group.length < 8) {
            return false;
          }
          const poorMetadata = group.filter(
            (program) =>
              !program.image &&
              !program.description &&
              !program.genre &&
              (!Array.isArray(program.sourceAssetCandidates) ||
                program.sourceAssetCandidates.length === 0)
          ).length;
          return poorMetadata / group.length >= 0.8;
        })
        .map(([key]) => key)
    );
  }

  private buildSecondaryConfirmationMap(
    snapshots: any[],
    channelByAlias: Map<string, any>
  ): Map<string, Set<string>> {
    const primarySourceUrl = getPrimaryEpgSourceUrl();
    const confirmations = new Map<string, Set<string>>();

    snapshots
      .filter((snapshot) => snapshot?.sourceUrl && snapshot.sourceUrl !== primarySourceUrl)
      .forEach((snapshot) => {
        const snapshotChannelMap = new Map<string, string>();
        (snapshot.channels || []).forEach((channel: any) => {
          const identity = buildChannelIdentityMetadata({
            name: channel.displayName,
            sourceId: channel.id,
            country: channel.country,
            countryCode: channel.countryCode,
          });
          const aliases = [
            channel.id,
            channel.displayName,
            ...identity.aliases,
            ...identity.sourceIds,
          ]
            .map((value) => normalizeTvToken(value))
            .filter(Boolean);
          const resolvedChannel =
            aliases
              .map((alias) => channelByAlias.get(alias))
              .find(Boolean) || null;
          if (!resolvedChannel) {
            return;
          }
          aliases.forEach((alias) => {
            snapshotChannelMap.set(alias, resolvedChannel.id);
          });
        });

        (snapshot.programmes || []).forEach((programme: any) => {
          const start = new Date(String(programme.start || '').replace(' ', 'T'));
          const parsedStart = Number.isNaN(start.getTime())
            ? this.parseSnapshotDate(programme.start)
            : start;
          if (!parsedStart || Number.isNaN(parsedStart.getTime())) {
            return;
          }

          const programmeChannelAliases = [
            programme.channelId,
            normalizeTvToken(programme.channelId),
          ]
            .map((value) => normalizeTvToken(value))
            .filter(Boolean);
          const canonicalChannelId =
            programmeChannelAliases
              .map((alias) => snapshotChannelMap.get(alias))
              .find(Boolean) || null;
          if (!canonicalChannelId) {
            return;
          }

          const key = this.buildProgrammeGroupKey(parsedStart, programme.title);
          const current = confirmations.get(key) || new Set<string>();
          current.add(canonicalChannelId);
          confirmations.set(key, current);
        });
      });

    return confirmations;
  }

  private buildCrossSourceConfirmationMap(
    programs: any[],
    primarySourceUrl: string,
    canonicalChannelById: Map<string, any>,
    channelByAlias: Map<string, any>,
    channelById: Map<string, any>
  ): Map<string, Set<string>> {
    const grouped = new Map<string, any[]>();
    programs.forEach((program) => {
      const key = this.buildProgrammeGroupKey(program.startTime, program.title);
      const current = grouped.get(key) || [];
      current.push(program);
      grouped.set(key, current);
    });

    const confirmations = new Map<string, Set<string>>();
    grouped.forEach((group, key) => {
      const confirmedChannels = new Set<string>(
        group
          .filter(
            (program) =>
              program.sourceFeed &&
              program.sourceFeed !== primarySourceUrl &&
              (program.canonicalChannelId || program.channelId)
          )
          .map((program) =>
            this.resolveChannelDocument(
              [program.canonicalChannelId, program.channelId],
              canonicalChannelById,
              channelByAlias,
              channelById
            )?.id ||
            program.canonicalChannelId ||
            program.channelId
          )
      );
      if (confirmedChannels.size) {
        confirmations.set(key, confirmedChannels);
      }
    });

    return confirmations;
  }

  private buildProgrammeGroupKey(
    startTime: Date,
    title: string
  ): string {
    return `${startTime.toISOString().slice(0, 16)}|${buildProgramBrandKey(title)}`;
  }

  private isConfirmedChannel(
    channelId: string,
    confirmedChannels: Set<string>
  ): boolean {
    if (confirmedChannels.has(channelId)) {
      return true;
    }

    const hasRtveConfirmation = Array.from(confirmedChannels).some(
      (confirmedChannelId) =>
        confirmedChannelId.startsWith('la_1') ||
        confirmedChannelId.startsWith('la_2') ||
        confirmedChannelId.startsWith('tve_')
    );

    if (
      hasRtveConfirmation &&
      (channelId.startsWith('la_1') ||
        channelId.startsWith('la_2') ||
        channelId.startsWith('tve_'))
    ) {
      return true;
    }

    return false;
  }

  private parseSnapshotDate(value: unknown): Date | null {
    const raw = String(value || '').trim();
    const match = raw.match(
      /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?$/
    );
    if (!match) {
      return null;
    }
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);
    const baseUtcMillis = Date.UTC(year, month, day, hour, minute, second);
    if (!match[7]) {
      return new Date(baseUtcMillis);
    }
    const sign = match[7] === '+' ? 1 : -1;
    const offsetMinutes = sign * (Number(match[8]) * 60 + Number(match[9]));
    return new Date(baseUtcMillis - offsetMinutes * 60_000);
  }
}
