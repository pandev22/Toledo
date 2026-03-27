/**
 * Cache handler for Heliactyl Next
 * Provides Redis-based caching with fallback to memory
 */

const Redis = require('ioredis');
const LRU = require('lru-cache');
const loadConfig = require('./config');
const settings = loadConfig('./config.toml');

class CacheManager {
  constructor() {
    this.redis = null;
    this.memoryCache = new LRU({
      max: 500,
      ttl: 1000 * 60 * 5, // 5 minutes default
      updateAgeOnGet: true,
      updateAgeOnHas: true
    });
    this.isConnected = false;
    this.fallbackMode = false;
    
    this.init();
  }

  async init() {
    try {
      // Check if Redis is configured
      if (settings.redis?.enabled && settings.redis?.host) {
        this.redis = new Redis({
          host: settings.redis.host,
          port: settings.redis.port || 6379,
          password: settings.redis.password || undefined,
          db: settings.redis.db || 0,
          retryStrategy: (times) => {
            if (times > 3) {
              console.warn('[Cache] Redis connection failed, using memory fallback');
              this.fallbackMode = true;
              return null;
            }
            return Math.min(times * 100, 3000);
          },
          maxRetriesPerRequest: 3
        });

        this.redis.on('connect', () => {
          console.log('[Cache] Redis connected');
          this.isConnected = true;
          this.fallbackMode = false;
        });

        this.redis.on('error', (err) => {
          console.error('[Cache] Redis error:', err.message);
          this.fallbackMode = true;
        });

        this.redis.on('close', () => {
          console.warn('[Cache] Redis connection closed, using fallback');
          this.isConnected = false;
          this.fallbackMode = true;
        });
      } else {
        console.log('[Cache] Redis not configured, using memory cache only');
        this.fallbackMode = true;
      }
    } catch (error) {
      console.error('[Cache] Failed to initialize Redis:', error.message);
      this.fallbackMode = true;
    }
  }

  /**
   * Get value from cache
   * @param {string} key - Cache key
   * @returns {Promise<any>} Cached value or null
   */
  async get(key) {
    try {
      if (this.isConnected && !this.fallbackMode) {
        const value = await this.redis.get(key);
        if (value) {
          return JSON.parse(value);
        }
      }
      
      // Fallback to memory cache
      return this.memoryCache.get(key) || null;
    } catch (error) {
      console.error('[Cache] Get error:', error.message);
      return this.memoryCache.get(key) || null;
    }
  }

  /**
   * Set value in cache
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} ttl - Time to live in seconds (default: 300 = 5 minutes)
   * @returns {Promise<void>}
   */
  async set(key, value, ttl = 300) {
    try {
      const serialized = JSON.stringify(value);
      
      if (this.isConnected && !this.fallbackMode) {
        await this.redis.setex(key, ttl, serialized);
      }
      
      // Always set in memory cache as backup
      this.memoryCache.set(key, value, { ttl: ttl * 1000 });
    } catch (error) {
      console.error('[Cache] Set error:', error.message);
      // Fallback to memory only
      this.memoryCache.set(key, value, { ttl: ttl * 1000 });
    }
  }

  /**
   * Delete value from cache
   * @param {string} key - Cache key
   * @returns {Promise<void>}
   */
  async del(key) {
    try {
      if (this.isConnected && !this.fallbackMode) {
        await this.redis.del(key);
      }
      this.memoryCache.delete(key);
    } catch (error) {
      console.error('[Cache] Delete error:', error.message);
      this.memoryCache.delete(key);
    }
  }

  /**
   * Delete keys by pattern
   * @param {string} pattern - Key pattern (e.g., "ptero:user:*")
   * @returns {Promise<void>}
   */
  async delPattern(pattern) {
    try {
      if (this.isConnected && !this.fallbackMode) {
        const keys = await this.redis.keys(pattern);
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      }
      
      // Clear from memory cache
      const regex = new RegExp(pattern.replace('*', '.*'));
      for (const key of this.memoryCache.keys()) {
        if (regex.test(key)) {
          this.memoryCache.delete(key);
        }
      }
    } catch (error) {
      console.error('[Cache] Delete pattern error:', error.message);
    }
  }

  /**
   * Get or set cache value
   * @param {string} key - Cache key
   * @param {Function} factory - Function to generate value if not cached
   * @param {number} ttl - Time to live in seconds
   * @returns {Promise<any>}
   */
  async getOrSet(key, factory, ttl = 300) {
    const cached = await this.get(key);
    if (cached !== null) {
      return cached;
    }

    const value = await factory();
    if (value !== null && value !== undefined) {
      await this.set(key, value, ttl);
    }
    return value;
  }

  /**
   * Flush all cache
   * @returns {Promise<void>}
   */
  async flush() {
    try {
      if (this.isConnected && !this.fallbackMode) {
        await this.redis.flushdb();
      }
      this.memoryCache.clear();
    } catch (error) {
      console.error('[Cache] Flush error:', error.message);
      this.memoryCache.clear();
    }
  }

  /**
   * Check if cache is in fallback mode
   * @returns {boolean}
   */
  isFallback() {
    return this.fallbackMode;
  }
}

// Export singleton instance
const cache = new CacheManager();

module.exports = cache;
