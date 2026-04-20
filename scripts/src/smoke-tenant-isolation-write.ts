type Role = "primary" | "scoped";
type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

type TestCase = {
  name: string;
  method?: Method;
  path: string;
  body?: Record<string, unknown>;
  role: Role;
  expected: number[];
  cleanup?: () => Promise<void>;
};

const baseUrl = (process.env.API_BASE_URL || "").replace(/\/$/, "");
const primaryToken = process.env.PRIMARY_ADMIN_TOKEN || "";
const scopedToken = process.env.SCOPED_ADMIN_TOKEN || "";
const scopedSellerCode = process.env.SCOPED_SELLER_CODE || "";
const foreignSellerCode = process.env.FOREIGN_SELLER_CODE || "";
const testOrderId = process.env.TEST_ORDER_ID || "";
const testChargeId = process.env.TEST_CHARGE_ID || "";

if (!baseUrl) {
  console.error("[SMOKE] Missing API_BASE_URL env var.");
  process.exit(1);
}

const readTests: TestCase[] = [
  // Primary-only endpoints should reject scoped admins.
  { name: "Products list (primary)", path: "/api/admin/products", role: "primary", expected: [200] },
  { name: "Products list (scoped)", path: "/api/admin/products", role: "scoped", expected: [403] },
  { name: "Settings read (primary)", path: "/api/admin/settings", role: "primary", expected: [200] },
  { name: "Settings read (scoped)", path: "/api/admin/settings", role: "scoped", expected: [403] },
  { name: "Sellers list (primary)", path: "/api/admin/sellers", role: "primary", expected: [200] },
  { name: "Sellers list (scoped)", path: "/api/admin/sellers", role: "scoped", expected: [403] },
  { name: "Inventory overview (primary)", path: "/api/admin/inventory/overview", role: "primary", expected: [200] },
  { name: "Inventory overview (scoped)", path: "/api/admin/inventory/overview", role: "scoped", expected: [403] },
  { name: "Raffles admin list (primary)", path: "/api/admin/raffles", role: "primary", expected: [200] },
  { name: "Raffles admin list (scoped)", path: "/api/admin/raffles", role: "scoped", expected: [403] },

  // Seller-scoped endpoints should work for both.
  { name: "Orders list (primary)", path: "/api/admin/orders", role: "primary", expected: [200] },
  { name: "Orders list (scoped)", path: "/api/admin/orders", role: "scoped", expected: [200] },
  { name: "Custom charges list (primary)", path: "/api/admin/custom-charges", role: "primary", expected: [200] },
  { name: "Custom charges list (scoped)", path: "/api/admin/custom-charges", role: "scoped", expected: [200] },
  { name: "KYC list (primary)", path: "/api/admin/kyc", role: "primary", expected: [200] },
  { name: "KYC list (scoped)", path: "/api/admin/kyc", role: "scoped", expected: [200] },
  { name: "Support tickets list (primary)", path: "/api/admin/support-tickets", role: "primary", expected: [200] },
  { name: "Support tickets list (scoped)", path: "/api/admin/support-tickets", role: "scoped", expected: [200] },
  { name: "Customers list (primary)", path: "/api/admin/customers", role: "primary", expected: [200] },
  { name: "Customers list (scoped)", path: "/api/admin/customers", role: "scoped", expected: [200] },
  { name: "Reshipments list (primary)", path: "/api/admin/reshipments", role: "primary", expected: [200] },
  { name: "Reshipments list (scoped)", path: "/api/admin/reshipments", role: "scoped", expected: [200] },
];

const writeTests: TestCase[] = [];

// Cross-seller filters
if (foreignSellerCode) {
  const encoded = encodeURIComponent(foreignSellerCode);
  readTests.push(
    {
      name: "Cross-seller orders filter (scoped)",
      path: `/api/admin/orders?sellerCode=${encoded}`,
      role: "scoped",
      expected: [403, 400],
    },
    {
      name: "Cross-seller financial summary (scoped)",
      path: `/api/admin/financial-summary?sellerCode=${encoded}`,
      role: "scoped",
      expected: [403, 400],
    },
    {
      name: "Cross-seller orders filter (primary)",
      path: `/api/admin/orders?sellerCode=${encoded}`,
      role: "primary",
      expected: [200],
    }
  );
}

// Write tests: only if test resources are provided
if (testOrderId && scopedSellerCode) {
  let originalObservation: string | undefined;

  writeTests.push({
    name: "Update order observation (scoped own seller)",
    method: "PATCH",
    path: `/api/admin/orders/${testOrderId}/observation`,
    body: { observation: "[TEST] Temporary observation from smoke test" },
    role: "scoped",
    expected: [200, 400],
    cleanup: async () => {
      if (typeof originalObservation === "string") {
        await fetch(`${baseUrl}/api/admin/orders/${testOrderId}/observation`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${scopedToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ observation: originalObservation }),
        });
      }
    },
  });

  if (foreignSellerCode) {
    writeTests.push({
      name: "Update order observation (scoped cross-seller)",
      method: "PATCH",
      path: `/api/admin/orders/${testOrderId}/observation?sellerCode=${encodeURIComponent(foreignSellerCode)}`,
      body: { observation: "[TEST] Attempt from foreign scope" },
      role: "scoped",
      expected: [403, 400, 404],
    });
  }
}

if (testChargeId && scopedSellerCode) {
  let originalChargeObs: string | undefined;

  writeTests.push({
    name: "Update charge observation (scoped own seller)",
    method: "PATCH",
    path: `/api/admin/custom-charges/${testChargeId}/observation`,
    body: { observation: "[TEST] Charge smoke test observation" },
    role: "scoped",
    expected: [200, 400],
    cleanup: async () => {
      if (typeof originalChargeObs === "string") {
        await fetch(`${baseUrl}/api/admin/custom-charges/${testChargeId}/observation`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${scopedToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ observation: originalChargeObs }),
        });
      }
    },
  });
}

function getToken(role: Role): string {
  return role === "primary" ? primaryToken : scopedToken;
}

async function runCase(test: TestCase): Promise<{ ok: boolean; status: number; error?: string }> {
  const token = getToken(test.role);
  if (!token) {
    return { ok: false, status: 0, error: `Missing token for role '${test.role}'` };
  }

  const url = `${baseUrl}${test.path}`;
  try {
    const response = await fetch(url, {
      method: test.method || "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: test.body ? JSON.stringify(test.body) : undefined,
    });

    const ok = test.expected.includes(response.status);
    return { ok, status: response.status };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  const allTests = [...readTests, ...writeTests];
  console.log(`[SMOKE] Running ${allTests.length} tenant-isolation checks against ${baseUrl}`);
  if (writeTests.length > 0) {
    console.log(`[SMOKE] Includes ${writeTests.length} write tests with cleanup.`);
  }

  let failures = 0;
  const cleanups: Array<() => Promise<void>> = [];

  for (const test of allTests) {
    const result = await runCase(test);
    if (result.ok) {
      console.log(`PASS [${test.role}] ${test.name} -> ${result.status}`);
      if (test.cleanup) {
        cleanups.push(test.cleanup);
      }
      continue;
    }

    failures += 1;
    if (result.error) {
      console.error(`FAIL [${test.role}] ${test.name} -> ${result.error}`);
    } else {
      console.error(
        `FAIL [${test.role}] ${test.name} -> got ${result.status}, expected one of [${test.expected.join(", ")}]`
      );
    }
  }

  console.log(`[SMOKE] Executing ${cleanups.length} cleanup task(s)...`);
  for (const cleanup of cleanups) {
    try {
      await cleanup();
    } catch (e) {
      console.warn(`[SMOKE] Cleanup error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (failures > 0) {
    console.error(`[SMOKE] ${failures} check(s) failed.`);
    process.exit(1);
  }

  console.log("[SMOKE] All checks passed.");
}

main().catch((error) => {
  console.error("[SMOKE] Unexpected error:", error);
  process.exit(1);
});
