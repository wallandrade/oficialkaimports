type Role = "primary" | "scoped";

type TestCase = {
  name: string;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  role: Role;
  expected: number[];
};

const baseUrl = (process.env.API_BASE_URL || "").replace(/\/$/, "");
const primaryToken = process.env.PRIMARY_ADMIN_TOKEN || "";
const scopedToken = process.env.SCOPED_ADMIN_TOKEN || "";
const foreignSellerCode = process.env.FOREIGN_SELLER_CODE || "";

if (!baseUrl) {
  console.error("[SMOKE] Missing API_BASE_URL env var.");
  process.exit(1);
}

const tests: TestCase[] = [
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

  // Seller-scoped endpoints should still work for scoped admins.
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

if (foreignSellerCode) {
  const encoded = encodeURIComponent(foreignSellerCode);
  tests.push(
    {
      name: "Cross-seller orders filter blocked for scoped",
      path: `/api/admin/orders?sellerCode=${encoded}`,
      role: "scoped",
      expected: [403],
    },
    {
      name: "Cross-seller financial summary blocked for scoped",
      path: `/api/admin/financial-summary?sellerCode=${encoded}`,
      role: "scoped",
      expected: [403],
    },
    {
      name: "Cross-seller orders filter allowed for primary",
      path: `/api/admin/orders?sellerCode=${encoded}`,
      role: "primary",
      expected: [200],
    }
  );
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
    });

    const ok = test.expected.includes(response.status);
    return { ok, status: response.status };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  console.log(`[SMOKE] Running ${tests.length} tenant-isolation checks against ${baseUrl}`);

  let failures = 0;

  for (const test of tests) {
    const result = await runCase(test);
    if (result.ok) {
      console.log(`PASS [${test.role}] ${test.name} -> ${result.status}`);
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
