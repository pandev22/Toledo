"use strict";

const { PrismaClient } = require("@prisma/client");

/**
 * Prisma singleton — every module receives this same instance via `load(app, db)`.
 *
 * Usage in modules:
 *   const user = await db.user.findUnique({ where: { id } });
 *   await db.transaction.create({ data: { ... } });
 *   await db.$transaction([...]);   // atomic batches
 */

let prisma;

function getClient() {
  if (!prisma) {
    prisma = new PrismaClient({
      log:
        process.env.NODE_ENV === "development"
          ? ["warn", "error"]
          : ["error"],
    });
  }
  return prisma;
}

const db = getClient();

/**
 * Graceful shutdown — call from process exit handlers.
 */
async function disconnect() {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}

module.exports = db;
module.exports.disconnect = disconnect;
