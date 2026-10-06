// Role & permission model (spec §21).
//
// Existing roles (user/admin/owner) are preserved exactly — nothing breaks.
// The spec's EDITOR and VIEWER roles are added as recognized aliases with
// conservative mappings:
//   owner  → full access (existing)
//   admin  → operational management (existing)
//   editor → content/schedule management only (NEW)
//   viewer → read-only admin dashboard (NEW)
//   user   → normal website only (existing)
//
// Admin API gating keeps using the strict isAdminRole() (admin|owner) so
// existing endpoints are untouched; NEW endpoints that expose read-only
// dashboards may accept viewer via requireAdminView, and content-mutation
// endpoints may accept editor via the dedicated helpers when appropriate.
// Normal users can never pass any of these.

export const ALL_ROLES = ["owner", "admin", "editor", "viewer", "user"] as const;
export type Role = (typeof ALL_ROLES)[number];

export function normalizeRole(role: string | undefined | null): Role | null {
  if (!role) return null;
  const r = role.toLowerCase().trim();
  return (ALL_ROLES as readonly string[]).includes(r) ? (r as Role) : null;
}

/** Existing strict gate — admin or owner (unchanged semantics). */
export function isAdminRole(role: string | undefined | null): boolean {
  return role === "admin" || role === "owner";
}

/** Read-only admin dashboard access: owner/admin/editor/viewer. */
export function canViewAdmin(role: string | undefined | null): boolean {
  return isAdminRole(role) || role === "editor" || role === "viewer";
}

/** Content/schedule mutation: owner/admin/editor (not viewer). */
export function canEditContent(role: string | undefined | null): boolean {
  return isAdminRole(role) || role === "editor";
}

/** Operational/system mutation: owner/admin only. */
export function canOperate(role: string | undefined | null): boolean {
  return isAdminRole(role);
}

/** Owner-only: audit retention, roles of admins, destructive ops. */
export function isOwner(role: string | undefined | null): boolean {
  return role === "owner";
}
