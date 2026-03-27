/* --------------------------------------------- */
/* websocket                              */
/* --------------------------------------------- */

const express = require("express");
const axios = require("axios");
const { isAuthenticated, ownsServer, PANEL_URL, API_KEY } = require("./core.js");

const WEBSOCKET_CREDENTIAL_TTL_MS = 5000;
const websocketCredentialCache = new Map();
const websocketCredentialRequests = new Map();

function getCachedWebSocketCredentials(serverId) {
  const cachedEntry = websocketCredentialCache.get(serverId);

  if (!cachedEntry) {
    return null;
  }

  if (cachedEntry.expiresAt <= Date.now()) {
    websocketCredentialCache.delete(serverId);
    return null;
  }

  return cachedEntry.data;
}

async function fetchWebSocketCredentials(serverId) {
  const cachedCredentials = getCachedWebSocketCredentials(serverId);
  if (cachedCredentials) {
    return cachedCredentials;
  }

  const inFlightRequest = websocketCredentialRequests.get(serverId);
  if (inFlightRequest) {
    return inFlightRequest;
  }

  const requestPromise = axios.get(
    `${PANEL_URL}/api/client/servers/${serverId}/websocket`,
    {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    }
  ).then((response) => {
    websocketCredentialCache.set(serverId, {
      data: response.data,
      expiresAt: Date.now() + WEBSOCKET_CREDENTIAL_TTL_MS,
    });

    return response.data;
  }).finally(() => {
    websocketCredentialRequests.delete(serverId);
  });

  websocketCredentialRequests.set(serverId, requestPromise);

  return requestPromise;
}

/* --------------------------------------------- */
/* Heliactyl Next Module                                  */
/* --------------------------------------------- */
const HeliactylModule = {
  "name": "Server -> WebSocket",
  "version": "1.0.0",
  "api_level": 4,
  "target_platform": "10.0.0",
  "description": "Core module",
  "author": {
    "name": "Matt James",
    "email": "me@ether.pizza",
    "url": "https://ether.pizza"
  },
  "dependencies": [{ "name": "server/core", "optional": false }],
  "permissions": [],
  "routes": [],
  "config": {},
  "hooks": [],
  "tags": ['core'],
  "license": "MIT"
};

module.exports.HeliactylModule = HeliactylModule;
module.exports.load = async function (app, db) {
  const router = express.Router();

  // GET /api/server/:id/websocket - Get WebSocket credentials
  router.get("/server/:id/websocket", isAuthenticated, ownsServer, async (req, res) => {
    try {
      const serverId = req.params.id;
      const responseData = await fetchWebSocketCredentials(serverId);

      // Return the WebSocket credentials to the client
      res.json(responseData);
    } catch (error) {
      console.error("Error fetching WebSocket credentials:", error);

      if (error.response?.status === 429) {
        const retryAfter = error.response.headers?.["retry-after"];

        if (retryAfter) {
          res.set("Retry-After", retryAfter);
        }

        return res.status(429).json(
          error.response.data ?? { error: "Rate limited while fetching WebSocket credentials" }
        );
      }

      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/server/:id - Get server details (needed for console)
  router.get("/server/:id", isAuthenticated, ownsServer, async (req, res) => {
    try {
      const serverId = req.params.id;
      const response = await axios.get(
        `${PANEL_URL}/api/client/servers/${serverId}`,
        {
          headers: {
            Authorization: `Bearer ${API_KEY}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
      res.json(response.data);
    } catch (error) {
      console.error("Error fetching server details:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.use("/api", router);
};
