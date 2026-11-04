// src/v2/infrastructure/cache/ValkeyCache.ts

import { createClient, RedisClientType } from 'redis';
import { ICacheRepository } from '../../domain/repositories/ICacheRepository';
import { addTiming } from '../../shared/utils/performanceTiming';
import { timeStepSync } from '../../shared/utils/stepTimeline';
import { recordCacheError, recordCacheLookup, updateCacheRuntime } from '../../shared/utils/runtimeMetrics';

// M13-B5a: JSON.parse/stringify of a multi-MB value blocks the event loop. Only large values are measured (a step per small
// read would cost more than it tells); they feed `Server-Timing` (`cache_parse`/`cache_stringify`) and the stall step overlap.
const LARGE_JSON_CHARS = 256_000;
const JSON_STEP = { background: true, minMs: 50 } as const;

function parseJson<T>(raw: string): T {
  if (raw.length < LARGE_JSON_CHARS) return JSON.parse(raw) as T;
  const started = performance.now();
  try {
    return timeStepSync('cache.json_parse', () => JSON.parse(raw) as T, JSON_STEP);
  } finally {
    addTiming('cache_parse', performance.now() - started);
  }
}

function stringifyJson(value: unknown): string {
  const started = performance.now();
  const serialized = timeStepSync('cache.json_stringify', () => JSON.stringify(value), JSON_STEP);
  if (serialized.length >= LARGE_JSON_CHARS) addTiming('cache_stringify', performance.now() - started);
  return serialized;
}

/**
 * Valkey-backed cache repository (Redis compatible) with resilience defaults.
 */
export class ValkeyCache implements ICacheRepository {
  private client: RedisClientType;
  private isConnected: boolean = false;
  private lastStatsRefreshAt = 0;

  constructor(
    private readonly redisUrl: string,
    private readonly options?: {
      maxRetries?: number;
      retryDelay?: number;
      connectTimeout?: number;
    }
  ) {
    this.client = createClient({
      url: this.redisUrl,
      socket: {
        reconnectStrategy: (retries: number) => {
          const maxRetries = this.options?.maxRetries || 10;
          if (retries >= maxRetries) {
            return new Error('Valkey/Redis max retries reached');
          }
          return Math.min(retries * 50, 2000);
        },
        connectTimeout: this.options?.connectTimeout || 10000,
      },
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on('connect', () => {
      console.log('[ValkeyCache] Connecting to Valkey...');
    });

    this.client.on('ready', () => {
      console.log('[ValkeyCache] Valkey connection ready');
      this.isConnected = true;
      updateCacheRuntime({ connected: true });
    });

    this.client.on('error', (err: Error) => {
      console.error('[ValkeyCache] Valkey error:', err);
      this.isConnected = false;
      updateCacheRuntime({ connected: false });
    });

    this.client.on('end', () => {
      console.log('[ValkeyCache] Valkey connection closed');
      this.isConnected = false;
      updateCacheRuntime({ connected: false });
    });
  }

  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    try {
      await this.client.connect();
      this.isConnected = true;
      await this.refreshRuntimeStats();
    } catch (error) {
      console.error('[ValkeyCache] Failed to connect:', error);
      this.isConnected = false;
      throw error; // Throw so container can fallback to InMemory
    }
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    try {
      await this.client.quit();
      this.isConnected = false;
    } catch (error) {
      console.error('[ValkeyCache] Error disconnecting:', error);
      await this.client.disconnect();
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const started = performance.now();
    try {
      if (!this.isConnected) {
        console.warn('[ValkeyCache] Not connected, skipping get');
        recordCacheLookup(false, performance.now() - started);
        return null;
      }

      const value = await this.client.get(key);
      if (Date.now() - this.lastStatsRefreshAt > 60_000) void this.refreshRuntimeStats();

      if (!value) {
        recordCacheLookup(false, performance.now() - started);
        return null;
      }

      recordCacheLookup(true, performance.now() - started);
      return parseJson<T>(value);
    } catch (error) {
      recordCacheError();
      console.error(`[ValkeyCache] Error getting key ${key}:`, error);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number = 300): Promise<void> {
    try {
      if (!this.isConnected) {
        console.warn('[ValkeyCache] Not connected, skipping set');
        return;
      }

      const serialized = stringifyJson(value);

      await this.client.setEx(key, ttlSeconds, serialized);
    } catch (error) {
      console.error(`[ValkeyCache] Error setting key ${key}:`, error);
      // No lanzar error para no romper el flujo de la aplicación
    }
  }

  async delete(key: string): Promise<void> {
    try {
      if (!this.isConnected) {
        console.warn('[ValkeyCache] Not connected, skipping delete');
        return;
      }

      await this.client.del(key);
    } catch (error) {
      console.error(`[ValkeyCache] Error deleting key ${key}:`, error);
    }
  }

  async increment(key: string, ttlSeconds: number = 300): Promise<number> {
    try {
      if (!this.isConnected) {
        console.warn('[ValkeyCache] Not connected, skipping increment');
        return 0;
      }

      const nextValue = await this.client.incr(key);
      if (ttlSeconds > 0 && nextValue === 1) {
        await this.client.expire(key, ttlSeconds);
      }

      return nextValue;
    } catch (error) {
      console.error(`[ValkeyCache] Error incrementing key ${key}:`, error);
      return 0;
    }
  }

  async setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (!this.isConnected) return false;
    try {
      const result = await this.client.set(key, value, { NX: true, EX: ttlSeconds });
      return result === 'OK';
    } catch (error) {
      console.error(`[ValkeyCache] Error acquiring lock ${key}:`, error);
      return false;
    }
  }

  async releaseLock(key: string, value: string): Promise<void> {
    if (!this.isConnected) return;
    try {
      await this.client.eval(
        'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
        { keys: [key], arguments: [value] }
      );
    } catch (error) {
      console.error(`[ValkeyCache] Error releasing lock ${key}:`, error);
    }
  }

  async clear(pattern?: string): Promise<void> {
    try {
      if (!this.isConnected) {
        console.warn('[ValkeyCache] Not connected, skipping clear');
        return;
      }

      if (!pattern) {
        await this.client.flushDb();
        return;
      }

      // Usar SCAN para evitar bloquear Redis con KEYS en producción
      const keys = await this.scanKeys(pattern);

      if (keys.length > 0) {
        // Borrar en lotes de 100 para evitar comandos muy grandes
        const batchSize = 100;
        for (let i = 0; i < keys.length; i += batchSize) {
          const batch = keys.slice(i, i + batchSize);
          await this.client.del(batch);
        }
      }
    } catch (error) {
      console.error(`[ValkeyCache] Error clearing pattern ${pattern}:`, error);
    }
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';

    do {
      const result = await this.client.scan(cursor, {
        MATCH: pattern,
        COUNT: 100,
      });

      cursor = result.cursor;
      keys.push(...result.keys);
    } while (cursor !== '0');

    return keys;
  }

  // Métodos adicionales útiles para producción

  async exists(key: string): Promise<boolean> {
    try {
      if (!this.isConnected) {
        return false;
      }

      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      console.error(`[ValkeyCache] Error checking existence of ${key}:`, error);
      return false;
    }
  }

  async ttl(key: string): Promise<number> {
    try {
      if (!this.isConnected) {
        return -1;
      }

      return await this.client.ttl(key);
    } catch (error) {
      console.error(`[ValkeyCache] Error getting TTL of ${key}:`, error);
      return -1;
    }
  }

  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    try {
      if (!this.isConnected || keys.length === 0) {
        return keys.map(() => null);
      }

      const values = await this.client.mGet(keys);

      return values.map((v: string | null) =>
        v ? (JSON.parse(v) as T) : null
      );
    } catch (error) {
      console.error('[ValkeyCache] Error in mget:', error);
      return keys.map(() => null);
    }
  }

  async mset(
    entries: Array<{ key: string; value: any; ttl?: number }>
  ): Promise<void> {
    try {
      if (!this.isConnected || entries.length === 0) {
        return;
      }

      // Usar pipeline para operaciones batch eficientes
      const pipeline = this.client.multi();

      entries.forEach(({ key, value, ttl }) => {
        const serialized = JSON.stringify(value);
        if (ttl) {
          pipeline.setEx(key, ttl, serialized);
        } else {
          pipeline.set(key, serialized);
        }
      });

      await pipeline.exec();
    } catch (error) {
      console.error('[ValkeyCache] Error in mset:', error);
    }
  }

  // Health check para monitoreo
  async ping(): Promise<boolean> {
    try {
      if (!this.isConnected) {
        return false;
      }

      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      console.error('[ValkeyCache] Ping failed:', error);
      return false;
    }
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  private async refreshRuntimeStats(): Promise<void> {
    if (!this.isConnected) return;
    try {
      const [memoryInfo, statsInfo] = await Promise.all([
        this.client.info('memory'),
        this.client.info('stats'),
      ]);
      updateCacheRuntime({
        connected: true,
        memoryBytes: Number(/^used_memory:(\d+)/m.exec(memoryInfo)?.[1] || 0),
        evictions: Number(/^evicted_keys:(\d+)/m.exec(statsInfo)?.[1] || 0),
      });
      this.lastStatsRefreshAt = Date.now();
    } catch {
      recordCacheError();
    }
  }
}
