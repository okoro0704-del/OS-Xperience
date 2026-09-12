import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(root, "api");
const env = {
  ...process.env,
  DATABASE_URL:
    process.env.DATABASE_URL ?? "postgresql://xperience:change-me@localhost:5432/xperience",
};

let args = process.argv.slice(2);
if (args[0] === "migrate" && args.length === 1) {
  args = ["migrate", "deploy"];
}

const result = spawnSync("npx", ["prisma", ...args, "--schema", "prisma/schema.prisma"], {
  cwd: apiDir,
  env,
  stdio: "inherit",
  shell: true,
});
process.exit(result.status ?? 1);
