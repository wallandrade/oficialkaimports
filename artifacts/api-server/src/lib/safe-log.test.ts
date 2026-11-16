import assert from "node:assert/strict";
import test from "node:test";
import {
  installSafeConsole,
  isDuplicateDatabaseError,
  publicErrorMessage,
  sanitizeForLog,
  sanitizeHttpBody,
} from "./safe-log";

const EMAIL = "pessoa@example.test";
const PASSWORD = "senha-de-teste";
const HASH = "hash-de-teste-nao-e-segredo";
const SALT = "salt-de-teste";
const TOKEN = "token-de-teste";
const CPF = "000.000.000-00";
const PHONE = "(11) 98888-7777";
const STREET = "Rua de Teste";
const SQL = `INSERT INTO customer_users (email, password_hash, salt) VALUES ('${EMAIL}', '${HASH}', '${SALT}')`;

function dumped(value: unknown): string {
  return JSON.stringify(value);
}

function assertNoSecrets(value: unknown) {
  const text = dumped(value);
  for (const secret of [EMAIL, PASSWORD, HASH, SALT, TOKEN, CPF, PHONE, STREET, "INSERT INTO", "password_hash", "mysql://"]) {
    assert.equal(text.includes(secret), false, `vazou: ${secret}`);
  }
}

test("erro de banco no log fica só com código e mensagem genérica", () => {
  const cause = {
    code: "ER_DUP_ENTRY",
    errno: 1062,
    sqlState: "23000",
    sqlMessage: `Duplicate entry '${EMAIL}' for key 'customer_users.email'`,
    sql: SQL,
  };
  const wrapper = new Error(
    `Failed query: insert into customer_users (email, password_hash, salt) values (?, ?, ?)\nparams: ${EMAIL}, ${HASH}, ${SALT}`,
    { cause },
  );
  Object.assign(wrapper, { query: SQL, params: [EMAIL, HASH, SALT] });

  const safe = sanitizeForLog(wrapper) as { code?: string; errno?: number; sqlState?: string; message?: string };
  assert.equal(safe.code, "ER_DUP_ENTRY");
  assert.equal(safe.errno, 1062);
  assert.equal(safe.sqlState, "23000");
  assert.equal(safe.message, "Registro duplicado");
  assertNoSecrets(safe);
  assert.equal(isDuplicateDatabaseError(wrapper), true);
});

test("sqlMessage com o valor duplicado não é gravado", () => {
  const safe = sanitizeForLog({
    sqlMessage: `Duplicate entry '${EMAIL}' for key 'customer_users.email'`,
    sql: SQL,
  }) as Record<string, unknown>;
  assert.equal(safe.message, "Registro duplicado");
  assert.equal("sql" in safe, false);
  assert.equal("sqlMessage" in safe, false);
  assertNoSecrets(safe);
});

test("objeto de cliente, corpo, pagamento e frete perdem campos sensíveis", () => {
  const safe = sanitizeForLog({
    id: "cus_1",
    name: "Ana",
    email: EMAIL,
    password: PASSWORD,
    passwordHash: HASH,
    salt: SALT,
    document: CPF,
    phone: "11988887777",
    token: TOKEN,
    address: { street: STREET, cep: "00000-000" },
    body: { email: EMAIL, password: PASSWORD },
    headers: { authorization: `Bearer ${TOKEN}`, cookie: `admin_session=${TOKEN}`, accept: "application/json" },
    client: { email: EMAIL, phone: PHONE, document: CPF },
    pixCode: "00020126PIX-DE-TESTE-NAO-REAL-COM-MAIS-TEXTO",
    params: [EMAIL, HASH, SALT],
    query: { page: "1", token: TOKEN },
    amount: 10,
  }) as Record<string, unknown>;

  assert.equal(safe.id, "cus_1");
  assert.equal(safe.name, "Ana");
  assert.equal(safe.amount, 10);
  assert.equal(safe.email, "[REDACTED]");
  assert.equal(safe.password, "[REDACTED]");
  assert.equal(safe.passwordHash, "[REDACTED]");
  assert.equal(safe.salt, "[REDACTED]");
  assert.equal(safe.body, "[REDACTED]");
  assert.equal(safe.address, "[REDACTED]");
  assert.equal(safe.params, "[REDACTED]");
  assert.equal((safe.headers as { accept?: string; authorization?: string }).accept, "application/json");
  assert.equal((safe.headers as { authorization?: string }).authorization, "[REDACTED]");
  assert.equal((safe.query as { page?: string; token?: string }).page, "1");
  assert.equal((safe.query as { token?: string }).token, "[REDACTED]");
  assert.equal((safe.client as { email?: string }).email, "[REDACTED]");
  assertNoSecrets(safe);
});

test("texto solto perde e-mail, token e URL do banco", () => {
  const safe = sanitizeForLog(
    `falha ${EMAIL} Bearer ${TOKEN} cookie: admin_session=${TOKEN} GET /api?token=${TOKEN}&page=1 mysql://user:${PASSWORD}@localhost/loja`,
  );
  assert.equal(typeof safe, "string");
  assertNoSecrets(safe);
  assert.match(String(safe), /page=1/);
});

test("texto com SQL vira mensagem genérica", () => {
  const duplicate = sanitizeForLog(`Duplicate entry '${EMAIL}' for key 'customer_users.email'. Failed query: ${SQL}`);
  assert.equal(duplicate, "Registro duplicado");
  assertNoSecrets(duplicate);
  const other = sanitizeForLog(`Failed query: ${SQL}\nparams: ${EMAIL}, ${HASH}, ${SALT}`);
  assert.equal(other, "Erro de banco de dados");
  assertNoSecrets(other);
});

test("JSON de erro stringificado não leva o comando", () => {
  const raw = JSON.stringify({
    message: `Duplicate entry '${EMAIL}' for key 'customer_users.email'`,
    sql: SQL,
    sqlMessage: `Duplicate entry '${EMAIL}' for key 'customer_users.email'`,
    code: "ER_DUP_ENTRY",
    errno: 1062,
  });
  const safe = sanitizeForLog(raw);
  assertNoSecrets(safe);
  assert.match(String(safe), /Registro duplicado/);
  assert.match(String(safe), /ER_DUP_ENTRY/);
});

test("telefone na URL fica só com os 4 últimos dígitos", () => {
  const samples = [
    ["11999991234", "***1234"],
    ["5511999991234", "***1234"],
    ["+5511999991234", "***1234"],
    ["+55 (11) 99999-1234", "***1234"],
    ["+55 11 99999-1234", "***1234"],
    ["(11) 99999-1234", "***1234"],
    ["(11) 98888-7777", "***7777"],
    ["11 99999-1234", "***1234"],
    ["21987654321", "***4321"],
  ] as const;
  for (const [input, expected] of samples) {
    const safe = String(sanitizeForLog(`contato ${input} fim`));
    assert.equal(safe, `contato ${expected} fim`, input);
    assert.equal(safe.includes(input), false);
  }
});

test("CPF, e-mail e URL com vários parâmetros não vazam dado pessoal", () => {
  const cpf = sanitizeForLog("documento 529.982.247-25 e 39053344705");
  assert.equal(cpf, `documento ${"[REDACTED]"} e ${"[REDACTED]"}`);
  assert.equal(String(cpf).includes("529"), false);
  assert.equal(String(cpf).includes("39053344705"), false);

  const email = sanitizeForLog("avisar pessoa@example.test agora");
  assert.equal(email, "avisar [REDACTED] agora");

  const line = [
    "[REQ] GET /api/raffles/reservations/lookup",
    "?query=11999991234",
    "&raffleId=rifa-1",
    "&phone=%2811%29%2098888-7777",
    "&cpf=529.982.247-25",
    "&email=pessoa%40example.test",
    "&nome=Maria%20Silva",
    "&token=sekret-token",
    "&q=5511988887777",
    "&page=2 -> 200 18ms",
  ].join("");
  const safe = String(sanitizeForLog(line));
  assert.match(safe, /query=\*\*\*1234/);
  assert.match(safe, /phone=\*\*\*7777/);
  assert.match(safe, /q=\*\*\*7777/);
  assert.match(safe, /cpf=\[REDACTED\]/);
  assert.match(safe, /email=\[REDACTED\]/);
  assert.match(safe, /nome=\[REDACTED\]/);
  assert.match(safe, /token=\[REDACTED\]/);
  assert.match(safe, /raffleId=rifa-1/);
  assert.match(safe, /page=2/);
  assert.match(safe, /200 18ms/);
  for (const secret of [
    "11999991234",
    "98888",
    "5511988887777",
    "529.982.247-25",
    "52998224725",
    "pessoa@example.test",
    "Maria",
    "sekret-token",
  ]) {
    assert.equal(safe.includes(secret), false, secret);
  }
});

test("linha com SQL continua genérica mesmo com telefone na URL", () => {
  const safe = sanitizeForLog(
    "Failed query: INSERT INTO customer_users (email, password_hash) VALUES ('pessoa@example.test', 'hash') ?query=11999991234",
  );
  assert.equal(safe, "Erro de banco de dados");
  assert.equal(String(safe).includes("11999991234"), false);
  assert.equal(String(safe).includes("INSERT INTO"), false);
});

test("console da request não imprime o telefone da URL", () => {
  const target = console as typeof console & { __kaSafeLogInstalled?: boolean };
  const previousFlag = target.__kaSafeLogInstalled;
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const patched = console as unknown as Record<(typeof methods)[number], (...args: unknown[]) => void>;
  const previous = Object.fromEntries(methods.map((method) => [method, patched[method]])) as Record<(typeof methods)[number], (...args: unknown[]) => void>;
  const lines: string[] = [];
  target.__kaSafeLogInstalled = false;
  patched.log = (...args: unknown[]) => {
    lines.push(args.map((arg) => typeof arg === "string" ? arg : JSON.stringify(arg)).join(" "));
  };
  try {
    installSafeConsole();
    console.log("[REQ] GET /api/raffles/reservations/lookup?query=11999991234&page=2 -> 200 18ms");
    const text = lines.join("\n");
    assert.match(text, /query=\*\*\*1234/);
    assert.match(text, /page=2/);
    assert.equal(text.includes("11999991234"), false);
  } finally {
    for (const method of methods) patched[method] = previous[method]!;
    target.__kaSafeLogInstalled = previousFlag;
  }
});

test("log operacional sem segredo permanece", () => {
  const line = "[CHECKOUT/PIX:ab12] PIX generated — transactionId: tx_123";
  assert.equal(sanitizeForLog(line), line);
});

test("resposta HTTP mantém data de coluna como ISO", () => {
  const createdAt = new Date("2026-11-13T15:09:00.000Z");
  const body = sanitizeHttpBody({
    id: "cus_1",
    createdAt,
    submittedAt: createdAt,
    approvedAt: null,
    invalid: new Date(Number.NaN),
  }) as { createdAt: string; submittedAt: string; approvedAt: null; invalid: null };
  assert.equal(body.createdAt, "2026-11-13T15:09:00.000Z");
  assert.equal(body.submittedAt, body.createdAt);
  assert.equal(body.approvedAt, null);
  assert.equal(body.invalid, null);
  assert.equal(JSON.stringify(sanitizeHttpBody({ createdAt })), JSON.stringify({ createdAt }));
});

test("resposta HTTP não devolve SQL e o cadastro duplicado continua amigável", () => {
  const friendly = "Já existe uma conta com esse e-mail. Entre com a senha ou peça para a loja redefinir.";
  const kept = sanitizeHttpBody({
    error: "CONFLICT",
    message: friendly,
    user: { id: "cus_1", email: EMAIL, name: "Ana" },
  }) as { message: string; user: { email: string } };
  assert.equal(kept.message, friendly);
  assert.equal(kept.user.email, EMAIL);

  const leaked = sanitizeHttpBody({
    error: true,
    message: `Failed query: ${SQL}\nparams: ${EMAIL}, ${HASH}, ${SALT}`,
    stack: `Error: Failed query: ${SQL}`,
    sql: SQL,
    sqlMessage: `Duplicate entry '${EMAIL}' for key 'customer_users.email'`,
  }) as { message?: string; sql?: string; stack?: string };
  assert.equal(leaked.message, "Registro duplicado");
  assert.equal(leaked.sql, undefined);
  assert.equal(leaked.stack, undefined);
  assertNoSecrets(leaked);

  const driver = Object.assign(new Error(`Duplicate entry '${EMAIL}' for key 'customer_users.email'`), {
    code: "ER_DUP_ENTRY",
    errno: 1062,
    sql: SQL,
  });
  assert.equal(publicErrorMessage(driver, "Erro ao criar conta."), "Registro duplicado");
});

test("console.error instalado não imprime o SQL", () => {
  const target = console as typeof console & { __kaSafeLogInstalled?: boolean };
  const previousFlag = target.__kaSafeLogInstalled;
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const patched = console as unknown as Record<(typeof methods)[number], (...args: unknown[]) => void>;
  const previous = Object.fromEntries(methods.map((method) => [method, patched[method]])) as Record<(typeof methods)[number], (...args: unknown[]) => void>;
  const lines: string[] = [];
  target.__kaSafeLogInstalled = false;
  patched.error = (...args: unknown[]) => {
    lines.push(args.map((arg) => typeof arg === "string" ? arg : JSON.stringify(arg)).join(" "));
  };
  try {
    installSafeConsole();
    console.error("[CustomerAuth] register error:", {
      code: "ER_DUP_ENTRY",
      errno: 1062,
      sqlState: "23000",
      sql: SQL,
      sqlMessage: `Duplicate entry '${EMAIL}' for key 'customer_users.email'`,
    });
    const text = lines.join("\n");
    assert.match(text, /\[CustomerAuth\] register error:/);
    assert.match(text, /ER_DUP_ENTRY/);
    assert.match(text, /Registro duplicado/);
    assert.equal(text.includes(EMAIL), false);
    assert.equal(text.includes("INSERT INTO"), false);
    assert.equal(text.includes(HASH), false);
  } finally {
    for (const method of methods) patched[method] = previous[method]!;
    target.__kaSafeLogInstalled = previousFlag;
  }
});
