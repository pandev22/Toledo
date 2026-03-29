const SFTP_IP_MODE_KEY = 'sftp-ip-mode';
const DEFAULT_SFTP_IP_MODE = 'node';
const SFTP_IP_MODES = new Set(['node', 'allocation']);

function normalizeSftpIpMode(mode) {
  if (typeof mode !== 'string') {
    return DEFAULT_SFTP_IP_MODE;
  }

  return SFTP_IP_MODES.has(mode) ? mode : DEFAULT_SFTP_IP_MODE;
}

async function getSftpIpMode(db) {
  const result = await db.heliactyl.findUnique({ where: { key: SFTP_IP_MODE_KEY } });

  if (!result?.value) {
    return DEFAULT_SFTP_IP_MODE;
  }

  try {
    const parsed = JSON.parse(result.value);
    return normalizeSftpIpMode(parsed?.mode);
  } catch {
    return normalizeSftpIpMode(result.value);
  }
}

async function setSftpIpMode(db, mode) {
  const normalizedMode = normalizeSftpIpMode(mode);

  await db.heliactyl.upsert({
    where: { key: SFTP_IP_MODE_KEY },
    create: {
      key: SFTP_IP_MODE_KEY,
      value: JSON.stringify({ mode: normalizedMode }),
    },
    update: {
      value: JSON.stringify({ mode: normalizedMode }),
    },
  });

  return normalizedMode;
}

function getPrimaryAllocation(server) {
  const source = server?.attributes && typeof server.attributes === 'object'
    ? server.attributes
    : server;
  const allocations = source?.relationships?.allocations?.data;

  if (!Array.isArray(allocations) || allocations.length === 0) {
    return null;
  }

  return allocations.find((allocation) => allocation?.attributes?.is_default) || allocations[0];
}

function resolveSftpHost(server, mode) {
  const normalizedMode = normalizeSftpIpMode(mode);
  const source = server?.attributes && typeof server.attributes === 'object'
    ? server.attributes
    : server;

  if (normalizedMode === 'allocation') {
    const allocation = getPrimaryAllocation(source);
    const allocationIp = allocation?.attributes?.ip_alias || allocation?.attributes?.ip;

    if (allocationIp) {
      return allocationIp;
    }
  }

  return source?.sftp_details?.ip || null;
}

function applySftpIpMode(server, mode) {
  if (!server || typeof server !== 'object') {
    return server;
  }

  const normalizedMode = normalizeSftpIpMode(mode);
  const resolvedHost = resolveSftpHost(server, normalizedMode);

  if (server?.attributes && typeof server.attributes === 'object') {
    return {
      ...server,
      attributes: {
        ...server.attributes,
        sftp_details: {
          ...(server.attributes.sftp_details || {}),
          ip: resolvedHost,
          mode: normalizedMode,
        },
      },
    };
  }

  return {
    ...server,
    sftp_details: {
      ...(server.sftp_details || {}),
      ip: resolvedHost,
      mode: normalizedMode,
    },
  };
}

module.exports = {
  SFTP_IP_MODE_KEY,
  DEFAULT_SFTP_IP_MODE,
  SFTP_IP_MODES: Array.from(SFTP_IP_MODES),
  normalizeSftpIpMode,
  getSftpIpMode,
  setSftpIpMode,
  resolveSftpHost,
  applySftpIpMode,
};
