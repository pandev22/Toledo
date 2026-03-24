const axios = require('axios');
const loadConfig = require('./config');

const settings = loadConfig('./config.toml');

function createAuthz(db) {
  const pteroApi = axios.create({
    baseURL: settings.pterodactyl.domain,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${settings.pterodactyl.key}`,
    },
  });

  function getSessionUser(req) {
    return req.session?.userinfo || null;
  }

  function getPterodactylUser(req) {
    return req.session?.pterodactyl || null;
  }

  function hasUserSession(req) {
    return Boolean(getSessionUser(req));
  }

  function hasPterodactylSession(req) {
    return Boolean(getPterodactylUser(req));
  }

  function requireSession(req, res, next) {
    if (!hasUserSession(req)) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    next();
  }

  function requirePterodactylSession(req, res, next) {
    if (!hasPterodactylSession(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    next();
  }

  async function getAdminStatus(req) {
    if (!hasUserSession(req) || !hasPterodactylSession(req)) {
      return false;
    }

    const cacheKey = 'adminStatusCache';
    const cacheExpiry = 60 * 1000;
    const cached = req.session?.[cacheKey];

    if (cached?.timestamp && Date.now() - cached.timestamp < cacheExpiry) {
      return cached.isAdmin === true;
    }

    try {
      const sessionUser = getSessionUser(req);
      const user = await db.user.findUnique({
        where: { id: sessionUser.id },
        select: { pterodactylId: true },
      });

      if (!user?.pterodactylId) {
        req.session[cacheKey] = { isAdmin: false, timestamp: Date.now() };
        return false;
      }

      const response = await pteroApi.get(`/api/application/users/${user.pterodactylId}?include=servers`);
      const isAdmin = response.data?.attributes?.root_admin === true;

      req.session[cacheKey] = {
        isAdmin,
        timestamp: Date.now(),
      };

      return isAdmin;
    } catch (error) {
      return false;
    }
  }

  async function requireAdmin(req, res, next) {
    if (!await getAdminStatus(req)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    next();
  }

  function clearAdminCache(req) {
    if (req.session?.adminStatusCache) {
      delete req.session.adminStatusCache;
    }
  }

  return {
    getSessionUser,
    getPterodactylUser,
    hasUserSession,
    hasPterodactylSession,
    requireSession,
    requirePterodactylSession,
    getAdminStatus,
    requireAdmin,
    clearAdminCache,
  };
}

module.exports = createAuthz;
