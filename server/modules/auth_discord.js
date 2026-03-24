const vpnCheck = require("../handlers/vpnCheck.js");
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const axios = require('axios');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const loadConfig = require("../handlers/config.js");
const settings = loadConfig("./config.toml");
const log = require("../handlers/log.js");

const HeliactylModule = {
  "name": "Discord OAuth2",
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

// Constants
const DISCORD_CLIENT_ID = settings.api.client.discord.client_id;
const DISCORD_CLIENT_SECRET = settings.api.client.discord.client_secret;
const DISCORD_BOT_TOKEN = settings.api.client.discord.bot_token;
const DISCORD_SERVER_ID = settings.api.client.discord.server_id;
const DISCORD_REDIRECT_URI = `${settings.website.domain}/auth/discord/callback`;
const DISCORD_SIGNUP_BONUS = 100;

// Pterodactyl API helper
const pteroApi = axios.create({
  baseURL: settings.pterodactyl.domain,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': `Bearer ${settings.pterodactyl.key}`
  }
});

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ],
  partials: [
    Partials.User,
    Partials.GuildMember
  ]
});

// Utility functions
function generatePassword(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array).map(x => chars[x % chars.length]).join('');
}

async function createPterodactylAccount(userId, username, email, retryCount = 0) {
  if (retryCount > 3) {
    throw new Error('Maximum retry attempts reached for creating Pterodactyl account');
  }

  // Sanitize username to match Pterodactyl requirements:
  // - Must start and end with alphanumeric
  // - Can only contain letters, numbers, dashes, underscores, and periods
  const sanitizeUsername = (name) => {
    // Remove any characters that aren't allowed
    let cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '');

    // If starts with non-alphanumeric, prepend 'u'
    if (!cleaned.match(/^[a-zA-Z0-9]/)) {
      cleaned = 'u' + cleaned;
    }

    // If ends with non-alphanumeric, append random number
    if (!cleaned.match(/[a-zA-Z0-9]$/)) {
      cleaned = cleaned + crypto.randomInt(1, 10);
    }

    // Ensure we have at least one character
    if (cleaned.length === 0) {
      cleaned = 'user' + crypto.randomInt(100, 1000);
    }

    return cleaned;
  };

  const password = generatePassword(16);

  // Create a username with userId as fallback to ensure uniqueness
  const baseUsername = sanitizeUsername(username);
  // Include userId in the username for guaranteed uniqueness
  const finalUsername = retryCount ? `${baseUsername}_${userId.slice(0, 6)}${retryCount}` : `${baseUsername}_${userId.slice(0, 6)}`;

  try {
    const response = await pteroApi.post('/api/application/users', {
      email: retryCount ? `discord_${userId}+${retryCount}@${email.split('@')[1]}` : `discord_${userId}@${email.split('@')[1]}`,
      username: finalUsername,
      first_name: username,
      last_name: 'User',
      password: password,
      root_admin: false,
      language: 'en'
    });

    return {
      id: response.data.attributes.id,
      username: response.data.attributes.username,
      email: response.data.attributes.email,
      password: password
    };
  } catch (error) {
    if (error.response?.status === 422 && retryCount < 3) {
      return createPterodactylAccount(userId, username, email, retryCount + 1);
    }

    console.error('Pterodactyl API error:', {
      message: error.message,
      username: finalUsername,
      originalUsername: username,
      userId: userId,
      email: email.replace(/@.*/, '@[redacted]'),
      retryCount,
      errors: error.response?.data?.errors
    });
    throw error;
  }
}

async function verifyPterodactylAccount(pteroId) {
  try {
    await pteroApi.get(`/api/application/users/${pteroId}`);
    return true;
  } catch {
    return false;
  }
}

async function fetchPterodactylData(pteroId) {
  const response = await pteroApi.get(`/api/application/users/${pteroId}?include=servers`);
  return response.data;
}

async function addDiscordServerMember(userId, accessToken, username) {
  try {
    const guild = await client.guilds.fetch(DISCORD_SERVER_ID);
    if (!guild) {
      throw new Error('Could not find Discord server');
    }

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      await guild.members.add(userId, {
        accessToken: accessToken,
        nick: username
      });
    }
    return true;
  } catch (error) {
    return false;
  }
}
// Discord bot setup
client.once('ready', () => {
});

client.on('error', (error) => {
});

client.login(DISCORD_BOT_TOKEN).catch((error) => {
  console.log("Discord OAuth is not setup! which is required for the application to function. Closing webserver...");
  process.exit(1);
});

// Module export
module.exports.HeliactylModule = HeliactylModule;
module.exports.load = async function (app, db) {
  // OAuth login endpoint
  app.get('/auth/discord/login', (req, res) => {
    const state = crypto.randomUUID();
    req.session.oauthState = state;

    const params = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      redirect_uri: DISCORD_REDIRECT_URI,
      response_type: 'code',
      scope: 'identify email guilds.join',
      state: state
    });

    res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
  });

  // OAuth callback handler
  app.get('/auth/discord/callback', async (req, res) => {
    const { code, state } = req.query;

    const redirectAuthError = (reason = 'discord_auth_failed') => {
      const params = new URLSearchParams({ error: reason });
      return res.redirect(`/auth?${params.toString()}`);
    };

    if (!code) {
      return redirectAuthError('discord_missing_code');
    }

    if (state !== req.session.oauthState) {
      return redirectAuthError('discord_session_expired');
    }

    delete req.session.oauthState;

    // Get client IP
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress?.replace('::ffff:', '');
    
    // Check for VPN/proxy
    if (clientIp) {
      const vpnResult = await vpnCheck(null, db, clientIp);
      if (vpnResult.blocked) {
        return res.redirect('/auth?error=vpn');
      }
    }

    try {
      // Exchange code for access token
      const tokenResponse = await axios.post('https://discord.com/api/oauth2/token',
        new URLSearchParams({
          client_id: DISCORD_CLIENT_ID,
          client_secret: DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri: DISCORD_REDIRECT_URI,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const tokenData = tokenResponse.data;

      // Fetch user data
      const userResponse = await axios.get('https://discord.com/api/v10/users/@me', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      });

      const userData = userResponse.data;

      if (!userData.email) {
        return redirectAuthError('discord_email_unavailable');
      }

      // Get or create user record
      let user = await db.user.findUnique({ where: { discordId: userData.id } });
      let pteroId = user?.pterodactylId;
      let isNewUser = !user;

      if (isNewUser) {
        const existingEmailUser = await db.user.findUnique({
          where: { email: userData.email },
          select: { id: true }
        });

        if (existingEmailUser) {
          return redirectAuthError('discord_email_in_use');
        }
      }

      // Verify existing Pterodactyl account or create new one
      if (!pteroId || !(await verifyPterodactylAccount(pteroId))) {
        const pteroAccount = await createPterodactylAccount(userData.id, userData.username, userData.email);
        pteroId = pteroAccount.id;
      }

      if (isNewUser) {
        const localPasswordHash = await bcrypt.hash(generatePassword(32), 12);

        user = await db.user.create({
          data: {
            discordId: userData.id,
            username: userData.username,
            email: userData.email,
            password: localPasswordHash,
            pterodactylId: pteroId,
            discordAccessToken: tokenData.access_token,
            discordRefreshToken: tokenData.refresh_token,
            coins: DISCORD_SIGNUP_BONUS
          }
        });

        await db.notification.create({ data: { userId: user.id, action: "coins:bonus", name: `Discord Signup Bonus: +${DISCORD_SIGNUP_BONUS} coins` } });
      } else {
        user = await db.user.update({
          where: { id: user.id },
          data: {
            username: userData.username,
            email: userData.email,
            pterodactylId: pteroId,
            discordAccessToken: tokenData.access_token,
            discordRefreshToken: tokenData.refresh_token,
            updatedAt: new Date()
          }
        });
      }

      if (user.twoFactorEnabled) {
        // Set a flag in session that 2FA is required
        req.session.twoFactorPending = true;
        req.session.twoFactorUserId = user.id;
        req.session.tempUserInfo = {
          id: user.id,
          username: user.username,
          email: user.email
        };

        // Redirect to 2FA verification page instead of dashboard
        return res.redirect('/auth/2fa');
      }

      // Set up session - now using internal userId as the primary identifier
      req.session.userinfo = {
        id: user.id,
        username: user.username,
        email: user.email,
        global_name: userData.global_name || userData.username
      };

      // Fetch and set Pterodactyl session data
      const pteroData = await fetchPterodactylData(pteroId);
      req.session.pterodactyl = pteroData.attributes;

      // Add user to Discord server using userId for identification
      await addDiscordServerMember(userData.id, tokenData.access_token, userData.username);

      // Add login notification
      await db.notification.create({ data: { userId: user.id, action: "user:auth", name: "Sign in with Discord" } });

      res.redirect('/dashboard');
    } catch (error) {
      console.error('Discord authentication failed:', error);

      if (error?.code === 'P2002') {
        return redirectAuthError('discord_email_in_use');
      }

      if (error.response?.status === 400 || error.response?.status === 401) {
        return redirectAuthError('discord_oauth_error');
      }

      return redirectAuthError('discord_auth_failed');
    }
  });

  // Token refresh endpoint
  app.post('/auth/discord/refresh', async (req, res) => {
    if (!req.session.userinfo) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const userId = req.session.userinfo.id;
    const user = await db.user.findUnique({ where: { id: userId } });

    if (!user?.discordRefreshToken) {
      return res.status(400).json({ error: 'No refresh token available' });
    }

    try {
      const response = await axios.post('https://discord.com/api/v10/oauth2/token',
        new URLSearchParams({
          client_id: DISCORD_CLIENT_ID,
          client_secret: DISCORD_CLIENT_SECRET,
          grant_type: 'refresh_token',
          refresh_token: user.discordRefreshToken,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const tokenData = response.data;

      // Update stored tokens
      await db.user.update({
        where: { id: user.id },
        data: {
          discordAccessToken: tokenData.access_token,
          discordRefreshToken: tokenData.refresh_token,
          updatedAt: new Date()
        }
      });

      res.json({ message: 'Token refreshed successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to refresh token' });
    }
  });
};
