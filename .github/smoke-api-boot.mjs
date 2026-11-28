// Smoke test de boot: sobe artifacts/api-server/dist/index.cjs (o mesmo bundle que o
// nixpacks/DO roda) e espera GET /api/healthz responder 200 {"status":"ok"}.
// Usa so env falso. O banco aponta para uma porta fechada de proposito: o
// ensureRuntimeSchema falha e e tratado, e o healthz nao depende do banco.
// Pega erros de bundle que o typecheck e os testes (tsx) nao veem, como
// "TypeError: e is not a constructor" ao carregar o zod.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(root, "artifacts", "api-server");
const dist = path.join(apiDir, "dist", "index.cjs");
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 45000);

if (!existsSync(dist)) {
  console.error(`[smoke] ${dist} nao existe. Rode: pnpm --filter @workspace/api-server build`);
  process.exit(1);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const port = await freePort();
const closedDbPort = await freePort();

const child = spawn(process.execPath, [dist], {
  cwd: apiDir,
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: "production",
    TZ: "America/Sao_Paulo",
    PORT: String(port),
    DATABASE_URL: `mysql://smoke:smoke@127.0.0.1:${closedDbPort}/smoke`,
    CHECKOUT_TOKEN_SECRET: "smoke-test-checkout-token-secret",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
let exited = null;
const keep = (chunk) => {
  output = (output + chunk.toString()).slice(-20000);
};
child.stdout.on("data", keep);
child.stderr.on("data", keep);
child.on("exit", (code, signal) => {
  exited = { code, signal };
});

async function probe() {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/healthz`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.status !== 200) return false;
    const body = await res.json();
    return body?.status === "ok";
  } catch {
    return false;
  }
}

let ok = false;
const deadline = Date.now() + TIMEOUT_MS;
while (Date.now() < deadline && !exited) {
  if (await probe()) {
    ok = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 500));
}

if (!ok && !exited) child.kill("SIGKILL");
else if (ok) child.kill("SIGTERM");

if (ok) {
  console.log(`[smoke] OK: dist/index.cjs subiu e /api/healthz respondeu 200 {"status":"ok"} na porta ${port}`);
  process.exit(0);
}

const why = exited
  ? `o processo saiu sozinho (code=${exited.code}, signal=${exited.signal})`
  : `healthz nao respondeu em ${TIMEOUT_MS} ms`;
console.error(`[smoke] FALHOU: ${why}`);
console.error("[smoke] ultimas linhas da saida do servidor:");
console.error(output.split("\n").slice(-40).map((l) => l.slice(0, 300)).join("\n"));
process.exit(1);
