const AUTO_BAN_REASON = 'Suspicious login detected: this IP address is already associated with a different Discord account.';
const AUTO_BAN_ACTOR = 'System (IP mismatch check)';
const net = require('net');
const {
  normalizeIp,
  getIpv6Subnet64,
  areIpsEquivalent,
  isUserAllowlisted
} = require('./antiVpnAllowlist');

function buildAutoBanReason({ userId, discordId, conflictingUserId, conflictingDiscordId, ipAddress }) {
  const details = [
    `Banned user ID: ${userId}`,
    `Banned Discord ID: ${discordId}`,
    `Conflicting user ID: ${conflictingUserId || 'unknown'}`,
    `Conflicting Discord ID: ${conflictingDiscordId || 'unknown'}`,
    `IP: ${ipAddress}`,
  ].join(' | ');

  return `${AUTO_BAN_REASON} ${details} If you believe this is a mistake, open a support ticket or create a Discord ticket for an unban review.`;
}

function createIpCheck(db) {
  async function checkAndRecordIp(clientIp, discordId, userId) {
    if (!clientIp || !discordId || !userId) {
      return { allowed: true };
    }

    const normalizedIp = normalizeIp(clientIp);
    if (!normalizedIp) {
      return { allowed: true };
    }

    if (await isUserAllowlisted(db, normalizedIp, userId)) {
      return { allowed: true, allowlistBypassed: true };
    }

    const isIpv6 = net.isIP(normalizedIp) === 6;
    let existingRecord = null;
    let subnet = null;

    if (isIpv6) {
      subnet = getIpv6Subnet64(normalizedIp);
      const conditions = [
        { ipAddress: { startsWith: subnet.expandedPrefix } },
        { ipAddress: { startsWith: subnet.shortPrefix } },
        { ipAddress: normalizedIp },
      ];

      existingRecord = await db.ipHistory.findFirst({
        where: {
          OR: conditions,
          NOT: { discordId },
        },
      });

      // Fallback check for any legacy or differently-formatted IPv6 records in the database
      if (!existingRecord) {
        const potentialRecords = await db.ipHistory.findMany({
          where: {
            ipAddress: { contains: ':' },
            NOT: { discordId },
          },
          take: 50,
          orderBy: { createdAt: 'desc' }
        });
        existingRecord = potentialRecords.find(r => areIpsEquivalent(r.ipAddress, normalizedIp)) || null;
      }
    } else {
      existingRecord = await db.ipHistory.findFirst({
        where: {
          ipAddress: normalizedIp,
          NOT: { discordId },
        },
      });
    }

    if (existingRecord) {
      const reason = buildAutoBanReason({
        userId,
        discordId,
        conflictingUserId: existingRecord.userId,
        conflictingDiscordId: existingRecord.discordId,
        ipAddress: normalizedIp,
      });

      await db.user.update({
        where: { id: userId },
        data: {
          isBanned: true,
          banReason: reason,
          bannedAt: new Date(),
          bannedByUserId: null,
          bannedByUsername: AUTO_BAN_ACTOR,
        },
      });

      return {
        allowed: false,
        reason,
      };
    }

    // For IPv6, record the expanded address so indexed prefix matching works across all devices in the /64 subnet
    const recordIp = isIpv6 && subnet ? subnet.expanded : normalizedIp;

    await db.ipHistory.upsert({
      where: {
        ipAddress_discordId: {
          ipAddress: recordIp,
          discordId,
        },
      },
      create: {
        ipAddress: recordIp,
        discordId,
        userId,
      },
      update: {
        userId,
      },
    });

    return { allowed: true };
  }

  return {
    checkAndRecordIp,
    AUTO_BAN_REASON,
    AUTO_BAN_ACTOR,
    buildAutoBanReason,
  };
}

module.exports = createIpCheck;
