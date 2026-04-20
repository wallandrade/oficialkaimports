import { Router, type IRouter } from "express";
import { requirePrimaryAdmin } from "./admin-auth";

const router: IRouter = Router();

// In-memory store: sessionId -> { page, lastActive }
// Using a Map is fine here since it's just for a live counter on a single server instance.
const activeSessions = new Map<string, { page: string; lastActive: number }>();
const CLEANUP_INTERVAL_MS = 15000; // 15 seconds

// public: send heartbeat
router.post("/tracking/heartbeat", (req, res) => {
  const { sessionId, page } = req.body;
  
  if (!sessionId || !page) {
    res.status(400).json({ error: "Missing sessionId or page" });
    return;
  }
  
  activeSessions.set(sessionId, { page, lastActive: Date.now() });
  res.json({ ok: true });
});

// admin: get live counts
router.get("/admin/tracking/live", requirePrimaryAdmin, (req, res) => {
  const now = Date.now();
  let catalogCount = 0;
  let checkoutCount = 0;

  for (const [id, data] of activeSessions.entries()) {
    if (now - data.lastActive > CLEANUP_INTERVAL_MS) {
      // Clean up stale sessions lazily
      activeSessions.delete(id);
    } else {
      if (data.page === "catalog") {
        catalogCount++;
      } else if (data.page === "checkout") {
        checkoutCount++;
      }
    }
  }

  res.json({
    catalog: catalogCount,
    checkout: checkoutCount
  });
});

export default router;
