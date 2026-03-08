const express = require('express');
const rateLimit = require('express-rate-limit');
const loadConfig = require('../../handlers/config');
const settings = loadConfig('./config.toml');
const axios = require('axios');
const getPteroUser = require('../../handlers/getPteroUser');
const log = require('../../handlers/log');
const cache = require('../../handlers/cache');
const { validate, schemas } = require('../../handlers/validate');

// Dynamic eggs helper - will be initialized in load()
let getEggsFromDB = null;

// Ensure Pterodactyl domain is properly formatted
if (settings.pterodactyl?.domain?.slice(-1) === '/') {
    settings.pterodactyl.domain = settings.pterodactyl.domain.slice(0, -1);
}

// Pterodactyl API helper (Application API)
const pteroApi = axios.create({
    baseURL: settings.pterodactyl.domain,
    headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${settings.pterodactyl.key}`
    }
});

// Pterodactyl Client API helper (for /api/client/ endpoints)
const pteroClientApi = axios.create({
    baseURL: settings.pterodactyl.domain,
    headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${settings.pterodactyl.client_key}`
    }
});

/* --------------------------------------------- */
/* Heliactyl Next Module                                  */
/* --------------------------------------------- */
const HeliactylModule = {
    "name": "Servers",
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

// Rate limiters
const createServerLimiter = rateLimit({
    windowMs: 3000, // 3 seconds
    max: 1,
    message: { error: 'Too many server creation requests. Please wait 3 seconds.' },
    standardHeaders: true,
    legacyHeaders: false
});

// Helper functions
async function checkUserResources(userId, db, additionalResources = { ram: 0, disk: 0, cpu: 0 }) {
    const userRecord = await db.user.findUnique({ where: { id: userId }, select: { packageName: true, extraRam: true, extraDisk: true, extraCpu: true, extraServers: true } });
    const packageName = userRecord?.packageName;
    const package = settings.api.client.packages.list[packageName || settings.api.client.packages.default];
    const extra = userRecord ? { ram: userRecord.extraRam, disk: userRecord.extraDisk, cpu: userRecord.extraCpu, servers: userRecord.extraServers } : { ram: 0, disk: 0, cpu: 0, servers: 0 };

    // Use cache for Pterodactyl user data (5 minutes TTL)
    const userServers = await cache.getOrSet(
        `ptero:user:${userId}:servers`,
        () => getPteroUser(userId, db),
        300
    );
    if (!userServers) throw new Error('Failed to fetch user servers');

    const usage = userServers.attributes.relationships.servers.data.reduce((acc, server) => ({
        ram: acc.ram + server.attributes.limits.memory,
        disk: acc.disk + server.attributes.limits.disk,
        cpu: acc.cpu + server.attributes.limits.cpu,
        servers: acc.servers + 1
    }), { ram: 0, disk: 0, cpu: 0, servers: 0 });

    return {
        allowed: {
            ram: package.ram + extra.ram,
            disk: package.disk + extra.disk,
            cpu: package.cpu + extra.cpu,
            servers: package.servers + extra.servers
        },
        used: usage,
        remaining: {
            ram: (package.ram + extra.ram) - (usage.ram + additionalResources.ram),
            disk: (package.disk + extra.disk) - (usage.disk + additionalResources.disk),
            cpu: (package.cpu + extra.cpu) - (usage.cpu + additionalResources.cpu),
            servers: (package.servers + extra.servers) - usage.servers
        }
    };
}

// Main module export
module.exports.load = async function (app, db) {
    const router = express.Router();

    // Initialize dynamic eggs helper
    try {
        const eggsModule = require('../eggs.js');
        getEggsFromDB = eggsModule.getEggsFromDB;
    } catch (e) {
        console.log('[EGGS] Dynamic eggs module not loaded');
    }

    // Middleware to check authentication
    router.use((req, res, next) => {
        if (!req.session.pterodactyl) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        next();
    });

    router.get('/eggs', async (req, res) => {
        try {
            // Get package name for restriction checking (with cache)
            const userRecord = await db.user.findUnique({ where: { id: req.session.userinfo.id }, select: { packageName: true } });
            const packageName = userRecord?.packageName;
            const userPackage = settings.api.client.packages.list[packageName || settings.api.client.packages.default];

            // Try dynamic eggs from database first
            if (getEggsFromDB) {
                try {
                    const dbEggs = await getEggsFromDB(db);

                    if (dbEggs && Object.keys(dbEggs).length > 0) {
                        // Filter and format eggs from database
                        const eggs = Object.entries(dbEggs)
                            .filter(([_, egg]) => egg.enabled)
                            .filter(([_, egg]) => {
                                // Check package restrictions
                                if (egg.packages && egg.packages.length > 0) {
                                    return egg.packages.includes(packageName || settings.api.client.packages.default);
                                }
                                return true;
                            })
                            .map(([id, egg]) => ({
                                id,
                                name: egg.displayName || egg.originalName,
                                description: egg.description || '',
                                category: egg.category || 'other',
                                minimum: {
                                    ram: egg.minimum?.ram || 0,
                                    disk: egg.minimum?.disk || 0,
                                    cpu: egg.minimum?.cpu || 0
                                },
                                maximum: egg.maximum || null,
                                info: egg.info || {},
                                startup: egg.startup || '',
                                image: egg.dockerImage || '',
                                requirements: {
                                    ram: Math.max(egg.minimum?.ram || 0, 1),
                                    disk: Math.max(egg.minimum?.disk || 0, 1),
                                    cpu: Math.max(egg.minimum?.cpu || 0, 1)
                                }
                            }));

                        return res.json(eggs);
                    }
                } catch (dbError) {
                    console.log('[EGGS] DB eggs fetch failed:', dbError.message);
                }
            }

            res.json([]);
        } catch (error) {
            console.error('Error fetching eggs:', error);
            res.status(500).json({ error: 'Failed to fetch eggs' });
        }
    });

    // GET /api/locations - List all available locations
    router.get('/locations', async (req, res) => {
        try {
            // Get package name for restriction checking (with cache)
            const userRecord = await db.user.findUnique({ where: { id: req.session.userinfo.id }, select: { packageName: true } });
            const packageName = userRecord?.packageName;
            const userPackage = settings.api.client.packages.list[packageName || settings.api.client.packages.default];

            // Filter and format locations
            const locations = Object.entries(settings.api.client.locations).map(([id, location]) => {
                // Check if location is restricted to specific packages
                if (location.package && !location.package.includes(packageName || settings.api.client.packages.default)) {
                    return null;
                }

                return {
                    id,
                    name: location.name || id,
                    description: location.description,
                    full: location.full || false,
                    flags: location.flags || []
                };
            }).filter(Boolean);

            res.json(locations);
        } catch (error) {
            console.error('Error fetching locations:', error);
            res.status(500).json({ error: 'Failed to fetch locations' });
        }
    });

    // GET /api/v5/nodes - List all available nodes
    router.get('/nodes', async (req, res) => {
        try {
            const response = await pteroApi.get('/api/application/nodes?per_page=10000');
            const nodes = response.data.data.map(node => ({
                id: node.attributes.id,
                name: node.attributes.name,
                locationId: node.attributes.location_id,
                fqdn: node.attributes.fqdn,
                memory: node.attributes.memory,
                disk: node.attributes.disk,
                allocated_resources: node.attributes.allocated_resources
            }));
            res.json(nodes);
        } catch (error) {
            console.error('Error fetching nodes:', error);
            res.status(500).json({ error: 'Failed to fetch nodes' });
        }
    });

    // GET /api/resources - Get user's resource usage and limits
    router.get('/resources', async (req, res) => {
        try {
            // Get package information (with cache)
            const userRecord = await db.user.findUnique({ where: { id: req.session.userinfo.id }, select: { packageName: true, extraRam: true, extraDisk: true, extraCpu: true, extraServers: true } });
            const packageName = userRecord?.packageName;
            const package = settings.api.client.packages.list[packageName || settings.api.client.packages.default];

            // Get extra resources (with cache)
            const extra = userRecord ? {
                ram: userRecord.extraRam,
                disk: userRecord.extraDisk,
                cpu: userRecord.extraCpu,
                servers: userRecord.extraServers
            } : {
                ram: 0,
                disk: 0,
                cpu: 0,
                servers: 0
            };
            // Get current resource usage
            const resources = await checkUserResources(req.session.userinfo.id, db);

            // Calculate percentages
            const percentages = {
                ram: (resources.used.ram / (package.ram + extra.ram)) * 100,
                disk: (resources.used.disk / (package.disk + extra.disk)) * 100,
                cpu: (resources.used.cpu / (package.cpu + extra.cpu)) * 100,
                servers: (resources.used.servers / (package.servers + extra.servers)) * 100
            };

            res.json({
                package: {
                    name: packageName || settings.api.client.packages.default,
                    ...package
                },
                extra,
                current: {
                    ...resources.used,
                    percentages
                },
                limits: {
                    ...resources.allowed
                },
                remaining: {
                    ...resources.remaining
                }
            });
        } catch (error) {
            if (error.message.includes('not linked')) {
                return res.status(400).json({ error: 'Pterodactyl account not linked' });
            }
            if (error.message.includes('authentication failed')) {
                return res.status(500).json({ error: 'Pterodactyl API authentication failed' });
            }
            res.status(500).json({ error: 'Failed to fetch resource information' });
        }
    });

    // GET /api/servers - List all servers
    router.get('/servers', async (req, res) => {
        try {
            const user = await cache.getOrSet(
                `ptero:user:${req.session.userinfo.id}:servers`,
                () => getPteroUser(req.session.userinfo.id, db),
                300
            );
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            res.json(user.attributes.relationships.servers.data);
        } catch (error) {
            if (error.message.includes('not linked')) {
                return res.status(400).json({ error: 'Pterodactyl account not linked' });
            }
            if (error.message.includes('authentication failed')) {
                return res.status(500).json({ error: 'Pterodactyl API authentication failed' });
            }
            res.status(500).json({ error: 'Failed to fetch servers' });
        }
    });

    // GET /api/servers/:id - Get specific server
    router.get('/server/:id', async (req, res) => {
        try {
            const user = await cache.getOrSet(
                `ptero:user:${req.session.userinfo.id}:servers`,
                () => getPteroUser(req.session.userinfo.id, db),
                300
            );
            const server = user.attributes.relationships.servers.data.find(
                s => s.attributes.id === req.params.id
            );

            if (!server) {
                return res.status(404).json({ error: 'Server not found' });
            }

            res.json(server);
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch server' });
        }
    });

    // POST /api/v5/servers - Create new server
    router.post('/servers', validate(schemas.serverCreate), async (req, res) => {
        try {
            if (!req.session.pterodactyl) return res.status(401).json({ error: 'Unauthorized' });

            const { name, egg, location, ram, disk, cpu } = req.body;

            // Get user's current resource usage and limits (with cache)
            const user = await cache.getOrSet(
                `ptero:user:${req.session.userinfo.id}:servers`,
                () => getPteroUser(req.session.userinfo.id, db),
                300
            );
            const userRecord = await db.user.findUnique({ where: { id: req.session.userinfo.id }, select: { packageName: true, extraRam: true, extraDisk: true, extraCpu: true, extraServers: true, pterodactylId: true } });
            const packageName = userRecord?.packageName;
            const package = settings.api.client.packages.list[packageName || settings.api.client.packages.default];
            const extra = userRecord ? {
                ram: userRecord.extraRam,
                disk: userRecord.extraDisk,
                cpu: userRecord.extraCpu,
                servers: userRecord.extraServers
            } : {
                ram: 0,
                disk: 0,
                cpu: 0,
                servers: 0
            };

            // Calculate current usage
            const usage = user.attributes.relationships.servers.data.reduce((acc, server) => ({
                ram: acc.ram + server.attributes.limits.memory,
                disk: acc.disk + server.attributes.limits.disk,
                cpu: acc.cpu + server.attributes.limits.cpu,
                servers: acc.servers + 1
            }), { ram: 0, disk: 0, cpu: 0, servers: 0 });

            // Check resource limits
            if (usage.servers >= package.servers + extra.servers) {
                return res.status(400).json({ error: 'Server limit reached' });
            }
            if (usage.ram + ram > package.ram + extra.ram) {
                return res.status(400).json({ error: 'Insufficient RAM available' });
            }
            if (usage.disk + disk > package.disk + extra.disk) {
                return res.status(400).json({ error: 'Insufficient disk space available' });
            }
            if (usage.cpu + cpu > package.cpu + extra.cpu) {
                return res.status(400).json({ error: 'Insufficient CPU available' });
            }

            // Get egg configuration - try dynamic DB first, then fallback to config
            let eggInfo = null;
            let pterodactylEggId = null;

            if (getEggsFromDB) {
                try {
                    const dbEggs = await getEggsFromDB(db);
                    if (dbEggs && dbEggs[egg]) {
                        const dbEgg = dbEggs[egg];
                        if (!dbEgg.enabled) {
                            return res.status(400).json({ error: 'This egg is not available' });
                        }
                        eggInfo = {
                            minimum: dbEgg.minimum,
                            maximum: dbEgg.maximum,
                            info: {
                                egg: dbEgg.pterodactylEggId,
                                docker_image: dbEgg.dockerImage,
                                startup: dbEgg.startup,
                                environment: dbEgg.environment || {},
                                feature_limits: dbEgg.featureLimits || { databases: 4, backups: 4 }
                            }
                        };
                        pterodactylEggId = dbEgg.pterodactylEggId;
                    }
                } catch (dbError) {
                    console.log('[EGGS] DB egg fetch failed:', dbError.message);
                }
            }

            if (!eggInfo) {
                return res.status(400).json({ error: 'Invalid egg specified' });
            }

            // Validate against egg minimums
            if (eggInfo.minimum) {
                if (ram < eggInfo.minimum.ram) {
                    return res.status(400).json({ error: `Minimum RAM required is ${eggInfo.minimum.ram}MB` });
                }
                if (disk < eggInfo.minimum.disk) {
                    return res.status(400).json({ error: `Minimum disk required is ${eggInfo.minimum.disk}MB` });
                }
                if (cpu < eggInfo.minimum.cpu) {
                    return res.status(400).json({ error: `Minimum CPU required is ${eggInfo.minimum.cpu}%` });
                }
            }

            // Create server specification
            const serverSpec = {
                name: name,
                user: userRecord?.pterodactylId,
                egg: eggInfo.info.egg,
                docker_image: eggInfo.info.docker_image,
                startup: eggInfo.info.startup,
                environment: eggInfo.info.environment,
                limits: {
                    memory: ram,
                    swap: -1,
                    disk: disk,
                    io: 500,
                    cpu: cpu
                },
                feature_limits: {
                    databases: 4,
                    backups: 4,
                    allocations: 10
                },
                deploy: {
                    locations: [location],
                    dedicated_ip: false,
                    port_range: []
                }
            };

            // Create server on Pterodactyl
            const response = await pteroApi.post('/api/application/servers', serverSpec);

            // Log server creation
            log('server_created',
                `User ${req.session.userinfo.username} created server "${name}" ` +
                `(RAM: ${ram}MB, CPU: ${cpu}%, Disk: ${disk}MB)`
            );

            // Invalidate user servers cache
            await cache.del(`ptero:user:${req.session.userinfo.id}:servers`);

            res.status(201).json(response.data);
        } catch (error) {
            if (error.response) {
                console.error('Pterodactyl API Error:', error.response.data);
                return res.status(400).json(error.response.data);
            }
            console.error('Error creating server:', error);
            res.status(500).json({ error: 'Failed to create server' });
        }
    });

    // PATCH /api/v5/servers/:idOrIdentifier - Modify server
    router.patch('/servers/:idOrIdentifier', validate(schemas.serverModify), async (req, res) => {
        try {
            if (!req.session.pterodactyl) return res.status(401).json({ error: 'Unauthorized' });

            const { ram, disk, cpu } = req.body;
            const idOrIdentifier = req.params.idOrIdentifier;

            // Get user's current resources and limits (with cache)
            const user = await cache.getOrSet(
                `ptero:user:${req.session.userinfo.id}:servers`,
                () => getPteroUser(req.session.userinfo.id, db),
                300
            );
            const userRecord = await db.user.findUnique({ where: { id: req.session.userinfo.id }, select: { packageName: true, extraRam: true, extraDisk: true, extraCpu: true, extraServers: true } });
            const packageName = userRecord?.packageName;
            const package = settings.api.client.packages.list[packageName || settings.api.client.packages.default];
            const extra = userRecord ? {
                ram: userRecord.extraRam,
                disk: userRecord.extraDisk,
                cpu: userRecord.extraCpu,
                servers: userRecord.extraServers
            } : {
                ram: 0,
                disk: 0,
                cpu: 0,
                servers: 0
            };

            // Find server by ID or identifier
            let server;
            let serverId;

            // Try to find the server in user's servers
            server = user.attributes.relationships.servers.data.find(
                s => s.attributes.id.toString() === idOrIdentifier || s.attributes.identifier === idOrIdentifier
            );

            // If not found, fetch server list from Pterodactyl API to find by identifier
            if (!server && !/^\d+$/.test(idOrIdentifier)) {
                // Fetch servers from Pterodactyl API
                const response = await pteroApi.get('/api/application/servers?per_page=100000');
                const allServers = response.data;

                // Find server with matching identifier
                const matchingServer = allServers.data.find(s => s.attributes.identifier === idOrIdentifier);

                if (matchingServer) {
                    // Check if this server belongs to the user
                    server = user.attributes.relationships.servers.data.find(
                        s => s.attributes.id.toString() === matchingServer.attributes.id.toString()
                    );

                    if (server) {
                        serverId = matchingServer.attributes.id;
                    }
                }
            } else if (server) {
                serverId = server.attributes.id;
            }

            if (!server || !serverId) {
                return res.status(404).json({ error: 'Server not found or not owned by you' });
            }

            // Calculate current usage excluding the server being modified
            const usage = user.attributes.relationships.servers.data.reduce((acc, s) => {
                if (s.attributes.id.toString() !== serverId.toString()) {
                    return {
                        ram: acc.ram + s.attributes.limits.memory,
                        disk: acc.disk + s.attributes.limits.disk,
                        cpu: acc.cpu + s.attributes.limits.cpu
                    };
                }
                return acc;
            }, { ram: 0, disk: 0, cpu: 0 });

            // Check resource limits with new values
            if (usage.ram + ram > package.ram + extra.ram) {
                return res.status(400).json({
                    error: `Insufficient RAM. Maximum available is ${package.ram + extra.ram - usage.ram}MB`
                });
            }
            if (usage.disk + disk > package.disk + extra.disk) {
                return res.status(400).json({
                    error: `Insufficient disk space. Maximum available is ${package.disk + extra.disk - usage.disk}MB`
                });
            }
            if (usage.cpu + cpu > package.cpu + extra.cpu) {
                return res.status(400).json({
                    error: `Insufficient CPU. Maximum available is ${package.cpu + extra.cpu - usage.cpu}%`
                });
            }

            // Get egg configuration to check minimums - try dynamic DB first
            let eggInfo = null;

            if (getEggsFromDB) {
                try {
                    const dbEggs = await getEggsFromDB(db);
                    if (dbEggs) {
                        for (const [_, dbEgg] of Object.entries(dbEggs)) {
                            if (dbEgg.pterodactylEggId === server.attributes.egg) {
                                eggInfo = { minimum: dbEgg.minimum };
                                break;
                            }
                        }
                    }
                } catch (dbError) {
                    console.log('[EGGS] DB egg lookup failed:', dbError.message);
                }
            }

            if (eggInfo?.minimum) {
                if (ram < eggInfo.minimum.ram) {
                    return res.status(400).json({ error: `Minimum RAM required is ${eggInfo.minimum.ram}MB` });
                }
                if (disk < eggInfo.minimum.disk) {
                    return res.status(400).json({ error: `Minimum disk required is ${eggInfo.minimum.disk}MB` });
                }
                if (cpu < eggInfo.minimum.cpu) {
                    return res.status(400).json({ error: `Minimum CPU required is ${eggInfo.minimum.cpu}%` });
                }
            }

            // Send update request to Pterodactyl
            const patchResponse = await pteroApi.patch(`/api/application/servers/${serverId}/build`, {
                allocation: server.attributes.allocation,
                memory: ram,
                swap: server.attributes.limits.swap,
                disk: disk,
                io: server.attributes.limits.io,
                cpu: cpu,
                feature_limits: server.attributes.feature_limits
            });

            // Log the modification
            log('server_modified',
                `User ${req.session.userinfo.username} modified server "${server.attributes.name}" ` +
                `(RAM: ${ram}MB, CPU: ${cpu}%, Disk: ${disk}MB)`
            );

            res.json(patchResponse.data);
        } catch (error) {
            if (error.response) {
                return res.status(400).json(error.response.data);
            }
            console.error('Error modifying server:', error);
            res.status(500).json({ error: 'Failed to modify server' });
        }
    });

    // DELETE /api/v5/servers/:idOrIdentifier - Delete server
    router.delete('/servers/:idOrIdentifier', async (req, res) => {
        try {
            if (!req.session.pterodactyl) return res.status(401).json({ error: 'Unauthorized' });

            const idOrIdentifier = req.params.idOrIdentifier;

            // Get user's current resources and servers (with cache)
            const user = await cache.getOrSet(
                `ptero:user:${req.session.userinfo.id}:servers`,
                () => getPteroUser(req.session.userinfo.id, db),
                300
            );
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            // Find server by ID or identifier
            let server;
            let serverId;

            // Try to find the server in user's servers
            server = user.attributes.relationships.servers.data.find(
                s => s.attributes.id.toString() === idOrIdentifier || s.attributes.identifier === idOrIdentifier
            );

            // If not found by user's servers and it's not a numeric ID, fetch all servers to find by identifier
            if (!server && !/^\d+$/.test(idOrIdentifier)) {
                // Fetch servers from Pterodactyl API
                const response = await pteroApi.get('/api/application/servers?per_page=100000');
                const allServers = response.data;

                // Find server with matching identifier
                const matchingServer = allServers.data.find(s => s.attributes.identifier === idOrIdentifier);

                if (matchingServer) {
                    // Check if this server belongs to the user
                    server = user.attributes.relationships.servers.data.find(
                        s => s.attributes.id.toString() === matchingServer.attributes.id.toString()
                    );

                    if (server) {
                        serverId = matchingServer.attributes.id;
                    }
                }
            } else if (server) {
                serverId = server.attributes.id;
            }

            if (!server || !serverId) {
                return res.status(404).json({ error: 'Server not found or not owned by you' });
            }

            // Check if server is suspended
            const serverInfoResponse = await pteroApi.get(`/api/application/servers/${serverId}`);
            const serverData = serverInfoResponse.data;
            if (serverData.attributes.suspended) {
                return res.status(400).json({ error: 'Cannot delete suspended server' });
            }

            // Send delete request to Pterodactyl
            await pteroApi.delete(`/api/application/servers/${serverId}/force`);

            // Log the deletion
            log('server_deleted',
                `User ${req.session.userinfo.username} deleted server "${server.attributes.name}"`
            );

            // Invalidate user servers cache
            await cache.del(`ptero:user:${req.session.userinfo.id}:servers`);

            res.status(204).send();
        } catch (error) {
            if (error.response) {
                return res.status(400).json(error.response.data);
            }
            console.error('Error deleting server:', error);
            res.status(500).json({ error: 'Failed to delete server' });
        }
    });

    // Proxy endpoint for Minecraft server status API (avoids CORS issues)
    router.get('/server/:id/minecraft-status', async (req, res) => {
        try {
            const serverId = req.params.id;

            // Verify user owns this server (with cache)
            const user = await cache.getOrSet(
                `ptero:user:${req.session.userinfo.id}:servers`,
                () => getPteroUser(req.session.userinfo.id, db),
                300
            );
            const server = user.attributes.relationships.servers.data.find(
                s => s.attributes.id === serverId || s.attributes.identifier === serverId
            );

            if (!server) {
                return res.status(403).json({ error: 'Access denied' });
            }

            // Get server info from Pterodactyl using Client API
            const serverResponse = await pteroClientApi.get(`/api/client/servers/${serverId}`);

            // Handle different possible response structures
            const serverData = serverResponse.data?.data || serverResponse.data;
            const attributes = serverData?.attributes || serverData;
            const relationships = attributes?.relationships || {};
            const allocations = relationships?.allocations?.data || [];

            const allocation = allocations[0];
            if (!allocation) {
                return res.status(404).json({ error: 'No allocation found for server' });
            }

            const allocAttrs = allocation.attributes || allocation;
            const ip = allocAttrs.ip_alias || allocAttrs.ip;
            const port = allocAttrs.port;

            // Query mcsrvstat.us API from server-side (no CORS issues)
            const statusResponse = await axios.get(`https://api.mcsrvstat.us/3/${ip}:${port}`, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Heliactyl/10.0.0'
                }
            });

            res.json(statusResponse.data);
        } catch (error) {
            console.error('Error fetching Minecraft status:', error.message);
            res.status(500).json({
                error: 'Failed to fetch Minecraft server status',
                online: false
            });
        }
    });

    // Mount the router
    app.use('/api/v5/', router);
};
