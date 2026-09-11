"use client";

import { useEffect, useState, useCallback, useMemo } from "react";

interface UserRow {
  id: string;
  username: string;
  fullName: string | null;
  role: string;
  active: boolean;
  lastLogin: string | null;
  createdAt: string;
}

interface Toast {
  type: "success" | "error";
  message: string;
}

interface StagedRow {
  fullName: string;
  username: string;
  password: string;
}

interface PreviewRow {
  fullName: string;
  username: string;
  valid: boolean;
  reason?: string;
}

const USER_DOMAIN = "@ebilikagamatv.com";
const MIN_PASSWORD_LENGTH = 6;

function validateUsernameLocal(raw: string): string | null {
  const username = raw.trim().toLowerCase();
  if (!username) return "Username is required";
  if (!username.endsWith(USER_DOMAIN)) {
    return `Username must end with ${USER_DOMAIN}`;
  }
  const localPart = username.slice(0, -USER_DOMAIN.length);
  if (!localPart || localPart.length > 64) return "Invalid username";
  if (!/^[a-z0-9._-]+$/.test(localPart)) {
    return "Only letters, numbers, dots, underscores and hyphens allowed";
  }
  return null;
}

function validatePasswordLocal(pw: string): string | null {
  if (!pw) return "Password is required";
  if (pw.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  return null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("ms-MY", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function UserManagementPage() {
  const [tab, setTab] = useState<"add" | "bulk" | "list">("list");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [isOwner, setIsOwner] = useState(false);

  // List controls
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sort, setSort] = useState("name_asc");

  // Add user form
  const [formName, setFormName] = useState("");
  const [formUsername, setFormUsername] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formConfirm, setFormConfirm] = useState("");
  const [formRole, setFormRole] = useState("user");
  const [formError, setFormError] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdUser, setCreatedUser] = useState<UserRow | null>(null);

  // Bulk
  const [bulkRows, setBulkRows] = useState<StagedRow[]>([]);
  const [csvError, setCsvError] = useState("");
  const [bulkPreview, setBulkPreview] = useState<PreviewRow[] | null>(null);
  const [bulkCreating, setBulkCreating] = useState(false);
  const [bulkResult, setBulkResult] = useState<{
    createdCount: number;
    skippedCount: number;
    failedCount: number;
    results: { fullName: string; username: string; status: string; reason?: string }[];
  } | null>(null);

  // Edit modal
  const [editModal, setEditModal] = useState<UserRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editRole, setEditRole] = useState("user");
  const [editError, setEditError] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Delete modal
  const [deleteModal, setDeleteModal] = useState<UserRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchUsers = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (roleFilter) params.set("role", roleFilter);
      if (statusFilter) params.set("status", statusFilter);
      params.set("sort", sort);
      const res = await fetch(`/api/users?${params.toString()}`);
      if (res.status === 403) {
        setAccessDenied(true);
        setLoading(false);
        return;
      }
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setUsers(data);
    } catch {
      showToast("error", "Gagal memuatkan senarai pengguna");
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, statusFilter, sort]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setIsOwner(d?.role === "owner"))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      fetchUsers();
    }, 250);
    return () => clearTimeout(timer);
  }, [fetchUsers]);

  // ── Add User ──
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setCreatedUser(null);

    if (!formName.trim()) {
      setFormError("Full name is required.");
      return;
    }
    const usernameErr = validateUsernameLocal(formUsername);
    if (usernameErr) {
      setFormError(usernameErr);
      return;
    }
    const pwErr = validatePasswordLocal(formPassword);
    if (pwErr) {
      setFormError(pwErr);
      return;
    }
    if (formPassword !== formConfirm) {
      setFormError("Passwords do not match.");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: formName.trim(),
          username: formUsername,
          password: formPassword,
          role: formRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || "Failed to create user.");
        return;
      }
      setCreatedUser(data.user);
      setFormName("");
      setFormUsername("");
      setFormPassword("");
      setFormConfirm("");
      setFormRole("user");
      showToast("success", "User created successfully");
      fetchUsers();
    } catch {
      setFormError("Network error. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  // ── Bulk: stage rows ──
  const addBulkRow = () => {
    setBulkRows((r) => [...r, { fullName: "", username: "", password: "" }]);
  };
  const updateBulkRow = (idx: number, field: keyof StagedRow, value: string) => {
    setBulkRows((rows) =>
      rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r))
    );
  };
  const removeBulkRow = (idx: number) => {
    setBulkRows((rows) => rows.filter((_, i) => i !== idx));
  };

  const handleCsvImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCsvError("");
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || "");
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        const parsed: StagedRow[] = [];
        for (const line of lines) {
          // Supports: fullName,username,password (quoted or plain)
          const match = line.match(/^\s*(?:"([^"]*)"|([^,]*))\s*,\s*(?:"([^"]*)"|([^,]*))\s*,\s*(?:"([^"]*)"|([^,]*))\s*$/);
          if (!match) continue;
          const fullName = (match[1] || match[2] || "").trim();
          const username = (match[3] || match[4] || "").trim();
          const password = (match[5] || match[6] || "").trim();
          if (!fullName && !username) continue;
          parsed.push({ fullName, username, password });
        }
        if (parsed.length === 0) {
          setCsvError("No valid rows found. Expected format: fullName,username,password");
        } else {
          setBulkRows(parsed);
        }
      } catch {
        setCsvError("Failed to read the CSV file.");
      }
      // Allow re-importing the same file later
      e.target.value = "";
    };
    reader.readAsText(file);
  };

  // ── Bulk: validate preview ──
  const buildBulkPreview = () => {
    const preview: PreviewRow[] = bulkRows.map((r) => {
      const fullName = r.fullName.trim();
      if (!fullName) return { ...r, valid: false, reason: "Full name is required" };
      const uErr = validateUsernameLocal(r.username);
      if (uErr) return { ...r, valid: false, reason: uErr };
      const pErr = validatePasswordLocal(r.password);
      if (pErr) return { ...r, valid: false, reason: pErr };
      return { ...r, valid: true };
    });
    setBulkPreview(preview);
  };

  const bulkValidCount = bulkPreview?.filter((r) => r.valid).length ?? 0;

  // ── Bulk: create valid users ──
  const handleBulkCreate = async () => {
    if (!bulkPreview) return;
    const validRows = bulkRows.filter((r, i) => bulkPreview[i]?.valid);
    if (validRows.length === 0) return;

    setBulkCreating(true);
    try {
      const res = await fetch("/api/users/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ users: validRows }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast("error", data.error || "Bulk creation failed.");
        return;
      }
      setBulkResult(data);
      setBulkRows([]);
      setBulkPreview(null);
      showToast(
        "success",
        `Created ${data.createdCount}, skipped ${data.skippedCount}, failed ${data.failedCount}`
      );
      fetchUsers();
    } catch {
      showToast("error", "Network error during bulk creation.");
    } finally {
      setBulkCreating(false);
    }
  };

  // ── Edit / toggle / delete ──
  const openEdit = (u: UserRow) => {
    setEditModal(u);
    setEditName(u.fullName || "");
    setEditUsername(u.username);
    setEditPassword("");
    setEditRole(u.role);
    setEditError("");
  };

  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModal) return;
    setEditError("");

    const uErr = validateUsernameLocal(editUsername);
    if (uErr) {
      setEditError(uErr);
      return;
    }
    if (editPassword) {
      const pErr = validatePasswordLocal(editPassword);
      if (pErr) {
        setEditError(pErr);
        return;
      }
    }

    setEditSaving(true);
    try {
      const body: Record<string, unknown> = {
        fullName: editName.trim(),
        username: editUsername,
      };
      if (editPassword) body.newPassword = editPassword;
      if (isOwner && editRole !== editModal.role) body.role = editRole;

      const res = await fetch(`/api/users/${editModal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditError(data.error || "Failed to update user.");
        return;
      }
      showToast("success", "User updated successfully");
      setEditModal(null);
      fetchUsers();
    } catch {
      setEditError("Network error.");
    } finally {
      setEditSaving(false);
    }
  };

  const handleToggleActive = async (u: UserRow) => {
    try {
      const res = await fetch(`/api/users/${u.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !u.active }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast("error", data.error || "Failed to change status.");
        return;
      }
      showToast("success", u.active ? "User disabled" : "User enabled");
      fetchUsers();
    } catch {
      showToast("error", "Network error.");
    }
  };

  const handleDelete = async () => {
    if (!deleteModal) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/users/${deleteModal.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        showToast("error", data.error || "Failed to delete user.");
        return;
      }
      showToast("success", "User deleted");
      setDeleteModal(null);
      fetchUsers();
    } catch {
      showToast("error", "Network error.");
    } finally {
      setDeleting(false);
    }
  };

  const validUserCount = useMemo(
    () => users.filter((u) => u.role === "user").length,
    [users]
  );

  // ── Access denied ──
  if (accessDenied) {
    return (
      <div className="text-center py-20">
        <div className="w-16 h-16 bg-red-600/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h2 className="text-white text-xl font-bold mb-2">Akses Ditolak</h2>
        <p className="text-gray-400">Anda tidak mempunyai akses ke bahagian ini.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[60] max-w-sm w-full px-4 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 transition-all ${
          toast.type === "success"
            ? "bg-green-600/90 text-white border border-green-500/50"
            : "bg-red-600/90 text-white border border-red-500/50"
        }`}>
          {toast.type === "success" ? (
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          )}
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-white text-2xl font-bold">Pengurusan Pengguna</h1>
          <p className="text-gray-400 mt-1">
            Urus akaun pengguna eBilikAgamaTV ({validUserCount} user account{validUserCount !== 1 ? "s" : ""})
          </p>
        </div>
        {/* Tabs */}
        <div className="flex gap-1 bg-gray-900 border border-white/10 rounded-xl p-1">
          {([
            ["list", "Users"],
            ["add", "Add User"],
            ["bulk", "Bulk Add Users"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === key
                  ? "bg-red-600 text-white"
                  : "text-gray-400 hover:text-white hover:bg-white/5"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ═══════════ ADD USER ═══════════ */}
      {tab === "add" && (
        <div className="admin-card max-w-2xl">
          <h2 className="text-white font-semibold text-lg mb-4">Tambah Pengguna Baru</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            {formError && (
              <div className="bg-red-600/10 border border-red-600/30 text-red-400 px-4 py-3 rounded-xl text-sm">
                {formError}
              </div>
            )}

            {createdUser && (
              <div className="bg-green-600/10 border border-green-600/30 text-green-300 px-4 py-3 rounded-xl text-sm">
                <p className="font-medium mb-1">✓ User created successfully</p>
                <p>Name: {createdUser.fullName}</p>
                <p>Username: {createdUser.username}</p>
                <p>Role: {createdUser.role === "user" ? "User" : createdUser.role === "admin" ? "Admin" : "Owner"}</p>
                <p>Status: Active</p>
              </div>
            )}

            <div>
              <label className="block text-gray-300 text-sm font-medium mb-2">Full Name *</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="admin-input"
                placeholder="Contoh: Muhammad Ahmad"
                required
              />
            </div>

            <div>
              <label className="block text-gray-300 text-sm font-medium mb-2">Username / Email *</label>
              <div className="relative">
                <input
                  type="text"
                  value={formUsername}
                  onChange={(e) => setFormUsername(e.target.value)}
                  className="admin-input pr-44"
                  placeholder="muhammad"
                  required
                />
                <span className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 text-sm pointer-events-none">
                  {USER_DOMAIN}
                </span>
              </div>
              <p className="text-gray-500 text-xs mt-1.5">
                Username must end with {USER_DOMAIN}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-gray-300 text-sm font-medium mb-2">Password *</label>
                <input
                  type="password"
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  className="admin-input"
                  placeholder={`Min ${MIN_PASSWORD_LENGTH} aksara`}
                  required
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className="block text-gray-300 text-sm font-medium mb-2">Confirm Password *</label>
                <input
                  type="password"
                  value={formConfirm}
                  onChange={(e) => setFormConfirm(e.target.value)}
                  className="admin-input"
                  placeholder="Ulang kata laluan"
                  required
                  autoComplete="new-password"
                />
              </div>
            </div>

            <div>
              <label className="block text-gray-300 text-sm font-medium mb-2">Role</label>
              <select
                value={formRole}
                onChange={(e) => setFormRole(e.target.value)}
                className="admin-input"
              >
                <option value="user">User</option>
                {isOwner && <option value="admin">Admin</option>}
              </select>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={creating}
                className="admin-btn admin-btn-primary flex items-center gap-2 disabled:opacity-50"
              >
                {creating ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Mencipta...
                  </>
                ) : (
                  "Create User"
                )}
              </button>
              <button
                type="button"
                onClick={() => { setFormError(""); setCreatedUser(null); }}
                className="admin-btn admin-btn-secondary"
              >
                Clear
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ═══════════ BULK ADD USERS ═══════════ */}
      {tab === "bulk" && (
        <div className="admin-card max-w-4xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-white font-semibold text-lg">Tambah Pengguna Secara Pukal</h2>
              <p className="text-gray-400 text-sm mt-1">
                Masukkan barisan atau import fail CSV (format: fullName,username,password)
              </p>
            </div>
            <label className="admin-btn admin-btn-secondary cursor-pointer flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Import CSV
              <input type="file" accept=".csv,text/csv" onChange={handleCsvImport} className="hidden" />
            </label>
          </div>

          {csvError && (
            <div className="bg-red-600/10 border border-red-600/30 text-red-400 px-4 py-3 rounded-xl text-sm mb-4">
              {csvError}
            </div>
          )}

          {/* Staged rows table */}
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-gray-400 text-xs uppercase">
                  <th className="py-2 px-2">Full Name</th>
                  <th className="py-2 px-2">Username</th>
                  <th className="py-2 px-2">Password</th>
                  <th className="py-2 px-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {bulkRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-gray-500 text-sm">
                      Tiada barisan. Klik &quot;Add Row&quot; atau import CSV untuk bermula.
                    </td>
                  </tr>
                )}
                {bulkRows.map((row, idx) => (
                  <tr key={idx} className="border-b border-white/5">
                    <td className="py-1.5 px-2">
                      <input
                        type="text"
                        value={row.fullName}
                        onChange={(e) => updateBulkRow(idx, "fullName", e.target.value)}
                        className="admin-input"
                        placeholder="Muhammad Ahmad"
                      />
                    </td>
                    <td className="py-1.5 px-2">
                      <div className="relative">
                        <input
                          type="text"
                          value={row.username.replace(USER_DOMAIN, "")}
                          onChange={(e) =>
                            updateBulkRow(idx, "username", e.target.value + USER_DOMAIN)
                          }
                          className="admin-input pr-40"
                          placeholder="muhammad"
                        />
                        <span className="absolute inset-y-0 right-0 pr-2 flex items-center text-gray-500 text-xs pointer-events-none">
                          {USER_DOMAIN}
                        </span>
                      </div>
                    </td>
                    <td className="py-1.5 px-2">
                      <input
                        type="password"
                        value={row.password}
                        onChange={(e) => updateBulkRow(idx, "password", e.target.value)}
                        className="admin-input"
                        placeholder="••••••••"
                        autoComplete="off"
                      />
                    </td>
                    <td className="py-1.5 px-2 text-right">
                      <button
                        onClick={() => removeBulkRow(idx)}
                        className="text-red-400 hover:text-red-300 p-1"
                        aria-label="Remove row"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            <button onClick={addBulkRow} className="admin-btn admin-btn-secondary text-sm">
              + Add Row
            </button>
            <button
              onClick={buildBulkPreview}
              disabled={bulkRows.length === 0}
              className="admin-btn admin-btn-primary text-sm disabled:opacity-50"
            >
              Validate & Preview
            </button>
          </div>

          {/* Preview */}
          {bulkPreview && (
            <div className="border border-white/10 rounded-xl overflow-hidden">
              <div className="bg-gray-800 px-4 py-3 flex items-center justify-between">
                <h3 className="text-white text-sm font-medium">Bulk User Review</h3>
                <p className="text-xs text-gray-400">
                  {bulkValidCount} valid · {bulkPreview.length - bulkValidCount} invalid
                </p>
              </div>
              <div className="max-h-72 overflow-y-auto divide-y divide-white/5">
                {bulkPreview.map((r, idx) => (
                  <div key={idx} className="px-4 py-2.5 flex items-start gap-3">
                    <span className={r.valid ? "text-green-400" : "text-red-400"}>
                      {r.valid ? "✓" : "✕"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-white text-sm truncate">{r.fullName || "—"}</p>
                      <p className="text-gray-400 text-xs truncate">{r.username || "—"}</p>
                      {!r.valid && r.reason && (
                        <p className="text-red-400 text-xs mt-0.5">{r.reason}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="bg-gray-800 px-4 py-3 flex justify-end gap-2">
                <button
                  onClick={() => setBulkPreview(null)}
                  className="admin-btn admin-btn-secondary text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBulkCreate}
                  disabled={bulkCreating || bulkValidCount === 0}
                  className="admin-btn admin-btn-primary text-sm disabled:opacity-50 flex items-center gap-2"
                >
                  {bulkCreating ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Creating...
                    </>
                  ) : (
                    `Create Valid Users (${bulkValidCount})`
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Bulk result summary */}
          {bulkResult && (
            <div className="mt-4 border border-white/10 rounded-xl overflow-hidden">
              <div className="bg-gray-800 px-4 py-3">
                <h3 className="text-white text-sm font-medium">Bulk User Creation Complete</h3>
                <p className="text-gray-400 text-xs mt-1">
                  Created: {bulkResult.createdCount} · Skipped: {bulkResult.skippedCount} · Failed: {bulkResult.failedCount}
                </p>
              </div>
              <div className="max-h-60 overflow-y-auto divide-y divide-white/5">
                {bulkResult.results
                  .filter((r) => r.status !== "created")
                  .map((r, idx) => (
                    <div key={idx} className="px-4 py-2 text-sm">
                      <p className={r.status === "skipped" ? "text-yellow-400" : "text-red-400"}>
                        {r.status === "skipped" ? "Skipped:" : "Failed:"} {r.username}
                      </p>
                      <p className="text-gray-500 text-xs">{r.reason}</p>
                    </div>
                  ))}
                {bulkResult.skippedCount === 0 && bulkResult.failedCount === 0 && (
                  <div className="px-4 py-3 text-green-400 text-sm">
                    ✓ All users created successfully.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════ USER LIST ═══════════ */}
      {tab === "list" && (
        <div className="admin-card">
          {/* Search + filters */}
          <div className="flex flex-wrap gap-3 mb-4">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="admin-input flex-1 min-w-[200px]"
              placeholder="Cari nama atau username..."
            />
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="admin-input w-auto">
              <option value="">Semua Peranan</option>
              <option value="user">User</option>
              <option value="admin">Admin</option>
              <option value="owner">Owner</option>
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="admin-input w-auto">
              <option value="">Semua Status</option>
              <option value="active">Aktif</option>
              <option value="disabled">Dilumpuhkan</option>
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="admin-input w-auto">
              <option value="name_asc">Nama A → Z</option>
              <option value="name_desc">Nama Z → A</option>
              <option value="newest">Terbaharu</option>
              <option value="oldest">Tertua</option>
            </select>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-gray-400">Tiada pengguna dijumpai.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-gray-400 text-xs uppercase">
                    <th className="py-3 px-4">Name</th>
                    <th className="py-3 px-4">Username</th>
                    <th className="py-3 px-4">Role</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Created</th>
                    <th className="py-3 px-4">Last Login</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-gradient-to-br from-gray-600 to-gray-700 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                            {(u.fullName || u.username).charAt(0).toUpperCase()}
                          </div>
                          <span className="text-white font-medium">{u.fullName || "—"}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-gray-300">{u.username}</td>
                      <td className="py-3 px-4">
                        <span className={`text-xs font-medium px-2 py-1 rounded ${
                          u.role === "owner"
                            ? "bg-red-600/20 text-red-400"
                            : u.role === "admin"
                            ? "bg-blue-600/20 text-blue-400"
                            : "bg-gray-600/20 text-gray-300"
                        }`}>
                          {u.role === "owner" ? "OWNER" : u.role === "admin" ? "ADMIN" : "USER"}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`text-xs font-medium px-2 py-1 rounded ${
                          u.active
                            ? "bg-green-600/20 text-green-400"
                            : "bg-gray-600/20 text-gray-400"
                        }`}>
                          {u.active ? "Active" : "Disabled"}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-gray-500 text-xs">{formatDate(u.createdAt)}</td>
                      <td className="py-3 px-4 text-gray-500 text-xs">{formatDate(u.lastLogin)}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openEdit(u)}
                            className="px-2 py-1 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 rounded text-xs font-medium transition-colors"
                          >
                            Edit
                          </button>
                          {u.role !== "owner" && (
                            <button
                              onClick={() => handleToggleActive(u)}
                              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                                u.active
                                  ? "bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/30"
                                  : "bg-green-600/20 text-green-400 hover:bg-green-600/30"
                              }`}
                            >
                              {u.active ? "Disable" : "Enable"}
                            </button>
                          )}
                          {u.role !== "owner" && (
                            <button
                              onClick={() => setDeleteModal(u)}
                              className="px-2 py-1 bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded text-xs font-medium transition-colors"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Edit Modal */}
      {editModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-white font-semibold text-lg mb-4">Sunting Pengguna</h3>
            <form onSubmit={handleEditSave} className="space-y-4">
              {editError && (
                <div className="bg-red-600/10 border border-red-600/30 text-red-400 px-4 py-3 rounded-xl text-sm">
                  {editError}
                </div>
              )}
              <div>
                <label className="block text-gray-300 text-sm font-medium mb-2">Full Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="admin-input"
                  required
                />
              </div>
              <div>
                <label className="block text-gray-300 text-sm font-medium mb-2">Username</label>
                <div className="relative">
                  <input
                    type="text"
                    value={editUsername.replace(USER_DOMAIN, "")}
                    onChange={(e) => setEditUsername(e.target.value + USER_DOMAIN)}
                    className="admin-input pr-44"
                    required
                  />
                  <span className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 text-sm pointer-events-none">
                    {USER_DOMAIN}
                  </span>
                </div>
              </div>
              <div>
                <label className="block text-gray-300 text-sm font-medium mb-2">
                  New Password (kosongkan jika tidak mahu tukar)
                </label>
                <input
                  type="password"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  className="admin-input"
                  placeholder={`Min ${MIN_PASSWORD_LENGTH} aksara`}
                  autoComplete="new-password"
                />
              </div>
              {isOwner && editModal.role !== "owner" && (
                <div>
                  <label className="block text-gray-300 text-sm font-medium mb-2">Role</label>
                  <select
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value)}
                    className="admin-input"
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              )}
              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setEditModal(null)}
                  className="admin-btn admin-btn-secondary"
                  disabled={editSaving}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={editSaving}
                  className="admin-btn admin-btn-primary flex items-center gap-2"
                >
                  {editSaving ? (
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : null}
                  Simpan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {deleteModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 max-w-md w-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-600/20 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h3 className="text-white font-semibold text-lg">Padam Pengguna</h3>
            </div>
            <p className="text-gray-400 mb-2">
              Adakah anda pasti mahu memadamkan pengguna ini?
            </p>
            <p className="text-gray-500 text-sm mb-6">
              &quot;{deleteModal.fullName || deleteModal.username}&quot; ({deleteModal.username}) — Tindakan ini tidak boleh dibatalkan.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteModal(null)}
                className="admin-btn admin-btn-secondary"
                disabled={deleting}
              >
                Batal
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="admin-btn admin-btn-danger flex items-center gap-2"
              >
                {deleting ? (
                  <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : null}
                Padam
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
