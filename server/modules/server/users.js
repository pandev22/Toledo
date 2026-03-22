/* --------------------------------------------- */
/* users                                  */
/* --------------------------------------------- */

const express = require("express");
const axios = require("axios");
const { isAuthenticated, ownsServer, PANEL_URL, API_KEY } = require("./core.js");
const loadConfig = require("../../handlers/config.js");
const settings = loadConfig("./config.toml");
let db;
const { validate, schemas } = require('../../handlers/validate');

/* --------------------------------------------- */
/* Heliactyl Next Module                                  */
/* --------------------------------------------- */
const HeliactylModule = {
  "name": "Server -> Users",
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

module.exports.HeliactylModule = HeliactylModule;

async function getServerName(serverId) {
  try {
    const response = await axios.get(
      `${PANEL_URL}/api/client/servers/${serverId}`,
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Accept': 'application/json',
        },
      }
    );
    return response.data.attributes.name;
  } catch (error) {
    return 'Unknown Server';
  }
}

// Modified update subuser info
async function updateSubuserInfo(serverId, serverOwnerId) {
  try {
    const response = await axios.get(
      `${PANEL_URL}/api/client/servers/${serverId}/users`,
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Accept': 'application/json',
        },
      }
    );

    const subusers = response.data.data.map(user => ({
      id: user.attributes.username,
      username: user.attributes.username,
      email: user.attributes.email,
    }));

    const serverName = await getServerName(serverId);

    for (const subuser of subusers) {
      const user = await db.user.findFirst({
        where: { OR: [{ email: subuser.email }, { pteroUsername: subuser.username }, { username: subuser.username }] }
      });

      if (user) {
        await db.subuserServer.upsert({
          where: { userId_serverId_source: { userId: user.id, serverId, source: 'subuser' } },
          create: { userId: user.id, serverId, serverName, ownerId: serverOwnerId, source: 'subuser' },
          update: { serverName, ownerId: serverOwnerId }
        });
      }
    }
  } catch (error) {
    console.error(`Error updating subuser info:`, error);
  }
}

module.exports.updateSubuserInfo = updateSubuserInfo;
module.exports.load = async function (app, _db) {
  db = _db;
  const router = express.Router();

  // GET /api/server/:id/users - List users
  router.get('/server/:id/users', isAuthenticated, ownsServer, async (req, res) => {
    try {
      const serverId = req.params.id;
      const response = await axios.get(
        `${PANEL_URL}/api/client/servers/${serverId}/users`,
        {
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
        }
      );

      await updateSubuserInfo(serverId, req.session.userinfo.id);

      res.json(response.data);
    } catch (error) {
      console.error('Error fetching users:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/server/:id/users - Create user
  router.post('/server/:id/users', isAuthenticated, ownsServer, validate(schemas.subuserCreate), async (req, res) => {
    try {
      const serverId = req.params.id;
      const { email } = req.body;

      const response = await axios.post(
        `${PANEL_URL}/api/client/servers/${serverId}/users`,
        {
          email,
          permissions: [
            "control.console", "control.start", "control.stop", "control.restart",
            "user.create", "user.read", "user.update", "user.delete",
            "file.create", "file.read", "file.update", "file.delete",
            "file.archive", "file.sftp", "backup.create", "backup.read",
            "backup.delete", "backup.update", "backup.download",
            "allocation.update", "startup.update", "startup.read",
            "database.create", "database.read", "database.update",
            "database.delete", "database.view_password", "schedule.create",
            "schedule.read", "schedule.update", "settings.rename",
            "schedule.delete", "settings.reinstall", "websocket.connect"
          ]
        },
        {
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
        }
      );

      await updateSubuserInfo(serverId, req.session.userinfo.id);
      await addUserToAllUsersList(response.data.attributes.username);

      res.status(201).json(response.data);
    } catch (error) {
      console.error('Error creating user:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/server/:id/users/:userId - Delete user
  router.delete('/server/:id/users/:userId', isAuthenticated, ownsServer, async (req, res) => {
    try {
      const { id: serverId, userId } = req.params;
      await axios.delete(
        `${PANEL_URL}/api/client/servers/${serverId}/users/${userId}`,
        {
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Accept': 'application/json',
          },
        }
      );
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting user:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.use("/api", router);
};