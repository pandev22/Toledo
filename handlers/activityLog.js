function getSessionUser(req) {
  return req?.session?.userinfo || null;
}

function serializeDetails(details) {
  if (details === undefined) {
    return null;
  }

  if (typeof details === 'string') {
    return details;
  }

  try {
    return JSON.stringify(details);
  } catch (error) {
    return JSON.stringify({ error: 'Failed to serialize activity log details' });
  }
}

async function recordServerActivity(db, req, serverId, action, details) {
  if (!db?.activityLog || !serverId || !action) {
    return null;
  }

  const sessionUser = getSessionUser(req);

  try {
    return await db.activityLog.create({
      data: {
        serverId,
        userId: sessionUser?.id || null,
        username: sessionUser?.username || null,
        action,
        details: serializeDetails(details),
      },
    });
  } catch (error) {
    console.error('Failed to record server activity log:', error);
    return null;
  }
}

module.exports = {
  recordServerActivity,
};
