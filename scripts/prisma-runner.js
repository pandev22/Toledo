"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const rawArgs = process.argv.slice(2);

let provider = (process.env.DB_PROVIDER || "sqlite").toLowerCase();
const prismaArgs = [];

for (const arg of rawArgs) {
  if (arg.startsWith("--provider=")) {
    provider = arg.split("=")[1].toLowerCase();
    continue;
  }

  prismaArgs.push(arg);
}

if (!prismaArgs.length) {
  console.error("Usage: node scripts/prisma-runner.js <prisma args> [--provider=sqlite|mysql]");
  process.exit(1);
}

const schemaPath = provider === "mysql"
  ? path.join("prisma", "schema.mysql.prisma")
  : path.join("prisma", "schema.prisma");

const env = { ...process.env };
if (provider === "mysql" && env.MYSQL_DATABASE_URL && !env.DATABASE_URL) {
  env.DATABASE_URL = env.MYSQL_DATABASE_URL;
}

if (provider === "sqlite" && env.SQLITE_DATABASE_URL && !env.DATABASE_URL) {
  env.DATABASE_URL = env.SQLITE_DATABASE_URL;
}

const executable = process.platform === "win32" ? "npx prisma" : "npx";
const result = spawnSync(executable, process.platform === "win32" ? [...prismaArgs, "--schema", schemaPath] : ["prisma", ...prismaArgs, "--schema", schemaPath], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 0);
