"use strict";

const dbProvider = (process.env.DB_PROVIDER || "sqlite").toLowerCase();
const { PrismaClient } = dbProvider === "mysql"
  ? require("./generated/mysql-client")
  : require("@prisma/client");

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
    const databaseUrl = dbProvider === "mysql"
      ? (process.env.MYSQL_DATABASE_URL || process.env.DATABASE_URL)
      : (process.env.SQLITE_DATABASE_URL || process.env.DATABASE_URL);

    prisma = new PrismaClient({
      ...(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : {}),
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
