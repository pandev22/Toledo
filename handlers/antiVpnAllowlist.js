const net = require('net');

function normalizeIp(ipAddress) {
  if (!ipAddress) return null;

  const firstIp = String(ipAddress).split(',')[0].trim();
  const normalized = firstIp.startsWith('::ffff:') ? firstIp.slice(7) : firstIp;

  return net.isIP(normalized) ? normalized : null;
}

function getClientIp(req) {
  return normalizeIp(req.headers['x-forwarded-for'] || req.socket.remoteAddress);
}

async function findUserAllowlistEntry(db, ipAddress, userId) {
  const normalizedIp = normalizeIp(ipAddress);
  if (!normalizedIp || !userId) return null;

  return db.antiVpnAllowlist.findFirst({
    where: {
      ipAddress: normalizedIp,
      users: {
        some: { userId }
      }
    },
    select: {
      id: true,
      ipAddress: true,
      reason: true
    }
  });
}

async function isUserAllowlisted(db, ipAddress, userId) {
  return Boolean(await findUserAllowlistEntry(db, ipAddress, userId));
}

module.exports = {
  normalizeIp,
  getClientIp,
  findUserAllowlistEntry,
  isUserAllowlisted
};
