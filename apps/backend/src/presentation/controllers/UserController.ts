import { Request, Response, NextFunction } from 'express';
import { successResponse } from '../../shared/types/ApiResponse';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { AuthenticatedRequest } from '../middlewares/authGuard';
import type { IStorageRepository } from '../../domain/repositories/IStorageRepository';
import { AvatarRejected, storeAvatar } from '../../infrastructure/storage/AvatarStore';
import { UserModel } from '../../infrastructure/database/models/User.model';
import { UserProfileModel } from '../../infrastructure/database/models/UserProfile.model';
import { UserListModel } from '../../infrastructure/database/models/UserList.model';
import { UserListItemModel } from '../../infrastructure/database/models/UserListItem.model';
import { UserFavoriteModel } from '../../infrastructure/database/models/UserFavorite.model';
import { UserActivityModel } from '../../infrastructure/database/models/UserActivity.model';
import { UserFollowModel } from '../../infrastructure/database/models/UserFollow.model';
import { UserNotificationModel } from '../../infrastructure/database/models/UserNotification.model';
import { UserContentInteractionModel } from '../../infrastructure/database/models/UserContentInteraction.model';
import { UserBlockModel } from '../../infrastructure/database/models/UserBlock.model';
import { UserReportModel } from '../../infrastructure/database/models/UserReport.model';
import { UserAssistantMemoryModel } from '../../infrastructure/database/models/UserAssistantMemory.model';
import { UserAssistantConversationModel } from '../../infrastructure/database/models/UserAssistantConversation.model';
import { ChatConversationModel } from '../../infrastructure/database/models/ChatConversation.model';
import { ChatMessageModel } from '../../infrastructure/database/models/ChatMessage.model';
import { ActivityLikeModel } from '../../infrastructure/database/models/ActivityLike.model';
import { ActivityCommentModel } from '../../infrastructure/database/models/ActivityComment.model';
import { AuthSessionModel } from '../../infrastructure/database/models/AuthSession.model';
import { AssistantMemoryService } from '../../application/services/AssistantMemoryService';
import { scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

const DEFAULT_PRIVACY = {
  profilePublic: true,
  shareActivity: true,
  shareWatchlist: true,
  showOnline: true,
  allowMessages: 'all' as const,
  publicLists: true,
};

const DEFAULT_NOTIFICATIONS = {
  recommendations: true,
  followers: true,
  weeklySummary: false,
  chatMessages: true,
  groupActivity: true,
};

export class UserController {
  /** Storage for profile photos; absent in tests that do not upload. */
  constructor(private readonly storage?: IStorageRepository) {}

  /** Profile photo upload: raw PNG/JPEG/WebP body (see user.routes), stored as a 256 px WebP. */
  async uploadAvatar(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);
      if (!this.storage) throw new ValidationError('La subida de imágenes no está disponible', []);
      if (!Buffer.isBuffer(req.body) || !req.body.length) {
        throw new ValidationError('Sube una imagen PNG, JPEG o WebP', [{ field: 'avatar', message: 'Missing image body', value: null }]);
      }
      let url: string;
      try {
        url = await storeAvatar(this.storage, userId, req.body);
      } catch (error) {
        if (error instanceof AvatarRejected) throw new ValidationError(error.message, [{ field: 'avatar', message: error.message, value: null }]);
        throw error;
      }

      const userDoc = await UserModel.findById(userId).exec();
      if (!userDoc) throw new NotFoundError('User not found');
      const profile = await this.ensureProfile(userId, userDoc);
      profile.avatar = url;
      await profile.save();
      (userDoc as any).picture = url;
      await userDoc.save();

      const stats = await this.getStats(userId);
      res.json(successResponse({ profile: this.mapProfile(userDoc.toObject(), profile.toObject(), stats) }));
    } catch (error) {
      next(error);
    }
  }

  async getProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);
      const userDoc = await UserModel.findById(userId).lean().exec();
      if (!userDoc) {
        throw new NotFoundError('User not found');
      }

      const profile = await this.ensureProfile(userId, userDoc);
      const stats = await this.getStats(userId);

      res.json(
        successResponse({
          profile: this.mapProfile(userDoc, profile, stats),
        })
      );
    } catch (error) {
      next(error);
    }
  }

  async updateProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);
      const {
        name,
        username,
        bio,
        location,
        avatar,
        favoriteGenres,
        preferredPlatforms,
        discoveryDefaults,
      } = req.body || {};

      const updates: Record<string, any> = {};
      if (name !== undefined) updates.name = String(name).trim();
      if (username !== undefined) updates.username = String(username).trim();
      if (bio !== undefined) updates.bio = String(bio).trim();
      if (location !== undefined) updates.location = String(location).trim();
      if (avatar !== undefined) {
        const value = String(avatar).trim();
        // Only no photo, an uploaded one or an https image: never javascript:, data: or another site's path.
        if (value && !/^https:\/\/\S+$/.test(value) && !/^\/storage\/avatars\/[\w-]+\.webp$/.test(value)) {
          throw new ValidationError('Invalid avatar', [{ field: 'avatar', message: 'Use the upload endpoint or an https URL', value }]);
        }
        updates.avatar = value;
      }
      if (favoriteGenres !== undefined) {
        updates.favoriteGenres = this.sanitizeStringArray(favoriteGenres);
      }
      if (preferredPlatforms !== undefined) {
        updates.preferredPlatforms = this.sanitizeStringArray(preferredPlatforms);
      }
      if (discoveryDefaults !== undefined) {
        updates.discoveryDefaults = this.sanitizeDiscoveryDefaults(discoveryDefaults);
      }

      if (!Object.keys(updates).length) {
        throw new ValidationError('No fields to update', []);
      }

      if (updates.username && updates.username.length < 2) {
        throw new ValidationError('Username is too short', [
          { field: 'username', message: 'Minimum length is 2', value: updates.username },
        ]);
      }

      const userDoc = await UserModel.findById(userId).exec();
      if (!userDoc) {
        throw new NotFoundError('User not found');
      }

      const profile = await this.ensureProfile(userId, userDoc);
      profile.username = updates.username ?? profile.username;
      profile.bio = updates.bio ?? profile.bio;
      profile.location = updates.location ?? profile.location;
      // An empty string removes the photo (the UI then shows the initials).
      if (updates.avatar !== undefined) {
        profile.avatar = updates.avatar;
      }
      if (updates.favoriteGenres) {
        profile.favoriteGenres = updates.favoriteGenres;
      }
      if (updates.preferredPlatforms) {
        profile.preferredPlatforms = updates.preferredPlatforms;
      }
      if (updates.discoveryDefaults) {
        profile.discoveryDefaults = updates.discoveryDefaults;
      }
      await profile.save();

      if (updates.favoriteGenres || updates.preferredPlatforms) {
        const memService = new AssistantMemoryService();
        memService.syncFromProfile(
          userId,
          updates.favoriteGenres || [],
          updates.preferredPlatforms || []
        ).catch(() => {});
      }

      if (updates.name) {
        userDoc.name = updates.name;
      }
      if (updates.avatar !== undefined) {
        (userDoc as any).picture = updates.avatar;
      }
      await userDoc.save();

      const stats = await this.getStats(userId);

      res.json(
        successResponse({
          profile: this.mapProfile(userDoc.toObject(), profile.toObject(), stats),
        })
      );
    } catch (error) {
      next(error);
    }
  }

  async updatePrivacy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);
      const profile = await this.ensureProfileById(userId);
      profile.privacy = {
        ...DEFAULT_PRIVACY,
        ...(profile.privacy || {}),
        ...this.sanitizePrivacy(req.body),
      };
      await profile.save();

      res.json(successResponse({ privacy: profile.privacy }));
    } catch (error) {
      next(error);
    }
  }

  async updateNotifications(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);
      const profile = await this.ensureProfileById(userId);
      profile.notifications = {
        ...DEFAULT_NOTIFICATIONS,
        ...(profile.notifications || {}),
        ...this.sanitizeNotifications(req.body),
      };
      await profile.save();

      res.json(successResponse({ notifications: profile.notifications }));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Saves references to canonical TV and football entities.  This deliberately
   * does not accept provider names or arbitrary integration metadata.
   */
  async updateTvPreferences(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);
      const profile = await this.ensureProfileById(userId);
      profile.tvPreferences = this.sanitizeTvPreferences(req.body);
      await profile.save();

      res.json(successResponse({ tvPreferences: profile.tvPreferences }));
    } catch (error) {
      next(error);
    }
  }

  async updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);
      const { title, mood, visibility } = req.body || {};
      if (!title) {
        throw new ValidationError('title is required', [
          { field: 'title', message: 'title is required', value: title },
        ]);
      }

      const profile = await this.ensureProfileById(userId);
      profile.watchingNow = {
        title: String(title).trim(),
        mood: mood ? String(mood).trim() : '',
        visibility: visibility || 'friends',
      };
      await profile.save();

      await UserActivityModel.create({
        userId,
        type: 'status',
        title: 'Nuevo estado',
        description: `Ahora viendo: ${profile.watchingNow.title}`,
        badge: profile.watchingNow.visibility === 'private' ? 'Privado' : 'Compartido',
        visibility: profile.watchingNow.visibility,
      });

      res.json(successResponse({ watchingNow: profile.watchingNow }));
    } catch (error) {
      next(error);
    }
  }

  async getLists(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);
      await this.ensureDefaultList(userId);

      const lists = await UserListModel.find({ userId }).sort({ updatedAt: -1 }).lean().exec();
      res.json(successResponse({ lists: lists.map((list) => this.mapList(list)) }));
    } catch (error) {
      next(error);
    }
  }

  async createList(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);
      const { title, description, visibility } = req.body || {};
      if (!title) {
        throw new ValidationError('title is required', [
          { field: 'title', message: 'title is required', value: title },
        ]);
      }

      const list = await UserListModel.create({
        userId,
        title: String(title).trim(),
        description: description ? String(description).trim() : '',
        visibility: visibility || 'private',
        itemsCount: 0,
      });

      await UserActivityModel.create({
        userId,
        type: 'list',
        title: 'Nueva lista creada',
        description: `Has creado la lista "${list.title}"`,
        badge: list.visibility === 'public' ? 'Publico' : list.visibility === 'friends' ? 'Amigos' : 'Privado',
      });

      res.json(successResponse({ list: this.mapList(list.toObject()) }));
    } catch (error) {
      next(error);
    }
  }

  async updateList(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);
      const { id } = req.params;
      const updates: Record<string, any> = {};

      if (req.body?.title !== undefined) updates.title = String(req.body.title).trim();
      if (req.body?.description !== undefined) updates.description = String(req.body.description).trim();
      if (req.body?.visibility !== undefined) updates.visibility = req.body.visibility;
      if (req.body?.cover !== undefined) updates.cover = String(req.body.cover).trim();

      if (!Object.keys(updates).length) {
        throw new ValidationError('No fields to update', []);
      }

      const list = await UserListModel.findOneAndUpdate(
        { _id: id, userId },
        { $set: updates },
        { new: true }
      )
        .lean()
        .exec();

      if (!list) {
        throw new NotFoundError('List not found');
      }

      res.json(successResponse({ list: this.mapList(list) }));
    } catch (error) {
      next(error);
    }
  }

  async deleteList(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);
      const { id } = req.params;
      const list = await UserListModel.findOneAndDelete({ _id: id, userId }).lean().exec();
      if (!list) {
        throw new NotFoundError('List not found');
      }

      await UserListItemModel.deleteMany({ listId: id, userId });
      res.json(successResponse({ deleted: true }));
    } catch (error) {
      next(error);
    }
  }

  async getListItems(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);
      const { id } = req.params;
      const list = await UserListModel.findOne({ _id: id, userId }).lean().exec();
      if (!list) {
        throw new NotFoundError('List not found');
      }

      const items = await UserListItemModel.find({ listId: id, userId })
        .sort({ createdAt: -1 })
        .lean()
        .exec();

      res.json(
        successResponse({
          list: this.mapList(list),
          items: items.map((item) => this.mapListItem(item)),
        })
      );
    } catch (error) {
      next(error);
    }
  }

  async addListItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);
      const { id } = req.params;
      const { title, type, state, contentId, poster, rating, mood } = req.body || {};
      if (!title) {
        throw new ValidationError('title is required', [
          { field: 'title', message: 'title is required', value: title },
        ]);
      }

      const list = await UserListModel.findOne({ _id: id, userId }).exec();
      if (!list) {
        throw new NotFoundError('List not found');
      }

      const normalizedTitle = String(title).trim();
      const existingQuery: Record<string, any> = {
        listId: id,
        userId,
      };
      if (contentId) {
        existingQuery.contentId = String(contentId);
      } else {
        existingQuery.title = normalizedTitle;
        existingQuery.type = type || 'program';
      }

      const existing = await UserListItemModel.findOne(existingQuery).exec();
      if (existing) {
        if (state) existing.state = state;
        if (type) existing.type = type;
        if (poster !== undefined) existing.poster = String(poster).trim();
        if (rating !== undefined) existing.rating = Number(rating);
        if (mood !== undefined) existing.mood = String(mood).trim();
        await existing.save();

        res.json(
          successResponse({
            list: this.mapList(list.toObject()),
            item: this.mapListItem(existing.toObject()),
          })
        );
        return;
      }

      const item = await UserListItemModel.create({
        userId,
        listId: id,
        contentId: contentId ? String(contentId) : undefined,
        title: normalizedTitle,
        type: type || 'program',
        state: state || 'pending',
        visibility: list.visibility,
        progress: 0,
        poster: poster ? String(poster).trim() : undefined,
        rating: rating !== undefined ? Number(rating) : undefined,
        mood: mood ? String(mood).trim() : undefined,
      });

      list.itemsCount = Math.max(0, (list.itemsCount || 0) + 1);
      await list.save();

      res.json(
        successResponse({
          list: this.mapList(list.toObject()),
          item: this.mapListItem(item.toObject()),
        })
      );
    } catch (error) {
      next(error);
    }
  }

  async updateListItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);
      const { id, itemId } = req.params;
      const updates: Record<string, any> = {};

      if (req.body?.state !== undefined) updates.state = req.body.state;
      if (req.body?.progress !== undefined) updates.progress = Number(req.body.progress);
      if (req.body?.rating !== undefined) updates.rating = Number(req.body.rating);
      if (req.body?.mood !== undefined) updates.mood = String(req.body.mood).trim();
      if (req.body?.poster !== undefined) updates.poster = String(req.body.poster).trim();

      if (!Object.keys(updates).length) {
        throw new ValidationError('No fields to update', []);
      }

      const item = await UserListItemModel.findOneAndUpdate(
        { _id: itemId, listId: id, userId },
        { $set: updates },
        { new: true }
      )
        .lean()
        .exec();

      if (!item) {
        throw new NotFoundError('List item not found');
      }

      res.json(successResponse({ item: this.mapListItem(item) }));
    } catch (error) {
      next(error);
    }
  }

  async removeListItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);
      const { id, itemId } = req.params;
      const list = await UserListModel.findOne({ _id: id, userId }).exec();
      if (!list) {
        throw new NotFoundError('List not found');
      }

      const deleted = await UserListItemModel.findOneAndDelete({
        _id: itemId,
        listId: id,
        userId,
      })
        .lean()
        .exec();
      if (!deleted) {
        throw new NotFoundError('List item not found');
      }

      list.itemsCount = Math.max(0, (list.itemsCount || 0) - 1);
      await list.save();

      res.json(successResponse({ deleted: true, list: this.mapList(list.toObject()) }));
    } catch (error) {
      next(error);
    }
  }

  async getFavorites(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);
      const { type } = req.query;
      const filters: Record<string, any> = { userId };
      if (type && typeof type === 'string') {
        filters.type = type;
      }
      const favorites = await UserFavoriteModel.find(filters).sort({ createdAt: -1 }).lean().exec();
      res.json(successResponse({ favorites: favorites.map((fav) => this.mapFavorite(fav)) }));
    } catch (error) {
      next(error);
    }
  }

  async addFavorite(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);
      const { itemId, title, image, subtitle, type } = req.body || {};
      if (!title || !type) {
        throw new ValidationError('title and type are required', [
          { field: 'title', message: 'title is required', value: title },
          { field: 'type', message: 'type is required', value: type },
        ]);
      }

      const normalizedItemId = itemId ? String(itemId).trim() : '';
      const normalizedTitle = String(title).trim();
      const normalizedType = String(type).trim();

      const uniqueFilter: Record<string, any> = {
        userId,
        type: normalizedType,
      };
      if (normalizedItemId) {
        uniqueFilter.itemId = normalizedItemId;
      } else {
        uniqueFilter.title = normalizedTitle;
      }

      const favorite = await UserFavoriteModel.findOneAndUpdate(
        uniqueFilter,
        {
          $set: {
            userId,
            itemId: normalizedItemId || undefined,
            title: normalizedTitle,
            image: image ? String(image).trim() : undefined,
            subtitle: subtitle ? String(subtitle).trim() : undefined,
            type: normalizedType,
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      )
        .lean()
        .exec();

      res.json(successResponse({ favorite: this.mapFavorite(favorite) }));
    } catch (error) {
      next(error);
    }
  }

  async removeFavorite(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);
      const { id } = req.params;
      const favorite = await UserFavoriteModel.findOneAndDelete({ _id: id, userId }).lean().exec();
      if (!favorite) {
        throw new NotFoundError('Favorite not found');
      }
      res.json(successResponse({ deleted: true }));
    } catch (error) {
      next(error);
    }
  }

  async getNotifications(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);
      const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
      const offset = Math.max(Number(req.query.offset) || 0, 0);

      const notifications = await UserNotificationModel.find({ recipientId: userId })
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean()
        .exec();

      res.json(
        successResponse({
          notifications: notifications.map((notification) =>
            this.mapNotification(notification)
          ),
        })
      );
    } catch (error) {
      next(error);
    }
  }

  async markNotificationsRead(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = this.getUserId(req);
      const now = new Date();
      const ids = Array.isArray(req.body?.ids)
        ? req.body.ids
            .map((id: unknown) => String(id || '').trim())
            .filter((id: string) => Boolean(id))
        : [];
      const markAll = req.body?.all === true;

      const query: Record<string, any> = {
        recipientId: userId,
        readAt: { $exists: false },
      };
      if (!markAll && ids.length) {
        query._id = { $in: ids };
      }

      await UserNotificationModel.updateMany(query, { $set: { readAt: now } }).exec();

      res.json(successResponse({ updated: true }));
    } catch (error) {
      next(error);
    }
  }

  async getUnreadNotificationsCount(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = this.getUserId(req);
      const unreadCount = await UserNotificationModel.countDocuments({
        recipientId: userId,
        readAt: { $exists: false },
      });

      res.json(successResponse({ unreadCount }));
    } catch (error) {
      next(error);
    }
  }

  async deleteAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!password) {
        throw new ValidationError('Password is required to delete account', [
          { field: 'password', message: 'password is required' },
        ]);
      }

      const user = await UserModel.findById(userId).exec();
      if (!user) {
        throw new NotFoundError('User not found');
      }

      if (!(user as any).passwordHash || !(user as any).passwordSalt) {
        throw new ValidationError('Password verification not available for this account', [
          { field: 'password', message: 'Esta cuenta no tiene contraseña configurada' },
        ]);
      }

      const derived = (await scryptAsync(password, (user as any).passwordSalt, 64)) as Buffer;
      const expected = Buffer.from((user as any).passwordHash, 'hex');
      const valid = expected.length === derived.length && timingSafeEqual(expected, derived);
      if (!valid) {
        throw new ValidationError('Incorrect password', [
          { field: 'password', message: 'La contraseña no es correcta' },
        ]);
      }

      await Promise.all([
        UserProfileModel.deleteMany({ userId }),
        UserContentInteractionModel.deleteMany({ userId }),
        UserListItemModel.deleteMany({ userId }),
        UserListModel.deleteMany({ userId }),
        UserFavoriteModel.deleteMany({ userId }),
        UserFollowModel.deleteMany({ $or: [{ followerId: userId }, { followeeId: userId }] }),
        UserBlockModel.deleteMany({ $or: [{ blockerId: userId }, { blockedId: userId }] }),
        UserNotificationModel.deleteMany({ $or: [{ recipientId: userId }, { actorId: userId }] }),
        UserAssistantMemoryModel.deleteMany({ userId }),
        UserAssistantConversationModel.deleteMany({ userId }),
        ChatMessageModel.deleteMany({ senderId: userId }),
        ChatConversationModel.deleteMany({ participants: userId }),
        UserActivityModel.deleteMany({ userId }),
        ActivityLikeModel.deleteMany({ userId }),
        ActivityCommentModel.deleteMany({ userId }),
        AuthSessionModel.deleteMany({ userId }),
        UserReportModel.deleteMany({ reporterId: userId }),
      ]);

      user.name = 'Cuenta eliminada';
      user.email = `deleted_${userId}@deleted.local`;
      user.role = 'user';
      (user as any).status = 'suspended';
      (user as any).picture = '';
      (user as any).passwordHash = '';
      (user as any).passwordSalt = '';
      (user as any).googleId = '';
      await user.save();

      res.json(successResponse({ deleted: true }));
    } catch (error) {
      next(error);
    }
  }

  async exportData(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getUserId(req);
      const userDoc = await UserModel.findById(userId).lean().exec();
      if (!userDoc) {
        throw new NotFoundError('User not found');
      }

      const [
        profile,
        interactions,
        lists,
        listItems,
        favorites,
        activities,
        follows,
        notifications,
        memory,
      ] = await Promise.all([
        UserProfileModel.findOne({ userId }).lean().exec(),
        UserContentInteractionModel.find({ userId }).lean().exec(),
        UserListModel.find({ userId }).lean().exec(),
        UserListItemModel.find({ userId }).lean().exec(),
        UserFavoriteModel.find({ userId }).lean().exec(),
        UserActivityModel.find({ userId }).sort({ createdAt: -1 }).limit(500).lean().exec(),
        UserFollowModel.find({ followerId: userId }).lean().exec(),
        UserNotificationModel.find({ recipientId: userId }).sort({ createdAt: -1 }).limit(200).lean().exec(),
        UserAssistantMemoryModel.findOne({ userId }).lean().exec(),
      ]);

      res.json(
        successResponse({
          exportedAt: new Date().toISOString(),
          user: {
            name: userDoc.name,
            email: userDoc.email,
            role: userDoc.role,
            createdAt: (userDoc as any).createdAt,
          },
          profile: profile
            ? {
                username: profile.username,
                bio: profile.bio,
                location: profile.location,
                favoriteGenres: profile.favoriteGenres,
                preferredPlatforms: profile.preferredPlatforms,
                privacy: profile.privacy,
                notifications: profile.notifications,
              }
            : null,
          interactions: interactions.map((i: any) => ({
            contentId: i.contentId,
            title: i.title,
            rating: i.rating,
            watchedAt: i.watchedAt,
            createdAt: i.createdAt,
          })),
          lists: lists.map((l: any) => ({
            title: l.title,
            description: l.description,
            visibility: l.visibility,
            items: listItems
              .filter((item: any) => String(item.listId) === String(l._id))
              .map((item: any) => ({
                title: item.title,
                type: item.type,
                state: item.state,
                rating: item.rating,
              })),
          })),
          favorites: favorites.map((f: any) => ({
            title: f.title,
            type: f.type,
            createdAt: f.createdAt,
          })),
          activities: activities.map((a: any) => ({
            type: a.type,
            title: a.title,
            description: a.description,
            createdAt: a.createdAt,
          })),
          following: follows.map((f: any) => ({
            followeeId: String(f.followeeId),
            createdAt: f.createdAt,
          })),
          notifications: notifications.map((n: any) => ({
            type: n.type,
            title: n.title,
            createdAt: n.createdAt,
            readAt: n.readAt,
          })),
          assistantMemory: memory
            ? {
                likedGenres: (memory as any).likedGenres,
                dislikedGenres: (memory as any).dislikedGenres,
                preferredPlatforms: (memory as any).preferredPlatforms,
                preferredViewingContexts: (memory as any).preferredViewingContexts,
              }
            : null,
        })
      );
    } catch (error) {
      next(error);
    }
  }

  private getUserId(req: Request): string {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user?.id) {
      throw new NotFoundError('User not found');
    }
    return authReq.user.id;
  }

  private async ensureProfile(userId: string, userDoc: any) {
    const existing = await UserProfileModel.findOne({ userId }).exec();
    if (existing) return existing;

    const emailPrefix = userDoc.email?.split('@')[0] || `user${String(userId).slice(-4)}`;
    const created = await UserProfileModel.create({
      userId,
      username: emailPrefix,
      avatar: userDoc.picture || '/assets/gpt-avatar.png',
      bio: 'Comparte tus pelis y series favoritas.',
      location: '-',
      privacy: DEFAULT_PRIVACY,
      notifications: DEFAULT_NOTIFICATIONS,
      watchingNow: {
        title: '',
        mood: '',
        visibility: 'friends',
      },
      favoriteGenres: [],
      preferredPlatforms: [],
      discoveryDefaults: {
        types: [],
        availability: [],
        platforms: [],
        sort: 'popular',
      },
    });
    return created;
  }

  private async ensureProfileById(userId: string) {
    const userDoc = await UserModel.findById(userId).lean().exec();
    if (!userDoc) {
      throw new NotFoundError('User not found');
    }
    return this.ensureProfile(userId, userDoc);
  }

  private async ensureDefaultList(userId: string): Promise<void> {
    const existing = await UserListModel.findOne({ userId, isDefault: true }).lean().exec();
    if (existing) return;

    await UserListModel.create({
      userId,
      title: 'Pendientes de ver',
      description: 'Lista por defecto para guardar lo que quieres ver.',
      visibility: 'private',
      isDefault: true,
      itemsCount: 0,
    });
  }

  private async getStats(userId: string) {
    const [followers, following, listsCreated, watchlist, recommendations, ratings] = await Promise.all([
      UserFollowModel.countDocuments({ followeeId: userId }),
      UserFollowModel.countDocuments({ followerId: userId }),
      UserListModel.countDocuments({ userId }),
      UserListItemModel.countDocuments({ userId }),
      UserActivityModel.countDocuments({ userId, type: 'recommendation' }),
      UserContentInteractionModel.countDocuments({ userId, rating: { $exists: true } }),
    ]);

    return {
      followers,
      following,
      listsCreated,
      recommendations,
      watchlist,
      ratings,
    };
  }

  private mapProfile(userDoc: any, profile: any, stats: any) {
    return {
      id: String(userDoc._id || userDoc.id),
      name: userDoc.name || profile.username,
      username: profile.username,
      email: userDoc.email,
      avatar: profile.avatar || userDoc.picture || '/assets/gpt-avatar.png',
      role: userDoc.role,
      bio: profile.bio || '',
      location: profile.location || '-',
      favoriteGenres: profile.favoriteGenres || [],
      preferredPlatforms: profile.preferredPlatforms || [],
      tvPreferences: profile.tvPreferences || this.emptyTvPreferences(),
      discoveryDefaults: profile.discoveryDefaults || {
        types: [],
        availability: [],
        platforms: [],
        sort: 'popular',
      },
      watchingNow: profile.watchingNow || { title: '', mood: '', visibility: 'friends' },
      privacy: profile.privacy || DEFAULT_PRIVACY,
      notifications: profile.notifications || DEFAULT_NOTIFICATIONS,
      stats,
    };
  }

  private sanitizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 20);
  }

  private sanitizeDiscoveryDefaults(value: any) {
    const payload = value && typeof value === 'object' ? value : {};
    const allowedSort = ['personalized', 'popular', 'rating', 'airtime', 'recent'];
    return {
      types: this.sanitizeStringArray(payload.types).slice(0, 4),
      availability: this.sanitizeStringArray(payload.availability).slice(0, 6),
      platforms: this.sanitizeStringArray(payload.platforms).slice(0, 12),
      sort: allowedSort.includes(String(payload.sort || '').trim().toLowerCase())
        ? String(payload.sort).trim().toLowerCase()
        : 'popular',
    };
  }

  private sanitizePrivacy(value: unknown) {
    const payload = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const allowMessages = ['all', 'followers', 'none'];
    return {
      ...(typeof payload.profilePublic === 'boolean' ? { profilePublic: payload.profilePublic } : {}),
      ...(typeof payload.shareActivity === 'boolean' ? { shareActivity: payload.shareActivity } : {}),
      ...(typeof payload.shareWatchlist === 'boolean' ? { shareWatchlist: payload.shareWatchlist } : {}),
      ...(typeof payload.showOnline === 'boolean' ? { showOnline: payload.showOnline } : {}),
      ...(typeof payload.publicLists === 'boolean' ? { publicLists: payload.publicLists } : {}),
      ...(allowMessages.includes(String(payload.allowMessages))
        ? { allowMessages: String(payload.allowMessages) as 'all' | 'followers' | 'none' }
        : {}),
    };
  }

  private sanitizeNotifications(value: unknown) {
    const payload = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const allowed = ['recommendations', 'followers', 'weeklySummary', 'chatMessages', 'groupActivity'] as const;
    return Object.fromEntries(
      allowed
        .filter((key) => typeof payload[key] === 'boolean')
        .map((key) => [key, payload[key]])
    );
  }

  private emptyTvPreferences() {
    return {
      favoriteChannelIds: [],
      favoriteFootballTeamIds: [],
      favoriteFootballCompetitionIds: [],
      preferredContentLanguages: [],
    };
  }

  private sanitizeTvPreferences(value: unknown) {
    const payload = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    return {
      favoriteChannelIds: this.sanitizeStringArray(payload.favoriteChannelIds).slice(0, 100),
      favoriteFootballTeamIds: this.sanitizeStringArray(payload.favoriteFootballTeamIds).slice(0, 50),
      favoriteFootballCompetitionIds: this.sanitizeStringArray(payload.favoriteFootballCompetitionIds).slice(0, 50),
      preferredContentLanguages: this.sanitizeStringArray(payload.preferredContentLanguages).slice(0, 12),
    };
  }

  private mapList(list: any) {
    return {
      id: String(list._id),
      title: list.title,
      description: list.description || '',
      itemsCount: list.itemsCount || 0,
      visibility: list.visibility,
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
      cover: list.cover,
      isDefault: list.isDefault || false,
    };
  }

  private mapListItem(item: any) {
    return {
      id: String(item._id),
      contentId: item.contentId,
      title: item.title,
      type: item.type,
      state: item.state,
      progress: item.progress || 0,
      mood: item.mood,
      visibility: item.visibility,
      poster: item.poster,
      rating: item.rating,
      addedAt: item.addedAt,
    };
  }

  private mapFavorite(fav: any) {
    return {
      id: String(fav._id),
      itemId: fav.itemId,
      title: fav.title,
      image: fav.image,
      subtitle: fav.subtitle,
      type: fav.type,
      createdAt: fav.createdAt,
    };
  }

  private mapNotification(notification: any) {
    return {
      id: String(notification._id),
      type: notification.type,
      title: notification.title,
      description: notification.description || '',
      entityType: notification.entityType,
      entityId: notification.entityId,
      actorId: notification.actorId ? String(notification.actorId) : undefined,
      payload: notification.payload || {},
      readAt: notification.readAt,
      createdAt: notification.createdAt,
    };
  }
}
