const loadConfig = require("../handlers/config");
const settings = loadConfig("./config.toml");
const getPteroUser = require("../handlers/getPteroUser");
const cache = require("../handlers/cache");
const axios = require("axios");
const LRU = require("lru-cache");

const pteroApi = axios.create({
  baseURL: settings.pterodactyl.domain,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': `Bearer ${settings.pterodactyl.key}`
  }
});

const settingsCache = new LRU({
  max: 1,
  ttl: 1000 * 30 // 30s
});

function getPublicSettings() {
  const cached = settingsCache.get('public');
  if (cached) return cached;

  const payload = {
    name: settings.website.name || "Heliactyl",
    logo: settings.website.logo || "https://i.imgur.com/gUUze6A.png",
    domain: settings.website.domain,
    pterodactyl: settings.pterodactyl.domain,
    features: {
      coinTransfer: settings.api?.client?.coins?.transfer?.enabled ?? true,
      boosts: settings.api?.client?.coins?.boosts?.enabled ?? true,
    }
  };
  settingsCache.set('public', payload);
  return payload;
}

const HeliactylModule = {
  "name": "API v5",
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

/* Module */
module.exports.HeliactylModule = HeliactylModule;
module.exports.load = async function (app, db) {
  app.get('/api/v5/state', async (req, res) => {
    try {
      // Check if user is authenticated
      if (!req.session || !req.session.userinfo) {
        return res.status(401).json({
          authenticated: false,
          message: 'Not authenticated'
        });
      }

      // Check if 2FA verification is pending
      const twoFactorPending = !!req.session.twoFactorPending;

      // Get user data
      const userId = req.session.userinfo.id;
      const userData = req.session.userinfo;

      // Get 2FA status
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { twoFactorEnabled: true }
      });
      const twoFactorEnabled = user?.twoFactorEnabled || false;

      // Return authentication state
      return res.json({
        authenticated: !twoFactorPending,
        twoFactorPending: twoFactorPending,
        twoFactorEnabled: twoFactorEnabled,
        site_name: settings.website.name || "Heliactyl",
        user: {
          id: userData.id,
          username: userData.username,
          email: userData.email
        }
      });
    } catch (error) {
      console.error('Error in auth state check:', error);
      return res.status(500).json({
        authenticated: false,
        message: 'Internal server error'
      });
    }
  });

  app.get("/api/v5/settings", async (req, res) => {
    res.json(getPublicSettings());
  });

  app.get("/api/coins", async (req, res) => {
    if (!req.session.userinfo) {
      return res.status(401).json({
        error: "Not authenticated"
      });
    }
    const userId = req.session.userinfo.id;
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { coins: true }
    });
    const coins = user?.coins || 0;
    res.json({
      coins,
      index: 0
    });
  });

  // User
  app.get("/api/user", async (req, res) => {
    if (!req.session.userinfo) {
      return res.status(401).json({
        error: "Not authenticated"
      });
    }
    res.json(req.session.userinfo);
  });

  app.get("/api/remote/user", async (req, res) => {
    if (!req.session.pterodactyl) {
      return res.status(401).json({
        error: "Not authenticated"
      });
    }
    res.json({
      user: {
        Id: req.session.pterodactyl.id,
        Username: req.session.pterodactyl.username,
        Email: req.session.pterodactyl.email
      },
      Index: 0
    });
  });

  // Consolidated init endpoint - replaces 5+ separate calls on page load
  app.get("/api/v5/init", async (req, res) => {
    try {
      if (!req.session || !req.session.userinfo) {
        return res.status(401).json({
          authenticated: false,
          message: 'Not authenticated'
        });
      }

      const userId = req.session.userinfo.id;
      const userData = req.session.userinfo;
      const twoFactorPending = !!req.session.twoFactorPending;

      // Batch all DB reads in a single query
      const [userRecord, subuserServersFromPtero, subuserServersFromUserId] = await Promise.all([
        db.user.findUnique({
          where: { id: userId },
          select: { twoFactorEnabled: true, coins: true, pterodactylId: true }
        }),
        req.session.pterodactyl ? db.subuserServer.findMany({
          where: { user: { pteroUsername: req.session.pterodactyl.username }, source: 'subuser' }
        }) : Promise.resolve([]),
        req.session.pterodactyl ? db.subuserServer.findMany({
          where: { userId, source: 'subuser' }
        }) : Promise.resolve([])
      ]);

      // 2FA
      const twoFactorEnabled = userRecord?.twoFactorEnabled || false;

      // Coins
      const coins = userRecord?.coins || 0;

      // Admin check (uses session cache like original)
      let isAdmin = false;
      const cacheKey = 'adminStatusCache';
      const cacheExpiry = 5 * 60 * 1000;
      if (req.session[cacheKey] && req.session[cacheKey].timestamp) {
        const age = Date.now() - req.session[cacheKey].timestamp;
        if (age < cacheExpiry) {
          isAdmin = req.session[cacheKey].isAdmin;
        }
      }
      if (!isAdmin && req.session.pterodactyl) {
        try {
          const pteroUserId = userRecord?.pterodactylId;
          if (pteroUserId) {
            const adminRes = await pteroApi.get(`/api/application/users/${pteroUserId}?include=servers`);
            isAdmin = adminRes.data.attributes.root_admin === true;
            req.session[cacheKey] = { isAdmin, timestamp: Date.now() };
          }
        } catch (e) { /* not admin */ }
      }

      // Servers (uses existing cache layer)
      let servers = [];
      let subuserServers = [];
      try {
        const user = await cache.getOrSet(
          `ptero:user:${userId}:servers`,
          () => getPteroUser(userId, db),
          300
        );
        if (user) {
          servers = user.attributes.relationships.servers.data;
        }
      } catch (e) { /* servers failed, non-blocking */ }

      // Subuser servers
      if (req.session.pterodactyl) {
        const pteroSubs = subuserServersFromPtero || [];
        const discordSubs = subuserServersFromUserId || [];
        const serverIds = new Set(pteroSubs.map(s => s.serverId));
        subuserServers = [...pteroSubs];
        discordSubs.forEach(s => {
          if (!serverIds.has(s.serverId)) {
            subuserServers.push(s);
            serverIds.add(s.serverId);
          }
        });
      }

      res.json({
        state: {
          authenticated: !twoFactorPending,
          twoFactorPending,
          twoFactorEnabled,
          site_name: settings.website.name || "Heliactyl"
        },
        user: {
          id: userData.id,
          username: userData.username,
          email: userData.email,
          global_name: userData.global_name || userData.username
        },
        coins,
        admin: isAdmin,
        settings: getPublicSettings(),
        servers,
        subuserServers
      });
    } catch (error) {
      console.error('Error in /api/v5/init:', error);
      return res.status(500).json({
        authenticated: false,
        message: 'Internal server error'
      });
    }
  });
};
