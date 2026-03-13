const express = require("express");
const axios = require("axios");
const loadConfig = require("../../handlers/config");
const cache = require("../../handlers/cache");
const { isAuthenticated, ownsServer, PANEL_URL, API_KEY, ADMIN_KEY } = require("./core.js");

const settings = loadConfig("./config.toml");

const HeliactylModule = {
  name: "Server -> Renewals",
  version: "1.0.0",
  api_level: 4,
  target_platform: "10.0.0",
  description: "Configurable server renewal and expiration management",
  author: {
    name: "Matt James",
    email: "me@ether.pizza",
    url: "https://ether.pizza"
  },
  dependencies: [],
  permissions: [],
  routes: [],
  config: {},
  hooks: [],
  tags: ["core"],
  license: "MIT"
};

const RENEWAL_KEY_PREFIX = "server-renewal:";
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_SYNC_INTERVAL_MS = 12 * HOUR_MS;

let maintenanceDb = null;
let renewalTicker = null;
let maintenanceRunning = false;
let lastCheckAt = 0;
let lastSyncAt = 0;

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function toNonNegativeInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback;
}

function getRenewalConfig() {
  const renewal = settings.renewal || {};

  return {
    enabled: renewal.enabled ?? true,
    renewalPeriodDays: toPositiveInt(renewal.renewal_period_days, 2),
    renewalWindowHours: toPositiveInt(renewal.renewal_window_hours, 24),
    checkIntervalMinutes: toPositiveInt(renewal.check_interval_minutes, 5),
    autoDeleteEnabled: renewal.auto_delete_enabled ?? true,
    autoDeleteAfterDays: toPositiveInt(renewal.auto_delete_after_days, 7),
    apiDelayMs: toNonNegativeInt(renewal.api_delay_ms, 1000)
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRenewalKey(identifier) {
  return `${RENEWAL_KEY_PREFIX}${identifier}`;
}

function isValidDateString(value) {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function stripLegacyBypassFields(record) {
  const nextRecord = { ...record };
  let changed = false;

  for (const key of Object.keys(nextRecord)) {
    if (key.toLowerCase().includes("bypass")) {
      delete nextRecord[key];
      changed = true;
    }
  }

  return { record: nextRecord, changed };
}

function formatDuration(ms) {
  const safeMs = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safeMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return {
    totalMs: safeMs,
    totalSeconds,
    days,
    hours,
    minutes,
    seconds
  };
}

function parseRenewalRow(row) {
  try {
    return JSON.parse(row.value);
  } catch (error) {
    console.error(`[Renewal] Failed to parse record ${row.key}:`, error.message);
    return null;
  }
}

async function writeRenewalRecord(db, identifier, data) {
  const payload = {
    ...data,
    serverIdentifier: identifier,
    updatedAt: new Date().toISOString()
  };

  await db.heliactyl.upsert({
    where: { key: getRenewalKey(identifier) },
    update: { value: JSON.stringify(payload) },
    create: {
      key: getRenewalKey(identifier),
      value: JSON.stringify(payload)
    }
  });

  return payload;
}

async function readRenewalRecord(db, identifier) {
  const row = await db.heliactyl.findUnique({
    where: { key: getRenewalKey(identifier) }
  });

  if (!row) {
    return null;
  }

  const parsed = parseRenewalRow(row);
  if (parsed) {
    return parsed;
  }

  await db.heliactyl.delete({ where: { key: row.key } }).catch(() => null);
  return null;
}

async function readAllRenewalRows(db) {
  return db.heliactyl.findMany({
    where: {
      key: {
        startsWith: RENEWAL_KEY_PREFIX
      }
    }
  });
}

async function removeRenewalRecordByIdentifier(db, identifier) {
  if (!identifier) {
    return false;
  }

  await db.heliactyl.delete({ where: { key: getRenewalKey(identifier) } }).catch(() => null);
  return true;
}

function buildRenewalDates(config, now) {
  return {
    lastRenewedAt: now.toISOString(),
    nextRenewalAt: new Date(now.getTime() + config.renewalPeriodDays * DAY_MS).toISOString()
  };
}

function createRenewalRecord(serverAttributes, userId, config) {
  const now = new Date();
  const renewalDates = buildRenewalDates(config, now);

  return {
    serverIdentifier: serverAttributes.identifier,
    panelId: serverAttributes.id ?? null,
    userId: userId ?? null,
    lastRenewedAt: renewalDates.lastRenewedAt,
    nextRenewalAt: renewalDates.nextRenewalAt,
    expiredAt: null,
    isActive: true,
    renewalCount: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

async function initializeServerRenewal(db, serverAttributes, userId = null) {
  if (!serverAttributes?.identifier) {
    return null;
  }

  const config = getRenewalConfig();
  const existing = await readRenewalRecord(db, serverAttributes.identifier);

  if (!existing) {
    const record = createRenewalRecord(serverAttributes, userId, config);
    return writeRenewalRecord(db, serverAttributes.identifier, record);
  }

  const sanitizedExisting = stripLegacyBypassFields(existing);
  const nextRecord = {
    ...sanitizedExisting.record,
    serverIdentifier: serverAttributes.identifier,
    panelId: serverAttributes.id ?? sanitizedExisting.record.panelId ?? null,
    userId: userId ?? sanitizedExisting.record.userId ?? null
  };

  let changed = sanitizedExisting.changed;

  if (!existing.serverIdentifier || existing.serverIdentifier !== serverAttributes.identifier) {
    changed = true;
  }

  if ((serverAttributes.id ?? null) !== (sanitizedExisting.record.panelId ?? null)) {
    changed = true;
  }

  if ((userId ?? sanitizedExisting.record.userId ?? null) !== (sanitizedExisting.record.userId ?? null)) {
    changed = true;
  }

  if (!isValidDateString(nextRecord.lastRenewedAt)) {
    nextRecord.lastRenewedAt = new Date().toISOString();
    changed = true;
  }

  if (!isValidDateString(nextRecord.nextRenewalAt)) {
    const renewalDates = buildRenewalDates(config, new Date());
    nextRecord.lastRenewedAt = renewalDates.lastRenewedAt;
    nextRecord.nextRenewalAt = renewalDates.nextRenewalAt;
    nextRecord.expiredAt = null;
    nextRecord.isActive = true;
    changed = true;
  }

  return changed ? writeRenewalRecord(db, serverAttributes.identifier, nextRecord) : existing;
}

async function removeServerRenewal(db, serverDetails = {}) {
  if (serverDetails.identifier) {
    return removeRenewalRecordByIdentifier(db, serverDetails.identifier);
  }

  if (!serverDetails.panelId) {
    return false;
  }

  const rows = await readAllRenewalRows(db);
  for (const row of rows) {
    const record = parseRenewalRow(row);
    if (record?.panelId?.toString() === serverDetails.panelId.toString()) {
      await db.heliactyl.delete({ where: { key: row.key } }).catch(() => null);
      return true;
    }
  }

  return false;
}

async function getRenewalRecord(db, identifier, fallbackUserId = null) {
  let record = await readRenewalRecord(db, identifier);

  if (!record) {
    if (fallbackUserId) {
      record = await initializeServerRenewal(db, { identifier }, fallbackUserId);
    } else {
      const owner = await resolveOwnerFromPanel(db, identifier);
      record = await initializeServerRenewal(db, { identifier, id: owner.panelId }, owner.userId);
    }
  }

  if (!record) {
    return null;
  }

  return initializeServerRenewal(db, {
    identifier: record.serverIdentifier,
    id: record.panelId
  }, record.userId);
}

function getDeletionDate(record, config) {
  if (!config.autoDeleteEnabled || !record.nextRenewalAt) {
    return null;
  }

  const baseDate = isValidDateString(record.expiredAt)
    ? new Date(record.expiredAt)
    : new Date(record.nextRenewalAt);

  return new Date(baseDate.getTime() + config.autoDeleteAfterDays * DAY_MS);
}

function buildStatusResponse(record) {
  const config = getRenewalConfig();
  const now = Date.now();
  const cleanRecord = stripLegacyBypassFields(record).record;
  const nextRenewalMs = record.nextRenewalAt ? new Date(record.nextRenewalAt).getTime() : null;
  const expiresInMs = nextRenewalMs === null ? null : nextRenewalMs - now;
  const deletionDate = getDeletionDate(record, config);
  const deletionMs = deletionDate ? deletionDate.getTime() - now : null;

  return {
    ...cleanRecord,
    isUnlimited: false,
    requiresRenewal: Boolean(config.enabled && expiresInMs !== null && expiresInMs <= config.renewalWindowHours * HOUR_MS),
    canRenew: Boolean(config.enabled && expiresInMs !== null && expiresInMs <= config.renewalWindowHours * HOUR_MS),
    isExpired: Boolean(expiresInMs !== null && expiresInMs <= 0),
    timeRemaining: expiresInMs === null ? null : formatDuration(Math.max(expiresInMs, 0)),
    overdue: expiresInMs === null ? null : formatDuration(Math.max(-expiresInMs, 0)),
    autoDeleteAt: deletionDate ? deletionDate.toISOString() : null,
    autoDeleteIn: deletionMs === null ? null : formatDuration(Math.max(deletionMs, 0)),
    config: {
      enabled: config.enabled,
      renewalPeriodDays: config.renewalPeriodDays,
      renewalWindowHours: config.renewalWindowHours,
      autoDeleteEnabled: config.autoDeleteEnabled,
      autoDeleteAfterDays: config.autoDeleteAfterDays,
      checkIntervalMinutes: config.checkIntervalMinutes
    }
  };
}

async function stopServer(serverIdentifier) {
  await axios.post(
    `${PANEL_URL}/api/client/servers/${serverIdentifier}/power`,
    { signal: "stop" },
    {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        Accept: "application/json",
        "Content-Type": "application/json"
      }
    }
  );
}

async function startServer(serverIdentifier) {
  await axios.post(
    `${PANEL_URL}/api/client/servers/${serverIdentifier}/power`,
    { signal: "start" },
    {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        Accept: "application/json",
        "Content-Type": "application/json"
      }
    }
  );
}

async function deleteServer(panelId) {
  await axios.delete(`${PANEL_URL}/api/application/servers/${panelId}/force`, {
    headers: {
      Authorization: `Bearer ${ADMIN_KEY}`,
      Accept: "application/json"
    }
  });
}

async function fetchAllPanelServers() {
  const servers = [];
  let page = 1;
  let totalPages = 1;

  do {
    const response = await axios.get(`${PANEL_URL}/api/application/servers`, {
      params: {
        page,
        per_page: 100
      },
      headers: {
        Authorization: `Bearer ${ADMIN_KEY}`,
        Accept: "application/json"
      }
    });

    servers.push(...response.data.data);
    totalPages = response.data.meta?.pagination?.total_pages || 1;
    page += 1;
  } while (page <= totalPages);

  return servers;
}

async function resolveOwnerFromPanel(db, identifier) {
  const panelServers = await fetchAllPanelServers();
  const matchingServer = panelServers.find((server) => server.attributes?.identifier === identifier);

  if (!matchingServer?.attributes) {
    return {
      userId: null,
      panelId: null
    };
  }

  const owner = await db.user.findFirst({
    where: {
      pterodactylId: matchingServer.attributes.user
    },
    select: {
      id: true
    }
  });

  return {
    userId: owner?.id ?? null,
    panelId: matchingServer.attributes.id ?? null
  };
}

async function syncRenewalRecords(db) {
  const panelServers = await fetchAllPanelServers();
  const identifiers = new Set();
  const pterodactylIds = [...new Set(
    panelServers
      .map((server) => server.attributes?.user)
      .filter((value) => Number.isInteger(value))
  )];

  const users = pterodactylIds.length > 0
    ? await db.user.findMany({
      where: {
        pterodactylId: {
          in: pterodactylIds
        }
      },
      select: {
        id: true,
        pterodactylId: true
      }
    })
    : [];

  const userMap = new Map(users.map((user) => [user.pterodactylId, user]));

  for (const server of panelServers) {
    const attributes = server.attributes;
    if (!attributes?.identifier) {
      continue;
    }

    identifiers.add(attributes.identifier);
    const owner = userMap.get(attributes.user);

    await initializeServerRenewal(db, attributes, owner?.id ?? null);
  }

  const rows = await readAllRenewalRows(db);
  for (const row of rows) {
    const record = parseRenewalRow(row);
    if (!record?.serverIdentifier || identifiers.has(record.serverIdentifier)) {
      continue;
    }

    await db.heliactyl.delete({ where: { key: row.key } }).catch(() => null);
  }
}

async function handleExpiredRecord(db, record, config) {
  if (!record.serverIdentifier || !record.nextRenewalAt) {
    return;
  }

  const now = new Date();
  const nextRenewalAt = new Date(record.nextRenewalAt);
  if (nextRenewalAt.getTime() > now.getTime()) {
    return;
  }

  const expiredAt = isValidDateString(record.expiredAt) ? new Date(record.expiredAt) : nextRenewalAt;
  const expiredForMs = now.getTime() - expiredAt.getTime();

  if (config.autoDeleteEnabled && expiredForMs >= config.autoDeleteAfterDays * DAY_MS) {
    if (record.panelId) {
      try {
        await deleteServer(record.panelId);
      } catch (error) {
        if (error.response?.status !== 404) {
          throw error;
        }
      }
    }

    await removeServerRenewal(db, {
      identifier: record.serverIdentifier,
      panelId: record.panelId
    });

    if (record.userId) {
      await cache.del(`ptero:user:${record.userId}:servers`);
    }

    return;
  }

  if (record.isActive === false) {
    return;
  }

  try {
    await stopServer(record.serverIdentifier);
  } catch (error) {
    if (error.response?.status === 404) {
      await removeServerRenewal(db, {
        identifier: record.serverIdentifier,
        panelId: record.panelId
      });
      return;
    }

    throw error;
  }

  await writeRenewalRecord(db, record.serverIdentifier, {
    ...record,
    expiredAt: expiredAt.toISOString(),
    isActive: false
  });
}

async function runRenewalMaintenance() {
  if (!maintenanceDb || maintenanceRunning) {
    return;
  }

  const config = getRenewalConfig();
  if (!config.enabled) {
    return;
  }

  const now = Date.now();
  if (now - lastCheckAt < config.checkIntervalMinutes * 60 * 1000) {
    return;
  }

  maintenanceRunning = true;
  lastCheckAt = now;

  try {
    if (now - lastSyncAt >= DEFAULT_SYNC_INTERVAL_MS) {
      await syncRenewalRecords(maintenanceDb);
      lastSyncAt = Date.now();
    }

    const rows = await readAllRenewalRows(maintenanceDb);
    for (const row of rows) {
      const parsed = parseRenewalRow(row);
      if (!parsed) {
        await maintenanceDb.heliactyl.delete({ where: { key: row.key } }).catch(() => null);
        continue;
      }

      const record = await initializeServerRenewal(maintenanceDb, {
        identifier: parsed.serverIdentifier,
        id: parsed.panelId
      }, parsed.userId);
      await handleExpiredRecord(maintenanceDb, record, config);

      if (config.apiDelayMs > 0) {
        await delay(config.apiDelayMs);
      }
    }
  } catch (error) {
    console.error("[Renewal] Maintenance failed:", error);
  } finally {
    maintenanceRunning = false;
  }
}

module.exports.HeliactylModule = HeliactylModule;
module.exports.initializeServerRenewal = initializeServerRenewal;
module.exports.removeServerRenewal = removeServerRenewal;

module.exports.load = async function (app, db) {
  maintenanceDb = db;

  const router = express.Router();

  router.get("/server/:id/renewal/status", isAuthenticated, ownsServer, async (req, res) => {
    try {
      const record = await getRenewalRecord(db, req.params.id);

      if (!record) {
        return res.status(404).json({ error: "Renewal data not found" });
      }

      res.json(buildStatusResponse(record));
    } catch (error) {
      console.error("[Renewal] Failed to get status:", error);
      res.status(500).json({ error: "Failed to get renewal status" });
    }
  });

  router.post("/server/:id/renewal/renew", isAuthenticated, ownsServer, async (req, res) => {
    try {
      const config = getRenewalConfig();
      if (!config.enabled) {
        return res.status(400).json({ error: "Renewal system is disabled" });
      }

      const currentRecord = await getRenewalRecord(db, req.params.id);
      if (!currentRecord) {
        return res.status(404).json({ error: "Renewal data not found" });
      }

      const now = new Date();
      const nextRenewalAt = new Date(currentRecord.nextRenewalAt);
      const renewWindowMs = config.renewalWindowHours * HOUR_MS;
      const remainingMs = nextRenewalAt.getTime() - now.getTime();

      if (remainingMs > renewWindowMs) {
        return res.status(400).json({
          error: "Renewal not available yet",
          availableIn: formatDuration(remainingMs - renewWindowMs),
          renewalData: buildStatusResponse(currentRecord)
        });
      }

      const renewalDates = buildRenewalDates(config, now);
      const updatedRecord = await writeRenewalRecord(db, currentRecord.serverIdentifier, {
        ...currentRecord,
        lastRenewedAt: renewalDates.lastRenewedAt,
        nextRenewalAt: renewalDates.nextRenewalAt,
        expiredAt: null,
        isActive: true,
        renewalCount: (currentRecord.renewalCount || 0) + 1
      });

      let restarted = false;
      if (currentRecord.isActive === false) {
        try {
          await startServer(currentRecord.serverIdentifier);
          restarted = true;
        } catch (error) {
          console.error("[Renewal] Failed to restart renewed server:", error.message);
        }
      }

      if (currentRecord.userId) {
        await cache.del(`ptero:user:${currentRecord.userId}:servers`);
      }

      res.json({
        message: "Server renewed successfully",
        restarted,
        renewalData: buildStatusResponse(updatedRecord)
      });
    } catch (error) {
      console.error("[Renewal] Failed to renew server:", error);
      res.status(500).json({ error: "Failed to renew server" });
    }
  });

  app.use("/api", router);

  if (!renewalTicker) {
    setTimeout(() => {
      runRenewalMaintenance().catch((error) => {
        console.error("[Renewal] Initial maintenance failed:", error);
      });
    }, 10_000);

    renewalTicker = setInterval(() => {
      runRenewalMaintenance().catch((error) => {
        console.error("[Renewal] Scheduled maintenance failed:", error);
      });
    }, 60 * 1000);
  }
};
