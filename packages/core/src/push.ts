import webpush from "web-push";

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushResult =
  | { ok: true; statusCode: number }
  | { ok: false; statusCode?: number; gone: boolean; error: string };

export interface PushSender {
  readonly configured: boolean;
  readonly publicKey: string | null;
  send(target: PushTarget, payload: object): Promise<PushResult>;
}

/**
 * Web Push via VAPID. A 201 from the push service means it ACCEPTED the message for
 * delivery — not that the device displayed it. We record exactly that ("accepted").
 */
export function createPushSender(vapid: { publicKey: string; privateKey: string; subject: string } | null): PushSender {
  if (!vapid) {
    return {
      configured: false,
      publicKey: null,
      async send() {
        return { ok: false, gone: false, error: "Web push is not configured (VAPID keys missing)" };
      },
    };
  }
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  return {
    configured: true,
    publicKey: vapid.publicKey,
    async send(target, payload) {
      try {
        const res = await webpush.sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          JSON.stringify(payload),
          { TTL: 3600, urgency: "normal" },
        );
        return { ok: true, statusCode: res.statusCode };
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        return {
          ok: false,
          statusCode,
          gone: statusCode === 404 || statusCode === 410,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
