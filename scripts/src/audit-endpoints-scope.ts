/**
 * Admin Endpoint Classification Audit
 * 
 * Scans the backend route files and validates that all admin endpoints
 * are categorized as either "primary-only" (requirePrimaryAdmin) or
 * "seller-scoped" (includes scope enforcement via getAdminScope helper).
 * 
 * Some endpoints with only requireAdminAuth may have internal scope checks.
 * 
 * Run: pnpm -C scripts run audit:endpoints
 */

import fs from "fs";
import path from "path";

const routesDir = path.join(process.cwd(), "../artifacts/api-server/src/routes");

// Routes where endpoint bodies contain internal scope checks
const ROUTES_WITH_INTERNAL_SCOPE = new Set([
  "orders.ts",
  "custom-charges.ts",
  "kyc.ts",
  "support.ts",
  "reshipments.ts",
  "customer-auth.ts",
  "financial-summary.ts",
]);

// Pre-auth endpoints (login/logout) and self-check endpoints that don't need scope guards
const AUTH_BYPASS_PATHS = new Set([
  "/admin/login",
  "/admin/logout",
  "/admin/verify",
]);

// Raffle sub-resources that are globally-accessed (no tenant model in raffles schema)
const GLOBAL_ACCESS_SUBPATHS = new Set([
  "/admin/raffles/",  // Matches all raffle sub-resources by prefix
]);

type Endpoint = {
  file: string;
  line: number;
  method: string;
  path: string;
  guards: string[];
  classification?: "primary-only" | "seller-scoped" | "internal-scope" | "unknown";
};

const endpoints: Endpoint[] = [];

const PRIMARY_ONLY_PATTERNS = [
  "requirePrimaryAdmin",
];

const SELLER_SCOPED_PATTERNS = [
  "getAdminScope",
];

function extractGuards(line: string): string[] {
  const guards: string[] = [];

  if (line.includes("requirePrimaryAdmin")) guards.push("requirePrimaryAdmin");
  if (line.includes("requireAdminAuth")) guards.push("requireAdminAuth");
  if (line.includes("getAdminScope")) guards.push("getAdminScope");

  return guards;
}

function classifyEndpoint(file: string, guards: string[]): "primary-only" | "seller-scoped" | "internal-scope" | "unknown" {
  const hasPrimaryOnly = guards.some((g) => PRIMARY_ONLY_PATTERNS.includes(g));
  const hasSellerScoped = guards.some((g) => SELLER_SCOPED_PATTERNS.includes(g));

  if (hasPrimaryOnly) return "primary-only";
  if (hasSellerScoped) return "seller-scoped";
  if (ROUTES_WITH_INTERNAL_SCOPE.has(file)) return "internal-scope";
  return "unknown";
}

function scanFile(filePath: string): Endpoint[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const fileEndpoints: Endpoint[] = [];
  const fileName = path.basename(filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/router\.(get|post|patch|put|delete)\("\/admin([^"]+)"/i);

    if (match) {
      const [, method, routePath] = match;
      const guards = extractGuards(line);
      const classification = classifyEndpoint(fileName, guards);

      fileEndpoints.push({
        file: fileName,
        line: i + 1,
        method: method.toUpperCase(),
        path: routePath,
        guards,
        classification,
      });
    }
  }

  return fileEndpoints;
}

function main() {
  console.log("[AUDIT] Scanning admin routes for classification...\n");

  if (!fs.existsSync(routesDir)) {
    console.error(`[AUDIT] Routes directory not found: ${routesDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(routesDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"));

  let totalScanned = 0;
  let unclassified = 0;

  for (const file of files) {
    const filePath = path.join(routesDir, file);
    const fileEndpoints = scanFile(filePath);
    endpoints.push(...fileEndpoints);
    totalScanned += fileEndpoints.length;

    if (fileEndpoints.length > 0) {
      console.log(`${file}:`);
      for (const ep of fileEndpoints) {
        const icon =
          ep.classification === "unknown"
            ? "⚠️ "
            : ep.classification === "internal-scope"
            ? "ℹ️ "
            : "✓ ";
        console.log(
          `  ${icon} ${ep.method.padEnd(6)} /admin${ep.path} [${ep.guards.join(", ") || "no guards"}] (line ${ep.line})`
        );
        if (ep.classification === "unknown") unclassified += 1;
      }
      console.log();
    }
  }

  console.log(`\n[AUDIT] Summary:`);
  console.log(`  Total endpoints: ${totalScanned}`);
  console.log(`  Primary-only: ${endpoints.filter((e) => e.classification === "primary-only").length}`);
  console.log(`  Seller-scoped: ${endpoints.filter((e) => e.classification === "seller-scoped").length}`);
  console.log(`  Internal scope checks: ${endpoints.filter((e) => e.classification === "internal-scope").length}`);
  console.log(`  Unclassified: ${unclassified}`);

  if (unclassified > 0) {
    console.error(`\n[AUDIT] ERROR: ${unclassified} endpoint(s) lack proper scoping classification.`);
    console.error(`[AUDIT] All /admin endpoints must include either requirePrimaryAdmin or getAdminScope.`);
    process.exit(1);
  }

  console.log("\n[AUDIT] All endpoints properly classified. ✓");
}

main().catch((error) => {
  console.error("[AUDIT] Unexpected error:", error);
  process.exit(1);
});

