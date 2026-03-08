"use strict";

const fs = require("fs").promises;
const path = require("path");
const https = require("https");
const os = require("os");
const { exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);
const axios = require("axios");
const loadConfig = require("../handlers/config.js");
const createLogger = require("../handlers/console.js");

const settings = loadConfig("./config.toml");
const logger = createLogger();

// Pterodactyl API helper
const pteroApi = axios.create({
  baseURL: settings.pterodactyl.domain,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${settings.pterodactyl.key}`
  }
});

// Check admin status utility function
async function checkAdminStatus(req, res, db) {
  if (!req.session.pterodactyl) return false;

  const cacheKey = 'adminStatusCache';
  const cacheExpiry = 5 * 60 * 1000;

  if (req.session[cacheKey] && req.session[cacheKey].timestamp) {
    const age = Date.now() - req.session[cacheKey].timestamp;
    if (age < cacheExpiry) {
      return req.session[cacheKey].isAdmin;
    }
  }

  try {
    const pterodactylId = (await db.user.findUnique({ where: { id: req.session.userinfo.id }, select: { pterodactylId: true } }))?.pterodactylId;
    const response = await pteroApi.get(`/api/application/users/${pterodactylId}?include=servers`);
    const isAdmin = response.data.attributes.root_admin === true;

    req.session[cacheKey] = {
      isAdmin,
      timestamp: Date.now()
    };

    return isAdmin;
  } catch (error) {
    console.error("Error checking admin status:", error.message);
    return false;
  }
}


  const HeliactylModule = {
  name: "Updater",

  version: "1.0.0",
  api_level: 4,
  target_platform: "10.0.0",
  description: "Auto-update system — DB-based config, admin UI, per-server tracking",
  "author": {
    "name": "aachul123",
    "email": "ludo@overnode.fr",
    "url": "https://achul123.pages.dev/"
  },
  dependencies: [],
  permissions: [],
  routes: [],
  config: {},
  hooks: [],
  tags: ["core"],
  license: "MIT"
};

// DB keys
const DB_KEYS = {
  config: "updater:config",
  servers: "updater:servers"
};

// Default config (stored in DB, editable via admin UI)
const DEFAULT_CONFIG = {
  enabled: true,
  checkInterval: 30,
  webhookSecret: "",
  maxBackups: 3
};

// Files/dirs to never overwrite during server/ updates
const SERVER_EXCLUDE = new Set([
  "config.toml",
  "heliactyl.db",
  "heliactyl.db-shm",
  "heliactyl.db-wal",
  "sessions.db",
  "node_modules",
  "logs",
  "backups",
  "public",
  ".git"
]);

// Files/dirs to never overwrite during frontend/ updates
const FRONTEND_EXCLUDE = new Set([
  "node_modules",
  "dist",
  ".git"
]);

function shouldExclude(filename, excludeSet) {
  if (excludeSet.has(filename)) return true;
  if (filename.startsWith("temp_update") || filename.startsWith("backup_")) return true;
  return false;
}

/**
 * Sanitize git tag/release name to prevent command injection.
 * Only allows alphanumeric characters, dots, hyphens, and underscores.
 * Example: "v1.2.3", "release-1.0.0", "v2.0.0-rc1" are valid
 * @param {string} tag - The tag name to sanitize
 * @throws {Error} If tag contains unsafe characters
 * @returns {string} The sanitized tag
 */
function sanitizeGitTag(tag) {
  if (!tag || typeof tag !== 'string') {
    throw new Error("Tag must be a non-empty string");
  }
  
  // Allow only: alphanumeric, dots, hyphens, underscores, 'v' prefix
  if (!/^[a-zA-Z0-9._\-v]+$/.test(tag)) {
    throw new Error(`Invalid tag name: "${tag}". Only alphanumeric, dots, hyphens, underscores, and 'v' prefix allowed`);
  }
  
  return tag;
}

class UpdateManager {
  constructor(db) {
    this.db = db;
    this.repo = "re-heliactyl/toledo";
    this.githubApiUrl = `https://api.github.com/repos/${this.repo}/releases/latest`;
    this.serverDir = path.join(__dirname, "..");
    this.frontendDir = path.join(__dirname, "..", "..", "frontend");
    this.updating = false;
    this.hostname = os.hostname();

    try {
      this.currentVersion = require("../app").VERSION || settings.version || "0.0.0";
    } catch {
      this.currentVersion = settings.version || "0.0.0";
    }
  }

  async init(app) {
    // RELIABILITY: Clean up leftover directories from crashed/failed updates
    try {
      const tempDir = path.join(this.serverDir, "temp_update");
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      logger.info("Cleaned up leftover temp_update directory");
    } catch (error) {
      logger.warn("Could not clean temp_update directory:", error.message);
    }

    // Clean up old backup directories that might be orphaned (optional)
    try {
      const entries = await fs.readdir(this.serverDir).catch(() => []);
      const orphanedBackups = entries.filter(e => e.startsWith("backup_"));
      
      if (orphanedBackups.length > 0) {
        logger.info(`Found ${orphanedBackups.length} backup directory(ies) from potential failed updates`);
        // Note: We don't auto-delete these as they may be intentional backups.
        // The cleanOldBackups method will manage them based on maxBackups config.
      }
    } catch (error) {
      logger.warn("Could not check for orphaned backups:", error.message);
    }

    const config = await this.getConfig();
    logger.info(`Auto-updater initialized (v${this.currentVersion}, enabled: ${config.enabled})`);

    await this.registerServer();

    if (config.enabled) {
      setTimeout(() => this.checkForUpdates(), 10_000);
      setInterval(() => this.checkForUpdates(), config.checkInterval * 60 * 1000);
    }

    setInterval(() => this.registerServer(), 30_000);
    this.setupRoutes(app);
  }

  async getConfig() {
    try {
      const row = await this.db.heliactyl.findUnique({ where: { key: DB_KEYS.config } });
      const config = row ? JSON.parse(row.value) : null;
      return config ? { ...DEFAULT_CONFIG, ...config } : DEFAULT_CONFIG;
    } catch {
      return DEFAULT_CONFIG;
    }
  }












  async setConfig(newConfig) {
    const current = await this.getConfig();
    const merged = { ...current, ...newConfig };
    await this.db.heliactyl.upsert({
      where: { key: DB_KEYS.config },
      update: { value: JSON.stringify(merged) },
      create: { key: DB_KEYS.config, value: JSON.stringify(merged) }
    });
    return merged;
  }

  async registerServer() {
    try {
      const row = await this.db.heliactyl.findUnique({ where: { key: DB_KEYS.servers } });
      const servers = row ? JSON.parse(row.value) : {};
      // Preserve existing nickname if server was already registered
      const existingServer = servers[this.hostname];
      servers[this.hostname] = {
        hostname: this.hostname,
        name: existingServer?.name || this.hostname, // Nickname, defaults to hostname
        version: this.currentVersion,
        updatedAt: Date.now(),
        updating: this.updating
      };
      await this.db.heliactyl.upsert({
        where: { key: DB_KEYS.servers },
        update: { value: JSON.stringify(servers) },
        create: { key: DB_KEYS.servers, value: JSON.stringify(servers) }
      });
    } catch (error) {
      logger.error("Failed to register server:", error);
    }
  }

  async getServers() {
    try {
      const row = await this.db.heliactyl.findUnique({ where: { key: DB_KEYS.servers } });
      const servers = row ? JSON.parse(row.value) : {};
      const now = Date.now();
      const ONLINE_THRESHOLD = 30 * 60 * 1000; // 30 minutes - consider offline if no heartbeat
      const CLEANUP_THRESHOLD = 72 * 60 * 60 * 1000; // 72 hours - remove stale entries
      
      // Clean up servers that haven't responded in a very long time (72h+)
      const cleanedServers = {};
      for (const [hostname, data] of Object.entries(servers)) {
        const timeSinceUpdate = now - (data.updatedAt || 0);
        if (timeSinceUpdate < CLEANUP_THRESHOLD) {
          cleanedServers[hostname] = {
            ...data,
            // Calculate online status based on heartbeat
            online: timeSinceUpdate < ONLINE_THRESHOLD
          };
        } else {
          logger.info(`Removing stale server entry: ${hostname} (last seen ${Math.round(timeSinceUpdate / 1000 / 60 / 60)} hours ago)`);
        }
      }
      
      // Save cleaned servers if any were removed
      if (Object.keys(cleanedServers).length !== Object.keys(servers).length) {
        await this.db.heliactyl.upsert({
          where: { key: DB_KEYS.servers },
          update: { value: JSON.stringify(cleanedServers) },
          create: { key: DB_KEYS.servers, value: JSON.stringify(cleanedServers) }
        });
      }
      
      return Object.values(cleanedServers);
    } catch {
      return [];
    }
  }

  // Update server nickname
  async updateServerName(hostname, name) {
    try {
      const row = await this.db.heliactyl.findUnique({ where: { key: DB_KEYS.servers } });
      const servers = row ? JSON.parse(row.value) : {};
      if (servers[hostname]) {
        servers[hostname].name = name || hostname;
        await this.db.heliactyl.upsert({
          where: { key: DB_KEYS.servers },
          update: { value: JSON.stringify(servers) },
          create: { key: DB_KEYS.servers, value: JSON.stringify(servers) }
        });
        return true;
      }
      return false;
    } catch (error) {
      logger.error("Failed to update server name:", error);
      return false;
    }
  }

  // Delete a server entry manually
  async deleteServer(hostname) {
    try {
      const row = await this.db.heliactyl.findUnique({ where: { key: DB_KEYS.servers } });
      const servers = row ? JSON.parse(row.value) : {};
      if (servers[hostname]) {
        delete servers[hostname];
        await this.db.heliactyl.upsert({
          where: { key: DB_KEYS.servers },
          update: { value: JSON.stringify(servers) },
          create: { key: DB_KEYS.servers, value: JSON.stringify(servers) }
        });
        return true;
      }
      return false;
    } catch (error) {
      logger.error("Failed to delete server:", error);
      return false;
    }
  }

  setupRoutes(app) {

    app.get("/api/admin/updater/config", async (req, res) => {
      if (!await checkAdminStatus(req, res, this.db)) return res.status(403).json({ error: "Forbidden" });
      try {
        const config = await this.getConfig();
        const masked = config.webhookSecret ? "*".repeat(config.webhookSecret.length) : "";
        res.json({ ...config, webhookSecret: masked });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.post("/api/admin/updater/config", async (req, res) => {
      if (!await checkAdminStatus(req, res, this.db)) return res.status(403).json({ error: "Forbidden" });
      try {
        const { enabled, checkInterval, webhookSecret, maxBackups } = req.body;
        const current = await this.getConfig();

        // Validate checkInterval
        if (checkInterval !== undefined) {
          const interval = parseInt(checkInterval);
          if (isNaN(interval) || interval < 5) {
            return res.status(400).json({ error: "Check interval must be at least 5 minutes" });
          }
        }

        // Validate maxBackups
        if (maxBackups !== undefined) {
          const backups = parseInt(maxBackups);
          if (isNaN(backups) || backups < 1) {
            return res.status(400).json({ error: "Max backups must be at least 1" });
          }
        }

        // Handle webhook secret - check if masked (all asterisks) or explicitly empty string
        // ROBUSTNESS NOTE: The masking pattern (all asterisks) is safe because:
        // 1. Secrets are sent from frontend already masked (they never leave the server)
        // 2. If a user provides a new secret, it's a string that won't be all asterisks (highly unlikely for a real secret)
        // 3. The regex /^\*+$/ specifically matches ONLY strings of asterisks, not real secrets
        // 4. If somehow a user had a secret that WAS all asterisks (edge case), they'd need to clear and reset it
        let newSecret;
        if (webhookSecret === "") {
          // Explicitly clearing the secret
          newSecret = "";
        } else if (webhookSecret && /^\*+$/.test(webhookSecret)) {
          // Masked value - keep current (user didn't change it, just viewing)
          newSecret = current.webhookSecret;
        } else {
          // New value provided (actual secret, not masked)
          newSecret = webhookSecret;
        }

        const updated = await this.setConfig({
          enabled: enabled !== undefined ? enabled : current.enabled,
          checkInterval: checkInterval !== undefined ? parseInt(checkInterval) : current.checkInterval,
          webhookSecret: newSecret !== undefined ? newSecret : current.webhookSecret,
          maxBackups: maxBackups !== undefined ? parseInt(maxBackups) : current.maxBackups
        });

        res.json({ success: true, config: updated });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get("/api/admin/updater/status", async (req, res) => {
      if (!await checkAdminStatus(req, res, this.db)) return res.status(403).json({ error: "Forbidden" });
      try {
        const release = await this.fetchLatestRelease();
        const latest = release?.tag_name?.replace(/^v/, "") || "unknown";
        res.json({
          currentVersion: this.currentVersion,
          latestVersion: latest,
          upToDate: this.currentVersion === latest,
          updating: this.updating
        });
      } catch {
        res.json({
          currentVersion: this.currentVersion,
          latestVersion: "unknown",
          upToDate: false,
          updating: this.updating
        });
      }
    });

    app.post("/api/admin/updater/trigger", async (req, res) => {
      if (!await checkAdminStatus(req, res, this.db)) return res.status(403).json({ error: "Forbidden" });
      if (this.updating) return res.status(409).json({ error: "Update already in progress" });
      res.json({ status: "checking" });
      this.checkForUpdates();
    });

    app.get("/api/admin/updater/servers", async (req, res) => {
      if (!await checkAdminStatus(req, res, this.db)) return res.status(403).json({ error: "Forbidden" });
      const servers = await this.getServers();
      res.json(servers);
    });

    // Update server nickname
    app.patch("/api/admin/updater/servers/:hostname", async (req, res) => {
      if (!await checkAdminStatus(req, res, this.db)) return res.status(403).json({ error: "Forbidden" });
      try {
        const { hostname } = req.params;
        const { name } = req.body;
        
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
          return res.status(400).json({ error: "Name must be a non-empty string" });
        }
        
        const success = await this.updateServerName(hostname, name.trim());
        if (success) {
          res.json({ success: true, message: `Server "${hostname}" renamed to "${name.trim()}"` });
        } else {
          res.status(404).json({ error: "Server not found" });
        }
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Delete server entry manually
    app.delete("/api/admin/updater/servers/:hostname", async (req, res) => {
      if (!await checkAdminStatus(req, res, this.db)) return res.status(403).json({ error: "Forbidden" });
      try {
        const { hostname } = req.params;
        const success = await this.deleteServer(hostname);
        if (success) {
          res.json({ success: true, message: `Server "${hostname}" deleted` });
        } else {
          res.status(404).json({ error: "Server not found" });
        }
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.post("/api/webhooks/github", async (req, res) => {
      const config = await this.getConfig();
      if (config.webhookSecret && req.query.secret !== config.webhookSecret) {
        return res.status(403).json({ error: "Invalid secret" });
      }

      const event = req.headers["x-github-event"];
      if (event === "release" && req.body?.action === "published") {
        logger.info("GitHub webhook: new release published");
        res.json({ status: "updating" });
        this.checkForUpdates();
      } else if (event === "push") {
        logger.info("GitHub webhook: push event received");
        res.json({ status: "updating" });
        this.checkForUpdates();
      } else {
        res.json({ status: "ignored", event });
      }
    });
  }

  async checkForUpdates() {
    if (this.updating) return;

    const config = await this.getConfig();
    if (!config.enabled) return;

    try {
      const release = await this.fetchLatestRelease();
      if (!release?.tag_name) {
        logger.error("Could not fetch latest release info from GitHub");
        return;
      }

      const latestVersion = release.tag_name.replace(/^v/, "");

      if (this.currentVersion !== latestVersion) {
        logger.info(`Update available: ${this.currentVersion} → ${latestVersion}`);
        await this.performUpdate(release);
      } else {
        logger.info(`Up to date (v${this.currentVersion})`);
      }
    } catch (error) {
      logger.error("Update check failed:", error);
    }
  }

  fetchLatestRelease() {
    return new Promise((resolve, reject) => {
      const headers = {
        "User-Agent": "Heliactyl-Updater",
        "Accept": "application/vnd.github.v3+json"
      };

      https.get(this.githubApiUrl, { headers }, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(e); }
        });
      }).on("error", reject);
    });
  }

  async performUpdate(release) {
    if (this.updating) return;
    this.updating = true;
    await this.registerServer();

    const config = await this.getConfig();
    
    // SECURITY: Sanitize tag to prevent git command injection
    let tag;
    try {
      tag = sanitizeGitTag(release.tag_name);
    } catch (error) {
      logger.error("Invalid release tag:", error.message);
      this.updating = false;
      await this.registerServer();
      throw error;
    }
    
    const tempDir = path.join(this.serverDir, "temp_update");
    const backupDir = path.join(this.serverDir, `backup_${Date.now()}`);

    try {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      await fs.mkdir(tempDir, { recursive: true });

      logger.info(`Downloading ${tag}...`);
      const cloneUrl = `https://github.com/${this.repo}.git`;
      await execAsync(`git clone --depth 1 --branch ${tag} ${cloneUrl} "${tempDir}"`, { timeout: 120_000 });

      logger.info("Backing up current files...");
      await fs.mkdir(backupDir, { recursive: true });
      await this.copyFiltered(this.serverDir, path.join(backupDir, "server"), SERVER_EXCLUDE);
      await this.copyFiltered(this.frontendDir, path.join(backupDir, "frontend"), FRONTEND_EXCLUDE);

      logger.info("Applying server update...");
      await this.applyUpdate(path.join(tempDir, "server"), this.serverDir, SERVER_EXCLUDE);

      logger.info("Applying frontend update...");
      await this.applyUpdate(path.join(tempDir, "frontend"), this.frontendDir, FRONTEND_EXCLUDE);

      await fs.rm(tempDir, { recursive: true, force: true });

      logger.info("Installing server dependencies...");
      await execAsync("npm install --production", { cwd: this.serverDir, timeout: 120_000 });

      logger.info("Installing frontend dependencies & building...");
      await execAsync("npm install && npm run build", { cwd: this.frontendDir, timeout: 300_000 });

      await this.updateConfigVersion(tag.replace(/^v/, ""));
      await this.cleanOldBackups(config.maxBackups);

      logger.info(`Update to ${tag} complete! Restarting...`);
      this.restart();

    } catch (error) {
      logger.error("Update failed:", error);
      this.updating = false;
      await this.registerServer();

      const backupExists = await fs.access(backupDir).then(() => true).catch(() => false);
      if (backupExists) {
        try {
          logger.info("Rolling back...");
          const emptySet = new Set();
          await this.applyUpdate(path.join(backupDir, "server"), this.serverDir, emptySet);
          await this.applyUpdate(path.join(backupDir, "frontend"), this.frontendDir, emptySet);
          logger.info("Rollback completed");
        } catch (rollbackErr) {
          logger.error("Rollback failed:", rollbackErr);
        }
      }

      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async copyFiltered(srcDir, destDir, excludeSet) {
    try { await fs.access(srcDir); } catch { return; }

    await fs.mkdir(destDir, { recursive: true });
    const entries = await fs.readdir(srcDir);

    for (const entry of entries) {
      if (shouldExclude(entry, excludeSet)) continue;

      const srcPath = path.join(srcDir, entry);
      const destPath = path.join(destDir, entry);
      const stat = await fs.stat(srcPath);

      if (stat.isDirectory()) {
        await fs.cp(srcPath, destPath, { recursive: true });
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  async applyUpdate(srcDir, destDir, excludeSet) {
    try { await fs.access(srcDir); } catch { return; }

    const entries = await fs.readdir(srcDir);

    for (const entry of entries) {
      if (shouldExclude(entry, excludeSet)) continue;

      const srcPath = path.join(srcDir, entry);
      const destPath = path.join(destDir, entry);
      const stat = await fs.stat(srcPath);

      if (stat.isDirectory()) {
        await fs.rm(destPath, { recursive: true, force: true });
        await fs.cp(srcPath, destPath, { recursive: true });
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  async updateConfigVersion(newVersion) {
    try {
      const configPath = path.join(this.serverDir, "config.toml");
      const content = await fs.readFile(configPath, "utf8");
      const updated = content.replace(/^version\s*=\s*"[^"]*"/m, `version = "${newVersion}"`);
      await fs.writeFile(configPath, updated, "utf8");
    } catch (error) {
      logger.error("Could not update config version:", error);
    }
  }

  async cleanOldBackups(maxBackups) {
    try {
      const entries = await fs.readdir(this.serverDir);
      const backups = entries
        .filter((e) => e.startsWith("backup_"))
        .sort()
        .reverse();

      for (const old of backups.slice(maxBackups)) {
        logger.info(`Removing old backup: ${old}`);
        await fs.rm(path.join(this.serverDir, old), { recursive: true, force: true });
      }
    } catch (error) {
      logger.error("Could not clean old backups:", error);
    }
  }

  restart() {
    logger.info("Killing process — PM2 will restart with updated code");
    if (global.server) {
      global.server.close(() => process.exit(0));
    } else {
      process.exit(0);
    }
  }
}

module.exports.HeliactylModule = HeliactylModule;
module.exports.load = async function (app, db) {
  const updater = new UpdateManager(db);
  await updater.init(app);
};
