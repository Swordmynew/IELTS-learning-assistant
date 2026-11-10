import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const virtualPython = join(root, "backend", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const python = existsSync(virtualPython) ? virtualPython : process.platform === "win32" ? "python" : "python3";
const result = spawnSync(python, [join(root, "backend/scripts/import_starter_vocabulary.py"), ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
  shell: false,
});
if (result.error) {
  console.error("Python 3.11+ is required. Install Python or create backend/.venv, then retry npm run setup:vocabulary.");
  process.exit(1);
}
process.exit(result.status ?? 1);
