import { UserAssistantConversationModel } from '@/infrastructure/database/models/UserAssistantConversation.model';
import { UserAssistantMemoryModel } from '@/infrastructure/database/models/UserAssistantMemory.model';
import { UserModel } from '@/infrastructure/database/models/User.model';
import { ICacheRepository } from '@/domain/repositories/ICacheRepository';

export interface AIAnalyticsOverview {
  totalConversations: number;
  totalMessages: number;
  activeUsersToday: number;
  activeUsersWeek: number;
  avgMessagesPerConversation: number;
  topGenres: { genre: string; count: number }[];
  topPlatforms: { platform: string; count: number }[];
  subscriptionBreakdown: { free: number; premium: number };
  feedbackSummary: { positive: number; negative: number };
}

export interface AIAnalyticsTimeSeries {
  date: string;
  conversations: number;
  messages: number;
}

export interface AIConversationListItem {
  conversationId: string;
  userId: string;
  userEmail?: string;
  userName?: string;
  sessionTitle?: string;
  messageCount: number;
  feedbackPositive: number;
  feedbackNegative: number;
  pinned: boolean;
  archived: boolean;
  lastUsedAt?: Date;
}

export interface AIConversationListResult {
  items: AIConversationListItem[];
  pagination: { total: number; page: number; limit: number; pages: number };
}

export interface AIConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt?: Date;
  feedback?: 'positive' | 'negative';
}

export interface AIConversationDetail extends AIConversationListItem {
  messages: AIConversationMessage[];
}

export class AIAnalyticsService {
  constructor(private readonly cacheRepository: ICacheRepository) {}

  async getOverview(): Promise<AIAnalyticsOverview> {
    const cacheKey = 'ai:analytics:overview';
    try {
      const cached = await this.cacheRepository.get<string>(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch { /* miss */ }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart.getTime() - 7 * 86400000);

    const [
      totalConversations,
      messagePipeline,
      activeTodayCount,
      activeWeekCount,
      memoryAgg,
      feedbackAgg,
      subscriptionAgg,
    ] = await Promise.all([
      UserAssistantConversationModel.countDocuments(),
      UserAssistantConversationModel.aggregate([
        { $project: { msgCount: { $size: '$messages' } } },
        { $group: { _id: null, total: { $sum: '$msgCount' }, count: { $sum: 1 } } },
      ]),
      UserAssistantConversationModel.distinct('userId', {
        lastUsedAt: { $gte: todayStart },
      }).then((ids) => ids.length),
      UserAssistantConversationModel.distinct('userId', {
        lastUsedAt: { $gte: weekStart },
      }).then((ids) => ids.length),
      UserAssistantMemoryModel.aggregate([
        {
          $facet: {
            genres: [
              { $unwind: '$likedGenres' },
              { $group: { _id: '$likedGenres', count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: 10 },
            ],
            platforms: [
              { $unwind: '$preferredPlatforms' },
              { $group: { _id: '$preferredPlatforms', count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: 10 },
            ],
          },
        },
      ]),
      UserAssistantConversationModel.aggregate([
        { $unwind: '$messages' },
        { $match: { 'messages.feedback': { $exists: true } } },
        {
          $group: {
            _id: '$messages.feedback.rating',
            count: { $sum: 1 },
          },
        },
      ]),
      UserModel.aggregate([
        {
          $group: {
            _id: { $ifNull: ['$subscription', 'free'] },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const msgStats = messagePipeline[0] || { total: 0, count: 0 };
    const memFacets = memoryAgg[0] || { genres: [], platforms: [] };

    const feedbackMap: Record<string, number> = {};
    feedbackAgg.forEach((f: { _id: string; count: number }) => {
      feedbackMap[f._id] = f.count;
    });

    const subMap: Record<string, number> = {};
    subscriptionAgg.forEach((s: { _id: string; count: number }) => {
      subMap[s._id] = s.count;
    });

    const result: AIAnalyticsOverview = {
      totalConversations,
      totalMessages: msgStats.total,
      activeUsersToday: activeTodayCount,
      activeUsersWeek: activeWeekCount,
      avgMessagesPerConversation:
        msgStats.count > 0 ? Math.round((msgStats.total / msgStats.count) * 10) / 10 : 0,
      topGenres: memFacets.genres.map((g: { _id: string; count: number }) => ({
        genre: g._id,
        count: g.count,
      })),
      topPlatforms: memFacets.platforms.map((p: { _id: string; count: number }) => ({
        platform: p._id,
        count: p.count,
      })),
      subscriptionBreakdown: {
        free: subMap['free'] || 0,
        premium: subMap['premium'] || 0,
      },
      feedbackSummary: {
        positive: feedbackMap['positive'] || 0,
        negative: feedbackMap['negative'] || 0,
      },
    };

    this.cacheRepository.set(cacheKey, JSON.stringify(result), 120).catch(() => {});
    return result;
  }

  async getTimeSeries(days = 30): Promise<AIAnalyticsTimeSeries[]> {
    const cacheKey = `ai:analytics:timeseries:${days}`;
    try {
      const cached = await this.cacheRepository.get<string>(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch { /* miss */ }

    const since = new Date();
    since.setDate(since.getDate() - days);

    const pipeline = await UserAssistantConversationModel.aggregate([
      { $match: { lastUsedAt: { $gte: since } } },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$lastUsedAt' },
          },
          conversations: { $sum: 1 },
          messages: { $sum: { $size: '$messages' } },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const result = pipeline.map((row: { _id: string; conversations: number; messages: number }) => ({
      date: row._id,
      conversations: row.conversations,
      messages: row.messages,
    }));

    this.cacheRepository.set(cacheKey, JSON.stringify(result), 300).catch(() => {});
    return result;
  }

  async listConversations(
    page = 1,
    limit = 20,
    userId?: string,
    search?: string
  ): Promise<AIConversationListResult> {
    const filters: Record<string, unknown> = {};
    if (userId) filters.userId = userId;
    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filters.$or = [{ sessionTitle: regex }, { 'messages.content': regex }];
    }

    const skip = (page - 1) * limit;
    const [docs, total] = await Promise.all([
      UserAssistantConversationModel.find(filters)
        .sort({ lastUsedAt: -1 })
        .skip(skip)
        .limit(limit)
        .select({ messages: 1, userId: 1, conversationId: 1, sessionTitle: 1, pinned: 1, archived: 1, lastUsedAt: 1 })
        .lean()
        .exec(),
      UserAssistantConversationModel.countDocuments(filters),
    ]);

    const userIds = Array.from(new Set(docs.map((doc) => String(doc.userId))));
    const users = userIds.length
      ? await UserModel.find({ _id: { $in: userIds } }).select({ email: 1, name: 1 }).lean().exec()
      : [];
    const userMap = new Map(users.map((user: any) => [String(user._id), user]));

    const items = docs.map((doc) => this.mapConversationListItem(doc, userMap.get(String(doc.userId))));
    return {
      items,
      pagination: { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  async getConversation(conversationId: string): Promise<AIConversationDetail | null> {
    const doc = await UserAssistantConversationModel.findOne({ conversationId }).lean().exec();
    if (!doc) return null;
    const user = await UserModel.findById(doc.userId).select({ email: 1, name: 1 }).lean().exec();
    return {
      ...this.mapConversationListItem(doc, user || undefined),
      messages: (doc.messages || []).map((message) => ({
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        feedback: message.feedback?.rating,
      })),
    };
  }

  private mapConversationListItem(doc: any, user?: any): AIConversationListItem {
    const messages = Array.isArray(doc.messages) ? doc.messages : [];
    return {
      conversationId: doc.conversationId,
      userId: String(doc.userId),
      userEmail: user?.email,
      userName: user?.name,
      sessionTitle: doc.sessionTitle || undefined,
      messageCount: messages.length,
      feedbackPositive: messages.filter((m: any) => m.feedback?.rating === 'positive').length,
      feedbackNegative: messages.filter((m: any) => m.feedback?.rating === 'negative').length,
      pinned: Boolean(doc.pinned),
      archived: Boolean(doc.archived),
      lastUsedAt: doc.lastUsedAt,
    };
  }
}
