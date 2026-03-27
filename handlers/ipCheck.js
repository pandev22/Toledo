const AUTO_BAN_REASON = 'Suspicious login detected: this IP address is already associated with a different Discord account. If you believe this is a mistake, open a support ticket or create a Discord ticket for an unban review.';
const AUTO_BAN_ACTOR = 'System (IP mismatch check)';

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
      await db.user.update({
        where: { id: userId },
        data: {
          isBanned: true,
          banReason: AUTO_BAN_REASON,
          bannedAt: new Date(),
          bannedByUserId: null,
          bannedByUsername: AUTO_BAN_ACTOR,
        },
      });

      return {
        allowed: false,
        reason: AUTO_BAN_REASON,
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
  };
}

module.exports = createIpCheck;
