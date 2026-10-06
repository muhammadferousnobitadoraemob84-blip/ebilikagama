/**
 * WhatsApp URL validation for the Social Media settings.
 * Shared by the admin settings UI and PUT /api/settings so client and server
 * apply the exact same rule.
 *
 * Accepts the normal public URL formats used for WhatsApp Groups and Channels
 * — no actual URLs are hard-coded:
 *   Groups:   https://chat.whatsapp.com/<invite-id>   (invite links)
 *   Channels: https://whatsapp.com/channel/<id>
 *   Also accepted: https://wa.me/<number>, https://api.whatsapp.com/...,
 *                  https://whatsapp.com/invite/<id>
 * Only HTTPS is accepted. An empty value is allowed (link simply not shown).
 */

const WHATSAPP_HOSTS = new Set([
  "chat.whatsapp.com",
  "whatsapp.com",
  "wa.me",
  "api.whatsapp.com",
]);

export function isValidWhatsAppUrl(raw: string): boolean {
  const value = (raw ?? "").trim();
  if (!value) return true; // empty = not configured, allowed
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (!WHATSAPP_HOSTS.has(url.hostname.toLowerCase())) return false;
  const path = url.pathname.replace(/\/+$/, "");
  return path.length > 0;
}
