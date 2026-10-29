import { Request, Response } from 'express';
import { successResponse } from '@/shared/types/ApiResponse';
import {
  normalizeTvReadView,
  TvReadQueryService,
} from '@/application/services/TvReadQueryService';
import { TvSurfaceService } from '@/application/services/TvSurfaceService';
import type { ChannelFeedAliasResolver } from '@/application/services/ChannelFeedAliases';

export class TvController {
  constructor(
    private readonly tvReadQueryService: TvReadQueryService,
    private readonly tvSurfaceService: TvSurfaceService,
    /** M10-C: lists never show a verified second feed of a channel (it repeats that channel and its page is a 301). */
    private readonly channelFeedAliases?: Pick<ChannelFeedAliasResolver, 'current'>
  ) {}

  /** Never waits nor fails a request: without the alias list every channel is listed, as before M10-C. */
  private isAlias(): (channelId: string | undefined) => boolean {
    let aliases: Map<string, unknown>;
    try {
      aliases = this.channelFeedAliases?.current('today') ?? new Map();
    } catch {
      aliases = new Map();
    }
    return (channelId) => Boolean(channelId && aliases.has(channelId));
  }

  async read(req: Request, res: Response): Promise<void> {
    const result = await this.tvReadQueryService.query({
      view: normalizeTvReadView(req.query.view),
      date: req.query.date ? String(req.query.date) : undefined,
      group: req.query.group ? String(req.query.group) : undefined,
      category: req.query.category ? String(req.query.category) : undefined,
      sport: req.query.sport ? String(req.query.sport) : undefined,
      channelId: req.query.channelId ? String(req.query.channelId) : undefined,
      q: req.query.q ? String(req.query.q) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      cursor: req.query.cursor ? String(req.query.cursor) : undefined,
      includeChannels: String(req.query.includeChannels || 'true') !== 'false',
    });
    // An explicit channel filter is a request for that channel's own rows: kept.
    const alias = req.query.channelId ? () => false : this.isAlias();
    const shown = {
      ...result,
      items: result.items.filter((item) => !alias(item.channel?.id)),
      channels: (result.channels || []).filter((entry) => !alias(entry.channel?.id)),
    };

    res.status(200).json(successResponse(shown, result.meta));
  }

  async readChannels(req: Request, res: Response): Promise<void> {
    const date = req.query.date ? String(req.query.date) : 'today';
    const group = req.query.group ? String(req.query.group) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const result = await this.tvReadQueryService.getChannels(date, group, limit);
    const alias = this.isAlias();
    const shown = { ...result, channels: result.channels.filter((entry) => !alias(entry.channel?.id)) };
    res.status(200).json(successResponse(shown, result.meta));
  }

  async readSchedule(req: Request, res: Response): Promise<void> {
    const result = await this.tvReadQueryService.getSchedule({
      date: req.query.date ? String(req.query.date) : 'today',
      group: req.query.group ? String(req.query.group) : undefined,
      category: req.query.category ? String(req.query.category) : undefined,
      channelId: req.query.channelId ? String(req.query.channelId) : undefined,
      q: req.query.q ? String(req.query.q) : undefined,
      itemsPerChannel: req.query.itemsPerChannel
        ? Number(req.query.itemsPerChannel)
        : undefined,
    });
    const alias = req.query.channelId ? () => false : this.isAlias();
    const shown = { ...result, channels: result.channels.filter((entry) => !alias(entry.channel?.id)) };
    res.status(200).json(successResponse(shown, result.meta));
  }

  async readChannelDetail(req: Request, res: Response): Promise<void> {
    const result = await this.tvReadQueryService.getChannelDetail(
      String(req.params.channelId),
      req.query.date ? String(req.query.date) : 'today',
      normalizeTvReadView(req.query.view)
    );
    res.status(200).json(successResponse(result, result.meta));
  }

  async readItem(req: Request, res: Response): Promise<void> {
    const result = await this.tvReadQueryService.getItem(String(req.params.airingId));
    res.status(200).json(successResponse(result, result.meta));
  }

  async guideSurface(req: Request, res: Response): Promise<void> {
    const result = await this.tvSurfaceService.getGuideSurface({
      date: req.query.date ? String(req.query.date) : undefined,
      group: req.query.group ? String(req.query.group) : undefined,
      category: req.query.category ? String(req.query.category) : undefined,
      sport: req.query.sport ? String(req.query.sport) : undefined,
    });

    res.status(200).json(successResponse(result, result.meta));
  }

  async channelSurface(req: Request, res: Response): Promise<void> {
    const result = await this.tvSurfaceService.getChannelSurface(
      String(req.params.channelId),
      req.query.date ? String(req.query.date) : undefined
    );

    res.status(200).json(successResponse(result, result.meta));
  }
}
