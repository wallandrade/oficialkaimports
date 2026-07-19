import { Router, type IRouter, type Response } from "express";
import { getAdminScope, requireAdminAuth } from "./admin-auth";
import { DEFAULT_TENANT_ID } from "../lib/tenant-context";

const router: IRouter = Router();

const clients = new Map<Response, string>();

type NotificationEvent = { type: string; data: Record<string, unknown> };

function resolveEventTenantId(event: NotificationEvent): string {
  const rawTenantId = event?.data?.tenantId;
  const tenantId = typeof rawTenantId === "string" ? rawTenantId.trim() : "";
  return tenantId || DEFAULT_TENANT_ID;
}

export function broadcastNotification(event: NotificationEvent) {
  const eventTenantId = resolveEventTenantId(event);
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const [res, clientTenantId] of clients.entries()) {
    if (clientTenantId !== eventTenantId) {
      continue;
    }
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

router.get("/admin/notifications", (req, res, next) => {
  const legacyQueryToken = String((req.query as Record<string, string>)?.token || "").trim();
  if (legacyQueryToken) {
    // Legacy client (token in URL): return 204 to end SSE without reconnection noise.
    res.status(204).end();
    return;
  }

  next();
}, requireAdminAuth, (req, res) => {
  const tenantId = getAdminScope(req)?.tenantId || DEFAULT_TENANT_ID;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: "connected", data: { tenantId } })}\n\n`);

  clients.set(res, tenantId);

  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch {
      clearInterval(heartbeat);
      clients.delete(res);
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});

export default router;
