import { useEffect } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function useLiveTracking(page: "catalog" | "checkout") {
  useEffect(() => {
    // Generate a simple session ID if one doesn't exist for tracking purposes
    let sessionId = sessionStorage.getItem("ka_tracking_session");
    if (!sessionId) {
      sessionId = Math.random().toString(36).substring(2, 15);
      sessionStorage.setItem("ka_tracking_session", sessionId);
    }

    const sendHeartbeat = () => {
      fetch(`${BASE}/api/tracking/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Use keepalive so it works even when unmounting/navigating away during the request
        keepalive: true,
        body: JSON.stringify({ sessionId, page }),
      }).catch(() => {
        // silent fail for analytics
      });
    };

    // Send immediately on mount
    sendHeartbeat();

    // Then every 5 seconds
    const interval = setInterval(sendHeartbeat, 5000);

    return () => clearInterval(interval);
  }, [page]);
}
