const indexjs = require("../app.js");
const fs = require("fs");
const WebSocket = require('ws');
const loadConfig = require("../handlers/config.js");
const settings = loadConfig("./config.toml");
const log = require("../handlers/log.js");
const adminjs = require("./admin.js");
const { validate, schemas } = require("../handlers/validate.js");

const HeliactylModule = {
  "name": "Store",
  "version": "1.0.0",
  "api_level": 4,
  "target_platform": "10.0.0",
  "description": "Core module",
  "author": {
    "name": "Matt James",
    "email": "me@ether.pizza",
    "url": "https://ether.pizza"
  },
  "dependencies": [],
  "permissions": [],
  "routes": [],
  "config": {},
  "hooks": [],
  "tags": ['core'],
  "license": "MIT"
};

module.exports.HeliactylModule = HeliactylModule;

class AFKRewardsManager {
  constructor(db) {
    this.db = db;
    this.COINS_PER_MINUTE = 1; // Adjusted to Int for Prisma schema
    this.INTERVAL_MS = 60000;
    this.timeouts = new Map();
    this.stateTimeouts = new Map();
    this.sessions = new Map();
  }

  hasActiveSession(userId) {
    const session = this.sessions.get(userId);
    if (!session) return false;
    return Date.now() - session.lastUpdate < 60000;
  }

  createSession(userId, clusterId) {
    this.sessions.set(userId, {
      clusterId,
      lastReward: Date.now(),
      lastUpdate: Date.now()
    });
  }

  updateSession(userId) {
    const session = this.sessions.get(userId);
    if (session) {
      session.lastReward = Date.now();
      session.lastUpdate = Date.now();
    }
  }

  removeSession(userId) {
    this.sessions.delete(userId);
  }

  async processReward(userId, ws) {
    try {
      // Use atomic increment for coins
      await this.db.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: { 
            coins: { increment: this.COINS_PER_MINUTE },
            totalCoinsEarned: { increment: this.COINS_PER_MINUTE }
          }
        });

        await tx.transaction.create({
          data: {
            userId,
            type: 'afk',
            amount: this.COINS_PER_MINUTE,
            description: 'AFK Rewards'
          }
        });
      });

      this.updateSession(userId);
      this.sendState(userId, ws);
      this.scheduleNextReward(userId, ws);
    } catch (error) {
      console.error(`[ERROR] Failed to process reward for ${userId}:`, error);
      ws.close(4000, 'Failed to process reward');
    }
  }

  scheduleNextReward(userId, ws) {
    const timeout = setTimeout(() => {
      this.processReward(userId, ws);
    }, this.INTERVAL_MS);

    this.timeouts.set(userId, timeout);
  }

  getLastReward(userId) {
    return this.sessions.get(userId)?.lastReward || Date.now();
  }

  sendState(userId, ws) {
    const lastRewardTime = this.getLastReward(userId);
    const nextRewardIn = Math.max(0, this.INTERVAL_MS - (Date.now() - lastRewardTime));

    ws.send(JSON.stringify({
      type: 'afk_state',
      coinsPerMinute: this.COINS_PER_MINUTE,
      nextRewardIn,
      timestamp: Date.now()
    }));
  }

  startStateUpdates(userId, ws) {
    const updateState = () => {
      this.sendState(userId, ws);
      const timeout = setTimeout(updateState, 1000);
      this.stateTimeouts.set(userId, timeout);
    };
    updateState();
  }

  cleanup(userId) {
    const timeout = this.timeouts.get(userId);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(userId);
    }

    const stateTimeout = this.stateTimeouts.get(userId);
    if (stateTimeout) {
      clearTimeout(stateTimeout);
      this.stateTimeouts.delete(userId);
    }

    this.removeSession(userId);
  }
}

const RESOURCE_PRICES = {
  ram: settings?.api?.client?.coins?.store?.ram?.cost || 600,
  disk: settings?.api?.client?.coins?.store?.disk?.cost || 400,
  cpu: settings?.api?.client?.coins?.store?.cpu?.cost || 500,
  servers: settings?.api?.client?.coins?.store?.servers?.cost || 200
};

const RESOURCE_MULTIPLIERS = {
  ram: 1024,
  disk: 5120,
  cpu: 100,
  servers: 1
};

const MAX_RESOURCE_LIMITS = {
  ram: 96,
  disk: 200,
  cpu: 36,
  servers: 20
};

class StoreError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
  }
}

class Store {
  constructor(db) {
    this.db = db;
  }

  validateResourceAmount(resourceType, amount) {
    if (!RESOURCE_PRICES[resourceType]) throw new StoreError('Invalid resource type', 'INVALID_RESOURCE');
    if (!Number.isInteger(amount) || amount < 1) throw new StoreError('Amount must be a positive integer', 'INVALID_AMOUNT');
    return true;
  }

  async updateResourceLimits(userId, resourceType, amount) {
    const fieldMap = {
      ram: 'extraRam',
      disk: 'extraDisk',
      cpu: 'extraCpu',
      servers: 'extraServers'
    };
    const field = fieldMap[resourceType];
    const actualAmount = amount * RESOURCE_MULTIPLIERS[resourceType];

    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { [field]: true }
    });

    const currentAmount = user?.[field] ?? 0;
    const newAmount = currentAmount + actualAmount;

    const maxLimit = MAX_RESOURCE_LIMITS[resourceType] * RESOURCE_MULTIPLIERS[resourceType];
    if (newAmount > maxLimit) {
      throw new StoreError(`Resource limit exceeded`, 'RESOURCE_LIMIT_EXCEEDED');
    }

    const updatedUser = await this.db.user.update({
      where: { id: userId },
      data: { [field]: { increment: actualAmount } }
    });

    return {
      ram: updatedUser.extraRam,
      disk: updatedUser.extraDisk,
      cpu: updatedUser.extraCpu,
      servers: updatedUser.extraServers
    };
  }

  async logPurchase(userId, resourceType, amount, cost) {
    return await this.db.transaction.create({
      data: {
        userId,
        type: 'store_purchase',
        amount: -cost,
        description: `Bought ${amount} ${resourceType}`,
        details: JSON.stringify({
          resource: resourceType,
          amount: amount,
          cost: cost
        })
      }
    });
  }
}

module.exports.load = function (app, db) {
  const afkManager = new AFKRewardsManager(db);
  const clusterId = process.env.CLUSTER_ID || `cluster-${Math.random().toString(36).substring(7)}`;
  const store = new Store(db);

  app.ws('/ws', async function (ws, req) {
    if (!req.session?.userinfo) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    const userId = req.session.userinfo.id;

    try {
      if (afkManager.hasActiveSession(userId)) {
        ws.close(4002, 'Already connected');
        return;
      }

      afkManager.createSession(userId, clusterId);
      afkManager.scheduleNextReward(userId, ws);
      afkManager.startStateUpdates(userId, ws);

      ws.on('close', () => {
        afkManager.cleanup(userId);
      });

    } catch (error) {
      console.error(`[ERROR] Failed to setup AFK session for ${userId}:`, error);
      ws.close(4000, 'Failed to setup AFK session');
    }
  });

  app.get('/api/store/config', async (req, res) => {
    try {
      if (!req.session?.userinfo) return res.status(401).json({ error: 'Unauthorized' });

      const userId = req.session.userinfo.id;
      const user = await db.user.findUnique({ where: { id: userId }, select: { coins: true } });
      const userCoins = user?.coins ?? 0;

      const configResponse = {
        prices: {
          resources: RESOURCE_PRICES
        },
        multipliers: RESOURCE_MULTIPLIERS,
        limits: MAX_RESOURCE_LIMITS,
        userBalance: userCoins,
        canAfford: {
          ram: userCoins >= RESOURCE_PRICES.ram,
          disk: userCoins >= RESOURCE_PRICES.disk,
          cpu: userCoins >= RESOURCE_PRICES.cpu,
          servers: userCoins >= RESOURCE_PRICES.servers
        }
      };

      res.json(configResponse);

    } catch (error) {
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });

  app.post('/api/store/buy', validate(schemas.storeBuy), async (req, res) => {
    try {
      if (!req.session?.userinfo) return res.status(401).json({ error: 'Unauthorized' });

      const userId = req.session.userinfo.id;
      const { resourceType, amount } = req.body;

      const cost = RESOURCE_PRICES[resourceType] * amount;
      const user = await db.user.findUnique({ where: { id: userId }, select: { coins: true } });
      const userCoins = user?.coins ?? 0;

      if (userCoins < cost) {
        return res.status(402).json({
          error: 'Insufficient funds',
          required: cost,
          balance: userCoins
        });
      }

      const updatedResources = await store.updateResourceLimits(userId, resourceType, amount);
      const newBalance = userCoins - cost;
      
      await db.user.update({
        where: { id: userId },
        data: { coins: newBalance }
      });

      const purchase = await store.logPurchase(userId, resourceType, amount, cost);

      res.json({
        success: true,
        purchase,
        resources: updatedResources,
        remainingCoins: newBalance
      });

    } catch (error) {
      if (error instanceof StoreError) {
        return res.status(400).json({ error: error.message, code: error.code });
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/store/history', async (req, res) => {
    try {
      if (!req.session?.userinfo) return res.status(401).json({ error: 'Unauthorized' });
      const history = await db.transaction.findMany({
        where: { userId: req.session.userinfo.id, type: 'store_purchase' },
        orderBy: { createdAt: 'desc' }
      });
      res.json(history.map(h => ({
        ...h,
        ...JSON.parse(h.details || '{}')
      })));
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/store/resources', async (req, res) => {
    try {
      if (!req.session?.userinfo) return res.status(401).json({ error: 'Unauthorized' });
      const user = await db.user.findUnique({
        where: { id: req.session.userinfo.id },
        select: { extraRam: true, extraDisk: true, extraCpu: true, extraServers: true }
      });
      res.json({
        ram: user?.extraRam ?? 0,
        disk: user?.extraDisk ?? 0,
        cpu: user?.extraCpu ?? 0,
        servers: user?.extraServers ?? 0
      });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get("/buyram", async (req, res) => {
    let newsettings = await enabledCheck(req, res);
    if (newsettings) {
      let amount = req.query.amount;
      if (!amount) return res.send("missing amount");
      amount = parseFloat(amount);
      if (isNaN(amount)) return res.send("amount is not a number");
      if (amount < 1 || amount > 10) return res.send("amount must be 1-10");

      let theme = indexjs.get(req);
      let failedcallback = theme.settings.redirect.failedpurchaseram ? theme.settings.redirect.failedpurchaseram : "/";

      const user = await db.user.findUnique({ where: { id: req.session.userinfo.id } });
      let usercoins = user?.coins ?? 0;
      let ramcap = Math.floor((user?.extraRam ?? 0) / 1024);

      if (ramcap + amount > settings.storelimits.ram) return res.redirect(failedcallback + "?err=MAXRAMEXCEETED");

      let per = newsettings.api.client.coins.store.ram.per * amount;
      let cost = newsettings.api.client.coins.store.ram.cost * amount;

      if (usercoins < cost) return res.redirect(failedcallback + "?err=CANNOTAFFORD");

      let newusercoins = usercoins - cost;
      
      await db.user.update({
        where: { id: req.session.userinfo.id },
        data: {
          coins: newusercoins,
          extraRam: { increment: per }
        }
      });

      adminjs.suspend(req.session.userinfo.id, settings, db);
      log(`Resources Purchased`, `${req.session.userinfo.username}#${req.session.userinfo.discriminator} bought ${per}MB ram from the store for \`${cost}\` Credits.`);
      res.redirect((theme.settings.redirect.purchaseram ? theme.settings.redirect.purchaseram : "/") + "?err=none");
    }
  });

  app.get("/buydisk", async (req, res) => {
    let newsettings = await enabledCheck(req, res);
    if (newsettings) {
      let amount = req.query.amount;
      if (!amount) return res.send("missing amount");
      amount = parseFloat(amount);
      if (isNaN(amount)) return res.send("amount is not a number");
      if (amount < 1 || amount > 10) return res.send("amount must be 1-10");

      let theme = indexjs.get(req);
      let failedcallback = theme.settings.redirect.failedpurchasedisk ? theme.settings.redirect.failedpurchasedisk : "/";

      const user = await db.user.findUnique({ where: { id: req.session.userinfo.id } });
      let usercoins = user?.coins ?? 0;
      let diskcap = Math.floor((user?.extraDisk ?? 0) / 5120);

      if (diskcap + amount > settings.storelimits.disk) return res.redirect(failedcallback + "?err=MAXDISKEXCEETED");

      let per = newsettings.api.client.coins.store.disk.per * amount;
      let cost = newsettings.api.client.coins.store.disk.cost * amount;

      if (usercoins < cost) return res.redirect(failedcallback + "?err=CANNOTAFFORD");

      let newusercoins = usercoins - cost;

      await db.user.update({
        where: { id: req.session.userinfo.id },
        data: {
          coins: newusercoins,
          extraDisk: { increment: per }
        }
      });

      adminjs.suspend(req.session.userinfo.id, settings, db);
      log(`Resources Purchased`, `${req.session.userinfo.username}#${req.session.userinfo.discriminator} bought ${per}MB disk from the store for \`${cost}\` Credits.`);
      res.redirect((theme.settings.redirect.purchasedisk ? theme.settings.redirect.purchasedisk : "/") + "?err=none");
    }
  });

  app.get("/buycpu", async (req, res) => {
    let newsettings = await enabledCheck(req, res);
    if (newsettings) {
      let amount = req.query.amount;
      if (!amount) return res.send("missing amount");
      amount = parseFloat(amount);
      if (isNaN(amount)) return res.send("amount is not a number");
      if (amount < 1 || amount > 10) return res.send("amount must be 1-10");

      let theme = indexjs.get(req);
      let failedcallback = theme.settings.redirect.failedpurchasecpu ? theme.settings.redirect.failedpurchasecpu : "/";

      const user = await db.user.findUnique({ where: { id: req.session.userinfo.id } });
      let usercoins = user?.coins ?? 0;
      let cpucap = Math.floor((user?.extraCpu ?? 0) / 100);

      if (cpucap + amount > settings.storelimits.cpu) return res.redirect(failedcallback + "?err=MAXCPUEXCEETED");

      let per = newsettings.api.client.coins.store.cpu.per * amount;
      let cost = newsettings.api.client.coins.store.cpu.cost * amount;

      if (usercoins < cost) return res.redirect(failedcallback + "?err=CANNOTAFFORD");

      let newusercoins = usercoins - cost;

      await db.user.update({
        where: { id: req.session.userinfo.id },
        data: {
          coins: newusercoins,
          extraCpu: { increment: per }
        }
      });

      adminjs.suspend(req.session.userinfo.id, settings, db);
      log(`Resources Purchased`, `${req.session.userinfo.username}#${req.session.userinfo.discriminator} bought ${per}% CPU from the store for \`${cost}\` Credits.`);
      res.redirect((theme.settings.redirect.purchasecpu ? theme.settings.redirect.purchasecpu : "/") + "?err=none");
    }
  });

  app.get("/buyservers", async (req, res) => {
    let newsettings = await enabledCheck(req, res);
    if (newsettings) {
      let amount = req.query.amount;
      if (!amount) return res.send("missing amount");
      amount = parseFloat(amount);
      if (isNaN(amount)) return res.send("amount is not a number");
      if (amount < 1 || amount > 10) return res.send("amount must be 1-10");

      let theme = indexjs.get(req);
      let failedcallback = theme.settings.redirect.failedpurchaseservers ? theme.settings.redirect.failedpurchaseservers : "/";

      const user = await db.user.findUnique({ where: { id: req.session.userinfo.id } });
      let usercoins = user?.coins ?? 0;
      let serverscap = user?.extraServers ?? 0;

      if (serverscap + amount > settings.storelimits.servers) return res.redirect(failedcallback + "?err=MAXSERVERSEXCEETED");

      let per = newsettings.api.client.coins.store.servers.per * amount;
      let cost = newsettings.api.client.coins.store.servers.cost * amount;

      if (usercoins < cost) return res.redirect(failedcallback + "?err=CANNOTAFFORD");

      let newusercoins = usercoins - cost;

      await db.user.update({
        where: { id: req.session.userinfo.id },
        data: {
          coins: newusercoins,
          extraServers: { increment: per }
        }
      });

      adminjs.suspend(req.session.userinfo.id, settings, db);
      log(`Resources Purchased`, `${req.session.userinfo.username}#${req.session.userinfo.discriminator} bought ${per} Slots from the store for \`${cost}\` Credits.`);
      res.redirect((theme.settings.redirect.purchaseservers ? theme.settings.redirect.purchaseservers : "/") + "?err=none");
    }
  });

  async function enabledCheck(req, res) {
    let newsettings = loadConfig("./config.toml");
    if (newsettings.api.client.coins.store.enabled === true) return newsettings;
    let theme = indexjs.get(req);
    // Note: ejs is not defined in this scope, but the original code used it. 
    // Assuming it's globally available or handled by indexjs.
    return null;
  }
};
