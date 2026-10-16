"use strict";

const assert = require("assert");
const updater = require("../modules/updater.js");

async function runTests() {
  console.log("--- Testing Updater Module ---");

  // 1. Verify Manifest
  assert.ok(updater.HeliactylModule, "Manifest exists");
  assert.strictEqual(updater.HeliactylModule.name, "Updater");
  assert.strictEqual(updater.HeliactylModule.version, "1.2.0");
  assert.strictEqual(updater.HeliactylModule.api_level, 4);
  assert.strictEqual(updater.HeliactylModule.target_platform, "10.0.0");
  assert.strictEqual(updater.HeliactylModule.author.name, "aachul123");
  console.log("' Manifest verification passed");

  // 2. Test routes setup and mock DB / App
  const routes = {};
  const mockApp = {
    get: (path, handler) => { routes[`GET ${path}`] = handler; },
    post: (path, handler) => { routes[`POST ${path}`] = handler; }
  };

  const store = {};
  const mockDb = {
    heliactyl: {
      findUnique: async ({ where }) => {
        return store[where.key] ? { value: store[where.key] } : null;
      },
      upsert: async ({ where, update, create }) => {
        store[where.key] = update.value;
        return { value: store[where.key] };
      }
    },
    user: {
      findUnique: async () => ({
        id: 1,
        username: "admin",
        email: "admin@example.com",
        pterodactylId: 100,
        roles: [
          { role: { permissions: JSON.stringify(["admin.updater.manage", "*"]) } }
        ]
      })
    }
  };

  await updater.load(mockApp, mockDb);

  assert.ok(routes["GET /api/admin/updater/config"], "GET /api/admin/updater/config exists");
  assert.ok(routes["POST /api/admin/updater/config"], "POST /api/admin/updater/config exists");
  assert.ok(routes["GET /api/admin/updater/status"], "GET /api/admin/updater/status exists");
  assert.ok(routes["POST /api/admin/updater/trigger"], "POST /api/admin/updater/trigger exists");
  assert.ok(routes["POST /api/webhooks/github"], "POST /api/webhooks/github exists");
  console.log("' Routes registered successfully");

  // 3. Test Config GET and POST
  let resStatus = 200;
  let resData = null;
  const mockRes = {
    status: (code) => { resStatus = code; return mockRes; },
    json: (data) => { resData = data; return mockRes; }
  };
  const adminReq = {
    session: {
      userinfo: { id: 1 },
      pterodactyl: { id: 100 },
      adminStatusCache: { isAdmin: true, timestamp: Date.now() }
    },
    body: {}
  };

  // Initial config should have defaults
  await routes["GET /api/admin/updater/config"](adminReq, mockRes);
  assert.strictEqual(resData.enabled, true);
  assert.strictEqual(resData.checkInterval, 30);
  assert.strictEqual(resData.maxBackups, 3);
  console.log("' Initial config returns defaults");

  // Update config
  adminReq.body = { enabled: false, checkInterval: 60, maxBackups: 5, webhookSecret: "secret123" };
  await routes["POST /api/admin/updater/config"](adminReq, mockRes);
  assert.strictEqual(resData.success, true);
  assert.strictEqual(resData.config.enabled, false);
  assert.strictEqual(resData.config.checkInterval, 60);
  assert.strictEqual(resData.config.maxBackups, 5);
  console.log("' Config update persists correctly");

  // Secret is masked on retrieval
  await routes["GET /api/admin/updater/config"](adminReq, mockRes);
  assert.strictEqual(resData.webhookSecret, "*********");
  console.log("' Webhook secret is masked on GET");

  // Invalid checkInterval validation
  adminReq.body = { checkInterval: 2 };
  await routes["POST /api/admin/updater/config"](adminReq, mockRes);
  assert.strictEqual(resStatus, 400);
  console.log("' Invalid checkInterval rejection passed");

  // 4. Test Webhook with matching / non-matching secret
  const unauthReq = { query: { secret: "wrong" }, headers: {} };
  await routes["POST /api/webhooks/github"](unauthReq, mockRes);
  assert.strictEqual(resStatus, 403);
  console.log("' Unauthorized webhook rejected");

  const pingReq = {
    query: { secret: "secret123" },
    headers: { "x-github-event": "ping" }
  };
  await routes["POST /api/webhooks/github"](pingReq, mockRes);
  assert.strictEqual(resData.status, "ignored");
  console.log("' Webhook ping recognized");

  console.log("Ø<ß‰ All updater module tests passed successfully!");
}

runTests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
