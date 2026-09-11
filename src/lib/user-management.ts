// Shared user management utilities — used by the /api/users route handlers.

export const USER_DOMAIN = "@ebilikagamatv.com";
export const MIN_PASSWORD_LENGTH = 6;

/** True if the session role belongs to an admin or the owner. */
export function isAdminRole(role: string | undefined | null): boolean {
  return role === "admin" || role === "owner";
}

/** Normalize a username: trim + lowercase (usernames are emails on our domain). */
export function normalizeUsername(u: string): string {
  return u.trim().toLowerCase();
}

/** Validate a username for the eBilikAgamaTV domain. Returns an error or null. */
export function validateUsername(raw: string): string | null {
  const username = normalizeUsername(raw);
  if (!username) return "Username is required";
  if (!username.endsWith(USER_DOMAIN)) {
    return `Username must end with ${USER_DOMAIN}`;
  }
  const localPart = username.slice(0, -USER_DOMAIN.length);
  if (!localPart || localPart.length > 64) {
    return "Username local part must be 1-64 characters";
  }
  if (!/^[a-z0-9._-]+$/.test(localPart)) {
    return "Username may only contain letters, numbers, dots, underscores and hyphens";
  }
  return null;
}

/** Validate a password. Returns an error or null. */
export function validatePassword(pw: string): string | null {
  if (!pw) return "Password is required";
  if (pw.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  return null;
}

/** Serialize a user row — NEVER includes passwordHash. */
export function serializeUser(u: {
  id: string;
  username: string;
  fullName: string | null;
  role: string;
  active: boolean;
  lastLogin: Date | null;
  createdAt: Date;
}) {
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    role: u.role,
    active: u.active,
    lastLogin: u.lastLogin ? u.lastLogin.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
  };
}
