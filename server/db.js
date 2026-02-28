const { PrismaClient } = require("@prisma/client");

class HeliactylDB {
  constructor(dbPath) {
    this.namespace = "heliactyl";
    this.prisma = new PrismaClient();
    this.cache = new Map();
    console.log("HeliactylDB initialized with Prisma");
  }

  async get(key) {
    const fullKey = `${this.namespace}:${key}`;
    const cached = this.cache.get(fullKey);
    if (cached) {
      if (cached.expires && Date.now() > cached.expires) {
        this.cache.delete(fullKey);
      } else {
        return cached.value;
      }
    }

    try {
      const result = await this.prisma.heliactyl.findUnique({
        where: { key: fullKey },
      });

      if (!result) return undefined;

      const parsed = JSON.parse(result.value);
      
      if (parsed.expires && Date.now() > parsed.expires) {
        await this.delete(key);
        return undefined;
      }

      this.cache.set(fullKey, parsed);
      return parsed.value;
    } catch (e) {
      console.error(`DB Get Error [${key}]:`, e.message);
      return undefined;
    }
  }

  async getMany(keys) {
    const fullKeys = keys.map(k => `${this.namespace}:${k}`);
    const results = {};
    
    try {
      const records = await this.prisma.heliactyl.findMany({
        where: { key: { in: fullKeys } }
      });

      for (const record of records) {
        const originalKey = record.key.replace(`${this.namespace}:`, "");
        const parsed = JSON.parse(record.value);
        
        if (parsed.expires && Date.now() > parsed.expires) {
          await this.delete(originalKey);
        } else {
          results[originalKey] = parsed.value;
          this.cache.set(record.key, parsed);
        }
      }
    } catch (e) {
      console.error(`DB GetMany Error:`, e.message);
    }
    return results;
  }

  async set(key, value, ttl) {
    const fullKey = `${this.namespace}:${key}`;
    const data = {
      value,
      expires: ttl ? Date.now() + ttl : undefined
    };

    try {
      await this.prisma.heliactyl.upsert({
        where: { key: fullKey },
        update: { value: JSON.stringify(data) },
        create: { key: fullKey, value: JSON.stringify(data) }
      });
      this.cache.set(fullKey, data);
    } catch (e) {
      console.error(`DB Set Error [${key}]:`, e.message);
    }
  }

  async delete(key) {
    const fullKey = `${this.namespace}:${key}`;
    try {
      await this.prisma.heliactyl.delete({ where: { key: fullKey } });
    } catch (e) {
      // Ignore if not found
    }
    this.cache.delete(fullKey);
  }

  async clear() {
    try {
      await this.prisma.heliactyl.deleteMany({
        where: { key: { startsWith: `${this.namespace}:` } }
      });
      this.cache.clear();
    } catch (e) {
      console.error(`DB Clear Error:`, e.message);
    }
  }

  async has(key) {
    const val = await this.get(key);
    return val !== undefined;
  }

  async getAll() {
    const results = {};
    try {
      const records = await this.prisma.heliactyl.findMany({
        where: { key: { startsWith: `${this.namespace}:` } }
      });

      for (const record of records) {
        const originalKey = record.key.replace(`${this.namespace}:`, "");
        const parsed = JSON.parse(record.value);
        
        if (parsed.expires && Date.now() > parsed.expires) {
          await this.delete(originalKey);
        } else {
          results[originalKey] = parsed.value;
          this.cache.set(record.key, parsed);
        }
      }
    } catch (e) {
      console.error(`DB GetAll Error:`, e.message);
    }
    return results;
  }

  async search(pattern) {
    try {
      const records = await this.prisma.heliactyl.findMany({
        where: { key: { startsWith: `${this.namespace}:` } },
        select: { key: true }
      });
      
      // Simple regex conversion for SQL LIKE matching
      const regexPattern = new RegExp("^" + pattern.replace(/%/g, ".*") + "$");
      
      return records
        .map(r => r.key.replace(`${this.namespace}:`, ""))
        .filter(k => regexPattern.test(k));
    } catch (e) {
      console.error(`DB Search Error:`, e.message);
      return [];
    }
  }

  async setMultiple(entries, ttl) {
    const transactions = [];
    
    for (const [key, value] of Object.entries(entries)) {
      const fullKey = `${this.namespace}:${key}`;
      const data = {
        value,
        expires: ttl ? Date.now() + ttl : undefined
      };
      
      transactions.push(
        this.prisma.heliactyl.upsert({
          where: { key: fullKey },
          update: { value: JSON.stringify(data) },
          create: { key: fullKey, value: JSON.stringify(data) }
        })
      );
      
      this.cache.set(fullKey, data);
    }

    try {
      await this.prisma.$transaction(transactions);
    } catch (e) {
      console.error(`DB SetMultiple Error:`, e.message);
    }
  }

  async increment(key, amount = 1) {
    const current = await this.get(key) || 0;
    const newValue = Number(current) + amount;
    await this.set(key, newValue);
    return newValue;
  }

  async decrement(key, amount = 1) {
    const current = await this.get(key) || 0;
    const newValue = Number(current) - amount;
    await this.set(key, newValue);
    return newValue;
  }

  async getCached(key, ttl) {
    return this.get(key);
  }

  async setCached(key, value, ttl) {
    return this.set(key, value, ttl);
  }

  clearCache(pattern) {
    if (!pattern) {
      this.cache.clear();
      return;
    }
    
    const regexPattern = new RegExp("^" + pattern.replace(/%/g, ".*") + "$");
    for (const [key, val] of this.cache.entries()) {
      const originalKey = key.replace(`${this.namespace}:`, "");
      if (regexPattern.test(originalKey)) {
        this.cache.delete(key);
      }
    }
  }

  async close() {
    await this.prisma.$disconnect();
  }
}

module.exports = HeliactylDB;

