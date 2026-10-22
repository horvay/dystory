// Chrome notifications (Web Push) to every browser that turned them on.
import webpush from "web-push";
import type { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";

export type Notice = { title: string; body: string; url: string; tag: string };

const PUBLIC_KEY = process.env.VITE_VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const enabled = !!(PUBLIC_KEY && PRIVATE_KEY);
if (enabled) webpush.setVapidDetails(process.env.VAPID_SUBJECT || "https://dystory.invalid", PUBLIC_KEY!, PRIVATE_KEY!);
else console.warn("[notify] VITE_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set; notifications are off");

export async function notifyAll(convex: ConvexClient, notice: Notice) {
  if (!enabled) return;
  const subs = await convex.query(api.push.all, {});
  const payload = JSON.stringify(notice);
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, payload, { TTL: 24 * 3600, urgency: "high", topic: notice.tag.slice(0, 32) });
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // The browser unsubscribed or its subscription expired.
        if (status === 404 || status === 410) await convex.mutation(api.push.unsubscribe, { endpoint: sub.endpoint });
        else console.warn(`[notify] push failed (${status ?? "no status"}): ${(err as Error).message}`);
      }
    }),
  );
}
