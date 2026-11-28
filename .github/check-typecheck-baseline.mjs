import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(root, ".github", "typecheck-baseline.json");

const packages = [
  { id: "front", filter: "@workspace/ka-imports" },
  { id: "api", filter: "@workspace/api-server" },
  { id: "scripts", filter: "@workspace/scripts" },
];

function countErrors(filter) {
  const result = spawnSync("pnpm", ["--filter", filter, "run", "typecheck"], {
    cwd: root,
    encoding: "utf8",
  });
  const text = `${result.stdout || ""}\n${result.stderr || ""}`;
  return (text.match(/error TS\d+/g) || []).length;
}

const counts = {};
for (const pkg of packages) {
  counts[pkg.id] = countErrors(pkg.filter);
  console.log(`${pkg.id}: ${counts[pkg.id]} erros de typecheck`);
}

if (process.argv.includes("--write")) {
  writeFileSync(baselinePath, `${JSON.stringify(counts, null, 2)}\n`);
  console.log(`baseline gravada em ${baselinePath}`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
let failed = false;
for (const pkg of packages) {
  const allowed = Number(baseline[pkg.id]);
  if (!Number.isInteger(allowed)) {
    console.error(`baseline sem contagem inteira para ${pkg.id}`);
    failed = true;
    continue;
  }
  if (counts[pkg.id] > allowed) {
    console.error(`${pkg.id} subiu de ${allowed} para ${counts[pkg.id]} erros`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
