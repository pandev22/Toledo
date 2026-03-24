/* --------------------------------------------- */
/* core                                   */
/* --------------------------------------------- */

const express = require("express");
const WebSocket = require("ws");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const loadConfig = require("../../handlers/config");
const settings = loadConfig("./config.toml");
let db;
const getPteroUser = require('../../handlers/getPteroUser');
const NodeCache = require("node-cache");
const createAuthz = require('../../handlers/authz');
const serverCache = new NodeCache({ stdTTL: 60 });
let authz;

const workflowsFilePath = path.join(__dirname, "../../storage/workflows.json");

/* --------------------------------------------- */
/* Heliactyl Next Module                                  */
/* --------------------------------------------- */
const HeliactylModule = {
  "name": "Server -> Core",
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

const PANEL_URL = settings.pterodactyl.domain;
const API_KEY = settings.pterodactyl.client_key;
const ADMIN_KEY = settings.pterodactyl.key;

// Middleware for authentication check
const isAuthenticated = (req, res, next) => {
  if (!authz) {
    return res.status(500).json({ error: 'Authentication handler is not initialized' });
  }

  return authz.requirePterodactylSession(req, res, next);
};

// Fixed enhancedOwnsServer middleware with fresh Pterodactyl data
const ownsServer = async (req, res, next) => {
  try {
    const serverId = req.params.id || req.params.serverId || req.params.instanceId || req.query.id;
    if (!serverId) {
      return res.status(400).json({ error: 'No server ID provided' });
    }

    if (!authz) {
      return res.status(500).json({ error: 'Authentication handler is not initialized' });
    }

    if (!authz.hasPterodactylSession(req) || !authz.hasUserSession(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const pteroUser = authz.getPterodactylUser(req);
    const sessionUser = authz.getSessionUser(req);

    // Normalize IDs for comparison
    const normalizeId = (id) => {
      if (!id || typeof id !== 'string') return '';
      return id.includes('-') ? id.split('-')[0] : id;
    };

    const normalizedTargetId = normalizeId(serverId);

    // FIRST CHECK: Get fresh data from Pterodactyl API instead of using session data
    let isOwner = false;
    try {
        const cacheKey = `user_servers_${pteroUser.id}`;
      let ownedServers = serverCache.get(cacheKey);

      if (!ownedServers) {
        // Get user's servers directly from Pterodactyl
        const userResponse = await axios.get(
          `${PANEL_URL}/api/application/users/${pteroUser.id}?include=servers`,
          {
            headers: {
              'Authorization': `Bearer ${ADMIN_KEY}`,
              'Accept': 'application/json',
            },
          }
        );
        ownedServers = userResponse.data.attributes.relationships.servers.data;
        serverCache.set(cacheKey, ownedServers);
      }

      // Check if user owns the server directly
      isOwner = ownedServers.some(s => {
        const serverId = s.attributes?.identifier;

        return normalizeId(serverId) === normalizedTargetId;
      });
    } catch (error) {
      console.error('Error fetching fresh server data from Pterodactyl:', error);
      // Continue with other checks even if this one fails
    }

    if (isOwner) {
      return next();
    }

    // FORCE CHECK
    try {
      const forced = await db.subuserServer.findFirst({ where: { serverId, source: 'forced' } });
        if (forced && forced.userId === sessionUser.id) {
        return next();
      }
    } catch (error) {
      console.error('Error checking force access:', error);
    }

    // SECOND CHECK: Check if user is a subuser via pterodactyl username
    try {
      const pteroUsername = pteroUser.username;
      const results = await db.subuserServer.findMany({ where: { user: { pteroUsername } } });
      const subuserServers = results.map(s => ({ id: s.serverId, name: s.serverName, ownerId: s.ownerId }));

      let hasAccess = subuserServers.some(server => {
        const normalizedSubuserId = normalizeId(server?.id);
        return normalizedSubuserId === normalizedTargetId;
      });

      if (hasAccess) {
        return next();
      }
    } catch (error) {
      console.error('Error checking subuser access by username:', error);
    }

    // THIRD CHECK: Check if user is a subuser via discord ID
    try {
      const discordId = sessionUser.id;
      const results = await db.subuserServer.findMany({ where: { user: { discordId } } });
      const discordServers = results.map(s => ({ id: s.serverId, name: s.serverName, ownerId: s.ownerId }));

      let hasAccess = discordServers.some(server => {
        const normalizedSubuserId = normalizeId(server?.id);
        return normalizedSubuserId === normalizedTargetId;
      });

      if (hasAccess) {
        return next();
      }
    } catch (error) {
      console.error('Error checking subuser access by discord ID:', error);
    }

    // FOURTH CHECK: Direct check with Pterodactyl API for subuser permissions
    try {
      const cacheKey = `server_subusers_${normalizedTargetId}`;
      let serverUsers = serverCache.get(cacheKey);

      if (!serverUsers) {
        const serverResponse = await axios.get(
          `${PANEL_URL}/api/application/servers/${normalizedTargetId}?include=users`,
          {
            headers: {
              'Authorization': `Bearer ${ADMIN_KEY}`,
              'Accept': 'application/json',
            },
          }
        );
        serverUsers = serverResponse.data.attributes.relationships.users.data;
        serverCache.set(cacheKey, serverUsers);
      }

      // Check if user is a subuser on this server
      const userIsSubuser = serverUsers.some(
        user => user.attributes.id === pteroUser.id
      );

      if (userIsSubuser) {
        return next();
      }
    } catch (error) {
      console.error('Error checking server subusers via API:', error);
    }

    // If we get here, user doesn't have access
    return res.status(403).json({ error: 'You do not have permission to access this server' });
  } catch (error) {
    console.error('Error in enhancedOwnsServer middleware:', error);
    return res.status(500).json({ error: 'Internal server error while checking server access' });
  }
};


// WebSocket helper function
async function withServerWebSocket(serverId, callback) {
  let ws = null;
  try {
    // Get WebSocket credentials
    const credsResponse = await axios.get(
      `${PANEL_URL}/api/client/servers/${serverId}/websocket`,
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Accept': 'application/json',
        },
      }
    );

    const { socket, token } = credsResponse.data.data;

    // Connect to WebSocket
    return new Promise((resolve, reject) => {
      ws = new WebSocket(socket);
      const timeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.CLOSED) {
          ws.close();
        }
        reject(new Error('WebSocket operation timed out'));
      }, 10000); // 10 second timeout

      let consoleBuffer = [];
      let authenticated = false;

      ws.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      ws.on('open', () => {
        // Authenticate
        ws.send(JSON.stringify({
          event: "auth",
          args: [token]
        }));
      });

      ws.on('message', async (data) => {
        const message = JSON.parse(data.toString());

        if (message.event === 'auth success') {
          authenticated = true;
          try {
            await callback(ws, consoleBuffer);
            clearTimeout(timeout);
            resolve();
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        }
        else if (message.event === 'console output') {
          consoleBuffer.push(message.args[0]);
        }
        else if (message.event === 'token expiring') {
          // Get new token
          const newCredsResponse = await axios.get(
            `${PANEL_URL}/api/client/servers/${serverId}/websocket`,
            {
              headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Accept': 'application/json',
              },
            }
          );
          // Send new token
          ws.send(JSON.stringify({
            event: "auth",
            args: [newCredsResponse.data.data.token]
          }));
        }
      });

      ws.on('close', () => {
        if (!authenticated) {
          clearTimeout(timeout);
          reject(new Error('WebSocket closed before authentication'));
        }
      });
    });
  } catch (error) {
    console.error(`WebSocket error for server ${serverId}:`, error);
    throw error;
  } finally {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  }
}

// Helper to send command and wait for response
async function sendCommandAndGetResponse(serverId, command, responseTimeout = 5000) {
  return withServerWebSocket(serverId, async (ws, consoleBuffer) => {
    return new Promise((resolve) => {
      // Clear existing buffer
      consoleBuffer.length = 0;

      // Send command
      ws.send(JSON.stringify({
        event: "send command",
        args: [command]
      }));

      // Wait for response
      setTimeout(() => {
        resolve([...consoleBuffer]); // Return a copy of the buffer
      }, responseTimeout);
    });
  });
}

// API request helper
async function apiRequest(endpoint, method = "GET", body = null) {
  try {
    const config = {
      method: method.toLowerCase(),
      url: `${PANEL_URL}/api/application${endpoint}`,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        Accept: "Application/vnd.pterodactyl.v1+json",
      },
    };

    if (body) {
      config.data = body;
    }

    const response = await axios(config);
    return response.data;
  } catch (error) {
    throw new Error(`API request failed: ${error.response?.data ? JSON.stringify(error.response.data) : error.message}`);
  }
}

module.exports.load = async function (app, _db) {
  db = _db;
  authz = createAuthz(_db);
};

module.exports = {
  HeliactylModule,
  isAuthenticated,
  ownsServer,
  withServerWebSocket,
  sendCommandAndGetResponse,
  apiRequest,
  workflowsFilePath,
  PANEL_URL,
  API_KEY,
  ADMIN_KEY
};
