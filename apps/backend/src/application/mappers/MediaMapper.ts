import { cleanEpgDescription } from '../../shared/utils/epgDescription';
import { Program } from '@/domain/entities/Program';
import { Channel } from '@/domain/entities/Channel';
import {
  MediaCardDTO,
  MediaDetailDTO,
  MediaType,
} from '../dto/MediaDTO';
import { ProgramLayoutDTO } from '../services/ProgramLayoutBuilder';

/**
 * Minimal channel information required to render media cards.
 */
type ChannelMeta = {
  id: string;
  name: string;
  type?: string;
  icon?: string | null;
};

type ChannelLike = Channel | ChannelMeta | null | undefined;

/**
 * Normalized input contract used by the card builder.
 */
interface CardSource {
  id: string;
  title: string;
  startIso: string;
  endIso?: string;
  category?: string;
  image?: string;
  rating?: any;
  description?: string;
  channel?: ChannelLike;
  type?: MediaType;
  badges?: string[];
  now?: Date;
}

/**
 * Utilities to translate domain/program data into discovery-friendly DTOs.
 */
export class MediaMapper {
  /**
   * Builds a media card from a pre-computed program layout item.
   */
  static fromProgramLayout(
    program: ProgramLayoutDTO,
    channelLookup: Map<string, ChannelMeta>,
    now: Date = new Date()
  ): MediaCardDTO {
    const channel = channelLookup.get(program.channelId);
    return this.buildCard({
      id: program.id,
      title: program.title,
      startIso: program.start,
      endIso: program.end,
      category: program.category,
      image: program.image,
      rating: program.rating,
      description: program.description,
      channel,
      type: 'program',
      now,
    });
  }

  /**
   * Builds a media card directly from a domain program.
   */
  static fromProgram(
    program: Program,
    channel: ChannelLike,
    options: { now?: Date } = {}
  ): MediaCardDTO {
    return this.buildCard({
      id: program.id,
      title: program.title,
      startIso: program.startTime.toISOString(),
      endIso: program.endTime.toISOString(),
      category: program.genre,
      image: program.image,
      rating: (program as any).rating,
      description: program.description,
      channel,
      type: 'program',
      now: options.now,
    });
  }

  /**
   * Builds a fully enriched detail DTO with related content and schedule.
   */
  static toDetail(
    program: Program,
    channel: ChannelLike,
    related?: MediaCardDTO[],
    schedule?: MediaCardDTO[],
    options?: {
      vodProviders?: Array<{ provider: string; link?: string; price?: string }>;
      socialMetrics?: {
        friendsRating?: number | null;
        topReview?: { user: string; text: string } | null;
        ratingCount?: number;
        average?: number;
      };
    }
  ): MediaDetailDTO {
    const base = this.fromProgram(program, channel);
    const normalizedChannel = this.normalizeChannel(channel);
    const normalizedRating = this.normalizeRating((program as any).rating);
    const vod = options?.vodProviders?.filter((p) => p?.provider);

    const whereToWatch = [
      ...(vod || []),
      ...(normalizedChannel.name
        ? [
            {
              provider: normalizedChannel.name,
              link: undefined,
              price:
                normalizedChannel.type &&
                normalizedChannel.type.toLowerCase().includes('ott')
                  ? 'streaming'
                  : 'linear',
            },
          ]
        : []),
    ];

    const dedupedWhereToWatch = this.dedupeProviders(whereToWatch);
    return {
      ...base,
      synopsis: cleanEpgDescription(program.description),
      whereToWatch: dedupedWhereToWatch.length ? dedupedWhereToWatch : undefined,
      socialSummary: {
        friendsRating:
          options?.socialMetrics?.friendsRating ??
          options?.socialMetrics?.average ??
          normalizedRating?.average ??
          null,
        topReview: options?.socialMetrics?.topReview ?? null,
      },
      related,
      schedule,
      ratings: normalizedRating,
    };
  }

  private static buildCard(source: CardSource): MediaCardDTO {
    const channel = this.normalizeChannel(source.channel);
    const subtitle = this.buildSubtitle(
      source.startIso,
      source.endIso,
      channel.name,
      source.category
    );

    const schedule = this.buildScheduleContext(
      source.startIso,
      source.endIso,
      channel.name,
      channel.id,
      source.now
    );

    const rating = this.normalizeRating(source.rating);
    const badges = this.buildBadges(source.badges, channel.type, source.category);

    return {
      id: source.id,
      type: source.type ?? 'program',
      title: source.title,
      subtitle,
      image: source.image
        ? { url: source.image, aspectRatio: 0.67 }
        : undefined,
      badges,
      rating,
      context: schedule
        ? {
            schedule,
            userInteraction: {
              inWatchlist: false,
              seen: false,
              liked: false,
            },
          }
        : undefined,
    };
  }

  private static buildSubtitle(
    startIso?: string,
    endIso?: string,
    channelName?: string,
    category?: string
  ): string | undefined {
    const parts: string[] = [];
    const start = this.formatTime(startIso);
    const end = this.formatTime(endIso);

    if (start && end) {
      parts.push(`${start}-${end}`);
    } else if (start) {
      parts.push(start);
    }

    if (channelName) {
      parts.push(channelName);
    }

    if (category) {
      parts.push(category);
    }

    if (!parts.length) {
      return undefined;
    }

    return parts.join(' • ');
  }

  private static buildScheduleContext(
    startIso?: string,
    endIso?: string,
    channelName?: string,
    channelId?: string,
    now: Date = new Date()
  ) {
    if (!startIso) return undefined;

    const start = new Date(startIso);
    const end = endIso ? new Date(endIso) : undefined;
    const nowMs = now.getTime();

    let live = false;
    let progressPercent: number | undefined;
    if (end) {
      const total = end.getTime() - start.getTime();
      if (total > 0) {
        live = nowMs >= start.getTime() && nowMs < end.getTime();
        if (live) {
          progressPercent = Math.min(
            100,
            Math.max(0, Math.round(((nowMs - start.getTime()) / total) * 100))
          );
        }
      }
    }

    return {
      channel: channelName ?? 'TV',
      channelId,
      start: start.toISOString(),
      end: end?.toISOString(),
      live: live || undefined,
      progressPercent,
    };
  }

  private static normalizeChannel(channel: ChannelLike): {
    id?: string;
    name?: string;
    type?: string;
  } {
    if (!channel) return {};
    const asAny = channel as any;
    return {
      id: asAny.id,
      name: asAny.name,
      type: (asAny.type || (asAny.props && asAny.props.type)) as string | undefined,
    };
  }

  private static buildBadges(
    provided: string[] | undefined,
    channelType?: string,
    category?: string
  ): string[] | undefined {
    const badges = new Set<string>();
    (provided || []).forEach((b) => b && badges.add(b));
    if (channelType) badges.add(channelType);
    if (category) badges.add(category);
    if (!badges.size) return undefined;
    return Array.from(badges);
  }

  private static formatTime(iso?: string): string | undefined {
    if (!iso) return undefined;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return undefined;
    return date.toLocaleTimeString('es-ES', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  private static normalizeRating(raw: any) {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw === 'number') return { average: raw };
    if (typeof raw === 'string') {
      const parsed = Number(raw);
      if (!Number.isNaN(parsed)) return { average: parsed };
      return { average: undefined, count: undefined };
    }
    if (typeof raw === 'object') {
      const average = (raw as any).average ?? (raw as any).value;
      const count = (raw as any).count ?? (raw as any).votes;
      return {
        average:
          typeof average === 'number'
            ? average
            : typeof average === 'string' && !Number.isNaN(Number(average))
              ? Number(average)
              : undefined,
        count:
          typeof count === 'number'
            ? count
            : typeof count === 'string' && !Number.isNaN(Number(count))
              ? Number(count)
              : undefined,
      };
    }
    return undefined;
  }

  private static dedupeProviders(
    providers: Array<{ provider: string; link?: string; price?: string }>
  ) {
    const seen = new Set<string>();
    const result: Array<{ provider: string; link?: string; price?: string }> = [];
    providers.forEach((p) => {
      if (!p?.provider) return;
      const key = p.provider.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      result.push(p);
    });
    return result;
  }
}
