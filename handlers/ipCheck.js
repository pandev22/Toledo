const AUTO_BAN_REASON = 'Suspicious login detected: this IP address is already associated with a different Discord account.';
const AUTO_BAN_ACTOR = 'System (IP mismatch check)';

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

    const normalizedIp = String(clientIp).trim();
    if (!normalizedIp) {
      return { allowed: true };
    }

    const existingRecord = await db.ipHistory.findFirst({
      where: {
        ipAddress: normalizedIp,
        NOT: { discordId },
      },
    });

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

    await db.ipHistory.upsert({
      where: {
        ipAddress_discordId: {
          ipAddress: normalizedIp,
          discordId,
        },
      },
      create: {
        ipAddress: normalizedIp,
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
