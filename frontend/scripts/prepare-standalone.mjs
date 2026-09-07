import { cpSync, existsSync, mkdirSync } from "node:fs";

mkdirSync(".next/standalone/.next", { recursive: true });
cpSync(".next/static", ".next/standalone/.next/static", {
  recursive: true,
  force: true,
});

if (existsSync("public")) {
  cpSync("public", ".next/standalone/public", { recursive: true, force: true });
}
