"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useLanguage } from "@/components/LanguageProvider";

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

const USER_DOMAIN = "@ebilikagamatv.com";
const MIN_PASSWORD_LENGTH = 6;

const UM_ERROR_KEYS: Record<string, string> = {
  "Full name is required": "um_err_fullname_required",
  "Username is required": "um_err_username_required",
  ["Username must end with " + USER_DOMAIN]: "um_err_domain",
  "Invalid username": "um_err_localpart",
  "Only letters, numbers, dots, underscores and hyphens allowed": "um_err_localpart",
  "Password is required": "um_err_password_required",
  ["Password must be at least " + MIN_PASSWORD_LENGTH + " characters"]: "um_err_password_min",
};

function validateUsernameLocal(raw: string): string | null {
  const username = raw.trim().toLowerCase();
  if (!username) return "Username is required";
  if (!username.endsWith(USER_DOMAIN)) {
    return "Username must end with " + USER_DOMAIN;
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
    return "Password must be at least " + MIN_PASSWORD_LENGTH + " characters";
  }
  return null;
}

/** Translate an API/local validation message via the key map, falling back to the raw text. */
function translateError(um: (k: never) => string, msg: string | undefined): string {
  if (!msg) return "";
  const key = UM_ERROR_KEYS[msg];
  if (key) {
    const translate = um as unknown as (k: string) => string;
    let out = translate(key as never);
    out = out.replace("{n}", String(MIN_PASSWORD_LENGTH));
    return out;
  }
  return msg;
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
  const { t } = useLanguage();
  const um = t as unknown as (key: string) => string;
  const fmt = (key: string, n: number) => um(key).replace("{n}", String(n));

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

  // Bulk (direct import mode)
  const [bulkRows, setBulkRows] = useState<StagedRow[]>([]);
  const [csvError, setCsvError] = useState("");
  const [bulkCreating, setBulkCreating] = useState(false);
  const [bulkResult, setBulkResult] = useState<{
    createdCount: number;
    skippedCount: number;
    failedCount: number;
    results: { fullName: string; username: string; status: string; reason?: string }[];
  } | null>(null);
  const [showAllResults, setShowAllResults] = useState(false);

  // XLSX/DOCX import: rows detected from the uploaded file (direct mode)
  const [importing, setImporting] = useState(false);
  const [fileStaged, setFileStaged] = useState(false);

  // Filter panel
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterRole, setFilterRole] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSort, setFilterSort] = useState("name_asc");
  const filterRef = useRef<HTMLDivElement>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);

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

  // ── Filter panel behavior ──
  const activeFilterCount =
    (roleFilter ? 1 : 0) + (statusFilter ? 1 : 0) + (sort !== "name_asc" ? 1 : 0);

  // Draft state inside the panel: initialize from applied filters when opened
  const openFilter = () => {
    setFilterRole(roleFilter);
    setFilterStatus(statusFilter);
    setFilterSort(sort);
    setFilterOpen(true);
  };

  const applyFilters = () => {
    setRoleFilter(filterRole);
    setStatusFilter(filterStatus);
    setSort(filterSort);
    setFilterOpen(false);
  };

  const resetFilters = () => {
    setFilterRole("");
    setFilterStatus("");
    setFilterSort("name_asc");
    // Apply reset immediately so the list updates
    setRoleFilter("");
    setStatusFilter("");
    setSort("name_asc");
  };

  // Close on outside click / Escape
  useEffect(() => {
    if (!filterOpen) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (
        filterRef.current && !filterRef.current.contains(e.target as Node) &&
        filterButtonRef.current && !filterButtonRef.current.contains(e.target as Node)
      ) {
        setFilterOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFilterOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [filterOpen]);

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
      showToast("error", um("um_err_load_list"));
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
      setFormError(um("um_err_fullname_required"));
      return;
    }
    const usernameErr = validateUsernameLocal(formUsername);
    if (usernameErr) {
      setFormError(translateError(um, usernameErr));
      return;
    }
    const pwErr = validatePasswordLocal(formPassword);
    if (pwErr) {
      setFormError(translateError(um, pwErr));
      return;
    }
    if (formPassword !== formConfirm) {
      setFormError(um("um_err_password_mismatch"));
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
        setFormError(translateError(um, data.error) || um("um_err_create"));
        return;
      }
      setCreatedUser(data.user);
      setFormName("");
      setFormUsername("");
      setFormPassword("");
      setFormConfirm("");
      setFormRole("user");
      showToast("success", um("um_toast_created"));
      fetchUsers();
    } catch {
      setFormError(um("um_err_network"));
    } finally {
      setCreating(false);
    }
  };

  // ── Direct import: stage rows detected from a file (XLSX / DOCX / CSV) ──
  // The server parses the file, finds the FULL NAME / USERNAME / PASSWORD
  // columns and returns the rows. Nothing is created until the admin clicks
  // the Import button (one confirmation step, no mapping, no manual rows).
  const stageImportRows = (rows: StagedRow[]) => {
    setBulkRows(rows);
    setFileStaged(rows.length > 0);
    setBulkResult(null);
    setShowAllResults(false);
  };

  const resetImportState = () => {
    setBulkRows([]);
    setFileStaged(false);
    setBulkResult(null);
    setCsvError("");
    setShowAllResults(false);
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setCsvError("");
    setBulkResult(null);
    const file = e.target.files?.[0];
    if (!file) return;

    console.log(
      `[UserImport] file="${file.name}" size=${file.size} type=${file.type || "unknown"}`
    );

    // Detect rows client-side for CSV (fast path), server-side for XLSX/DOCX
    const isCsv = file.name.toLowerCase().endsWith(".csv");

    const readAsText = () =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsText(file);
      });

    const parseCsv = (text: string): StagedRow[] => {
      // Strip UTF-8 BOM
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      const parseCsvRows = (raw: string, delim: string): string[][] => {
        const out: string[][] = [];
        let row: string[] = [];
        let field = "";
        let inQuotes = false;
        for (let i = 0; i < raw.length; i++) {
          const ch = raw[i];
          if (inQuotes) {
            if (ch === '"') {
              if (raw[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
            } else field += ch;
          } else if (ch === '"') {
            inQuotes = true;
          } else if (ch === delim) {
            row.push(field); field = "";
          } else if (ch === "\n" || ch === "\r") {
            if (ch === "\r" && raw[i + 1] === "\n") i++;
            row.push(field); field = "";
            out.push(row); row = [];
          } else field += ch;
        }
        if (field.length > 0 || row.length > 0) { row.push(field); out.push(row); }
        return out;
      };
      const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || "";
      const counts: Record<string, number> = {
        ",": (firstLine.match(/,/g) || []).length,
        ";": (firstLine.match(/;/g) || []).length,
        "\t": (firstLine.match(/\t/g) || []).length,
      };
      const delim =
        Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
          ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
          : ",";
      const allRows = parseCsvRows(text, delim).filter((r) => r.some((c) => c.trim()));
      const nameRe = /^(full[\s._-]*)?name$/i;
      const userRe = /^(user(name)?|email)(\s*\/?\s*(email))?$/i;
      const passRe = /^(pass(word)?|pwd|kata[\s._-]*laluan)$/i;
      let headerIdx = -1;
      let map = { fullName: 0, username: 1, password: 2 };
      for (let i = 0; i < Math.min(allRows.length, 8); i++) {
        const m = { fullName: -1, username: -1, password: -1 };
        for (let c = 0; c < allRows[i].length; c++) {
          const v = allRows[i][c].trim().toLowerCase().replace(/[*:]+$/, "").trim();
          if (m.fullName === -1 && nameRe.test(v)) m.fullName = c;
          else if (m.username === -1 && userRe.test(v)) m.username = c;
          else if (m.password === -1 && passRe.test(v)) m.password = c;
        }
        const hits = Object.values(m).filter((x) => x !== -1).length;
        if (hits >= 2) {
          headerIdx = i;
          map = {
            fullName: m.fullName !== -1 ? m.fullName : 0,
            username: m.username !== -1 ? m.username : 1,
            password: m.password !== -1 ? m.password : 2,
          };
          if (hits === 3) break;
        }
      }
      const dataRows = headerIdx >= 0 ? allRows.slice(headerIdx + 1) : allRows;
      return dataRows
        .filter((r) => r.some((c) => c.trim()))
        .map((r) => ({
          fullName: (r[map.fullName] || "").trim(),
          username: (r[map.username] || "").trim(),
          password: r[map.password] || "",
        }))
        .filter((r) => r.fullName || r.username);
    };

    setImporting(true);
    try {
      let rows: StagedRow[];
      if (isCsv) {
        rows = parseCsv(await readAsText());
        console.log(`[UserImport] CSV "${file.name}": ${rows.length} rows detected`);
      } else {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/users/import/parse", {
          method: "POST",
          body: fd,
        });
        const data = await res.json();
        if (!res.ok) {
          setCsvError(translateError(um, data.error) || um("um_import_err_upload"));
          return;
        }
        console.log(
          `[UserImport] parsed "${file.name}": sheets=${JSON.stringify(data.debug?.sheets ?? [])} selected="${data.debug?.selected ?? "?"}" rows=${data.rowCount}`
        );
        if (!data.rows || data.rows.length === 0) {
          setCsvError(um("um_import_err_notable"));
          return;
        }
        rows = data.rows.map(
          (r: { fullName?: string; username?: string; password?: string; raw?: string[] }) => ({
            fullName: (r.fullName ?? "").trim(),
            username: (r.username ?? "").trim(),
            password: r.password ?? "",
          })
        );
      }
      // Guard against the "N rows detected but all values empty" failure
      // mode: a row is only usable when its values were actually extracted.
      const meaningful = rows.filter((r) => r.fullName && r.username);
      const withPassword = meaningful.filter((r) => r.password.length > 0).length;
      console.log(
        `[UserImport] "${file.name}": rows=${rows.length} meaningful=${meaningful.length} withPassword=${withPassword}`
      );
      if (rows.length === 0 || meaningful.length === 0) {
        setCsvError(um("um_import_err_nodata"));
        return;
      }
      stageImportRows(rows);
    } catch {
      setCsvError(um("um_import_err_upload"));
    } finally {
      setImporting(false);
      e.target.value = ""; // allow re-importing the same file later
    }
  };

  // ── Direct import: create the staged users now ──
  const handleBulkCreate = async () => {
    const validRows = bulkRows;
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
        showToast("error", translateError(um, data.error) || um("um_err_create"));
        return;
      }
      setBulkResult(data);
      setShowAllResults(false);
      showToast(
        "success",
        `${um("um_bulk_created")} ${data.createdCount} · ${um("um_bulk_skipped")} ${data.skippedCount} · ${um("um_bulk_failed")} ${data.failedCount}`
      );
      fetchUsers();
    } catch {
      showToast("error", um("um_err_network"));
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
        setEditError(translateError(um, data.error) || um("um_err_update"));
        return;
      }
      showToast("success", um("um_toast_updated"));
      setEditModal(null);
      fetchUsers();
    } catch {
      setEditError(um("um_err_network"));
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
        showToast("error", translateError(um, data.error) || um("um_err_status"));
        return;
      }
      showToast("success", u.active ? um("um_toast_disabled") : um("um_toast_enabled"));
      fetchUsers();
    } catch {
      showToast("error", um("um_err_network"));
    }
  };

  const handleDelete = async () => {
    if (!deleteModal) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/users/${deleteModal.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        showToast("error", translateError(um, data.error) || um("um_err_delete"));
        return;
      }
      showToast("success", um("um_toast_deleted"));
      setDeleteModal(null);
      fetchUsers();
    } catch {
      showToast("error", um("um_err_network"));
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
        <h2 className="text-white text-xl font-bold mb-2">{um("um_access_denied_title")}</h2>
        <p className="text-gray-400">{um("um_access_denied_desc")}</p>
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
          <h1 className="text-white text-2xl font-bold">{um("um_title")}</h1>
          <p className="text-gray-400 mt-1">
            {um("um_subtitle")} ({validUserCount} {um("um_user_count")})
          </p>
        </div>
        {/* Tabs */}
        <div className="flex gap-1 bg-gray-900 border border-white/10 rounded-xl p-1">
          {([
            ["list", um("um_tab_list")],
            ["add", um("um_tab_add")],
            ["bulk", um("um_tab_bulk")],
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
          <h2 className="text-white font-semibold text-lg mb-4">{um("um_add_title")}</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            {formError && (
              <div className="bg-red-600/10 border border-red-600/30 text-red-400 px-4 py-3 rounded-xl text-sm">
                {formError}
              </div>
            )}

            {createdUser && (
              <div className="bg-green-600/10 border border-green-600/30 text-green-300 px-4 py-3 rounded-xl text-sm">
                <p className="font-medium mb-1">{um("um_created_success")}</p>
                <p>{um("um_created_name")} {createdUser.fullName}</p>
                <p>{um("um_created_username")} {createdUser.username}</p>
                <p>{um("um_role_label")}: {createdUser.role === "user" ? um("um_role_user") : createdUser.role === "admin" ? um("um_role_admin") : um("um_role_owner")}</p>
                <p>{um("um_status_label")}: {um("um_status_active")}</p>
              </div>
            )}

            <div>
              <label className="block text-gray-300 text-sm font-medium mb-2">{um("um_label_full_name")} *</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="admin-input"
                placeholder={um("um_placeholder_full_name")}
                required
              />
            </div>

            <div>
              <label className="block text-gray-300 text-sm font-medium mb-2">{um("um_label_username")} *</label>
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
                {um("um_domain_hint_prefix")} {USER_DOMAIN}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-gray-300 text-sm font-medium mb-2">{um("um_label_password")} *</label>
                <input
                  type="password"
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  className="admin-input"
                  placeholder={fmt("um_password_min", MIN_PASSWORD_LENGTH)}
                  required
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className="block text-gray-300 text-sm font-medium mb-2">{um("um_label_confirm_password")} *</label>
                <input
                  type="password"
                  value={formConfirm}
                  onChange={(e) => setFormConfirm(e.target.value)}
                  className="admin-input"
                  placeholder={um("um_label_confirm_password")}
                  required
                  autoComplete="new-password"
                />
              </div>
            </div>

            <div>
              <label className="block text-gray-300 text-sm font-medium mb-2">{um("um_role_label")}</label>
              <select
                value={formRole}
                onChange={(e) => setFormRole(e.target.value)}
                className="admin-input"
              >
                <option value="user">{um("um_role_user")}</option>
                {isOwner && <option value="admin">{um("um_role_admin")}</option>}
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
                    {um("um_btn_creating")}
                  </>
                ) : (
                  um("um_btn_create")
                )}
              </button>
              <button
                type="button"
                onClick={() => { setFormError(""); setCreatedUser(null); }}
                className="admin-btn admin-btn-secondary"
              >
                {um("um_btn_clear")}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ═══════════ BULK ADD USERS (direct import mode) ═══════════ */}
      {tab === "bulk" && (
        <div className="admin-card max-w-4xl">
          <div className="mb-4">
            <h2 className="text-white font-semibold text-lg">{um("um_bulk_title")}</h2>
            <p className="text-gray-400 text-sm mt-1">{um("um_bulk_desc")}</p>
            <p className="text-gray-500 text-xs mt-1">{um("um_import_supported")}</p>
          </div>

          {/* Step 1: pick a file */}
          {!fileStaged && (
            <div className="border border-dashed border-white/20 rounded-xl p-8 text-center">
              <svg className="w-10 h-10 text-gray-500 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <p className="text-gray-400 text-sm mb-4">{um("um_import_select")}</p>
              <label className="admin-btn admin-btn-primary cursor-pointer inline-flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                {importing ? um("um_importing") : um("um_btn_import")}
                <input
                  type="file"
                  accept=".csv,.xlsx,.docx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={handleFileImport}
                  className="hidden"
                  disabled={importing}
                />
              </label>
            </div>
          )}

          {csvError && (
            <div className="bg-red-600/10 border border-red-600/30 text-red-400 px-4 py-3 rounded-xl text-sm mt-4">
              {csvError}
            </div>
          )}

          {/* Step 2: rows detected → confirm import */}
          {fileStaged && (
            <div>
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-blue-600/10 border border-blue-600/30 rounded-xl px-4 py-3 mb-4">
                <p className="text-white font-semibold text-sm tracking-wide">
                  {fmt("um_import_detected", bulkRows.length)}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={resetImportState}
                    disabled={bulkCreating}
                    className="admin-btn admin-btn-secondary text-sm"
                  >
                    {um("um_btn_cancel")}
                  </button>
                  <button
                    onClick={handleBulkCreate}
                    disabled={bulkCreating || bulkRows.length === 0}
                    className="admin-btn admin-btn-primary text-sm disabled:opacity-50 flex items-center gap-2"
                  >
                    {bulkCreating ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        {um("um_import_reading")}
                      </>
                    ) : (
                      fmt("um_import_go", bulkRows.length)
                    )}
                  </button>
                </div>
              </div>
              {/* Read-only preview of detected rows (passwords masked) */}
              <div className="overflow-x-auto mb-4 max-h-64 overflow-y-auto border border-white/10 rounded-xl">
                <table className="w-full text-sm">
                  <thead className="sticky top-0">
                    <tr className="bg-gray-800 border-b border-white/10 text-left text-gray-400 text-xs uppercase">
                      <th className="py-2 px-3">{um("um_label_full_name")}</th>
                      <th className="py-2 px-3">{um("um_th_username")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkRows.slice(0, 100).map((row, idx) => (
                      <tr key={idx} className="border-b border-white/5">
                        <td className="py-1.5 px-3 text-gray-200 truncate max-w-[260px]">{row.fullName || "—"}</td>
                        <td className="py-1.5 px-3 text-gray-400 truncate max-w-[260px]">{row.username || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Step 3: result summary + detailed table */}
          {bulkResult && (
            <div className="border border-white/10 rounded-xl overflow-hidden">
              <div className="bg-gray-800 px-4 py-3">
                <h3 className="text-white text-sm font-semibold">{um("um_import_complete")}</h3>
                <p className="text-gray-300 text-sm mt-1">
                  {fmt("um_import_added", bulkResult.createdCount)}
                </p>
                <p className="text-gray-400 text-xs mt-1">
                  {um("um_bulk_created")} {bulkResult.createdCount} · {um("um_bulk_skipped")} {bulkResult.skippedCount} · {um("um_bulk_failed")} {bulkResult.failedCount}
                </p>
              </div>
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0">
                    <tr className="bg-gray-800 border-b border-white/10 text-left text-gray-400 text-xs uppercase">
                      <th className="py-2 px-3">{um("um_label_full_name")}</th>
                      <th className="py-2 px-3">{um("um_th_username")}</th>
                      <th className="py-2 px-3">{um("um_import_th_status")}</th>
                      <th className="py-2 px-3">{um("um_import_th_reason")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(showAllResults
                      ? bulkResult.results
                      : bulkResult.results.filter((r) => r.status !== "created")
                    ).map((r, idx) => (
                      <tr key={idx} className="border-b border-white/5">
                        <td className="py-1.5 px-3 text-gray-200 truncate max-w-[220px]">{r.fullName || "—"}</td>
                        <td className="py-1.5 px-3 text-gray-400 truncate max-w-[240px]">{r.username || "—"}</td>
                        <td className="py-1.5 px-3">
                          <span
                            className={
                              r.status === "created"
                                ? "text-green-400"
                                : r.status === "skipped"
                                ? "text-yellow-400"
                                : "text-red-400"
                            }
                          >
                            {r.status === "created"
                              ? um("um_import_status_created")
                              : r.status === "skipped"
                              ? um("um_import_status_skipped")
                              : um("um_import_status_failed")}
                          </span>
                        </td>
                        <td className="py-1.5 px-3 text-gray-500 text-xs">{r.reason ? translateError(um, r.reason) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="bg-gray-800 px-4 py-3 flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showAllResults}
                    onChange={(e) => setShowAllResults(e.target.checked)}
                    className="accent-red-600"
                  />
                  {um("um_import_show_failures")}
                </label>
                <button onClick={resetImportState} className="admin-btn admin-btn-secondary text-sm">
                  {um("um_btn_import")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════ USER LIST ═══════════ */}
      {tab === "list" && (
        <div className="admin-card">
          {/* Search + single Filter button */}
          <div className="flex gap-3 mb-4">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="admin-input flex-1 min-w-0"
              placeholder={um("um_search_placeholder")}
              aria-label={um("um_search_placeholder")}
            />
            <div className="relative flex-shrink-0">
              <button
                ref={filterButtonRef}
                onClick={() => (filterOpen ? setFilterOpen(false) : openFilter())}
                aria-expanded={filterOpen}
                aria-haspopup="dialog"
                aria-label={um("um_filter_button")}
                className={`admin-btn admin-btn-secondary flex items-center gap-2 whitespace-nowrap ${
                  activeFilterCount > 0 ? "ring-1 ring-red-500/60" : ""
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
                <span className="hidden sm:inline">{um("um_filter_button")}</span>
                {activeFilterCount > 0 && (
                  <span
                    className="bg-red-600 text-white text-[10px] font-bold min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center"
                    aria-label={`${activeFilterCount}`}
                  >
                    {activeFilterCount}
                  </span>
                )}
              </button>

              {/* Filter panel: popover on desktop (sm+), bottom sheet on mobile */}
              {filterOpen && (
                <>
                  {/* Mobile backdrop */}
                  <div
                    className="fixed inset-0 bg-black/60 z-40 sm:hidden"
                    onClick={() => setFilterOpen(false)}
                    aria-hidden="true"
                  />
                  <div
                    ref={filterRef}
                    role="dialog"
                    aria-modal="true"
                    aria-label={um("um_filter_title")}
                    className="
                      z-50 bg-gray-900 border border-white/10 rounded-2xl shadow-2xl
                      fixed bottom-0 left-0 right-0 rounded-b-none p-5 pb-8
                      sm:absolute sm:top-full sm:mt-2 sm:right-0 sm:left-auto sm:bottom-auto
                      sm:w-80 sm:p-5 sm:rounded-2xl sm:pb-5
                    "
                  >
                    {/* Drag handle (mobile) */}
                    <div className="sm:hidden flex justify-center mb-3">
                      <div className="w-10 h-1 bg-white/20 rounded-full" />
                    </div>

                    <h3 className="text-white font-semibold mb-4">{um("um_filter_title")}</h3>

                    {/* Role */}
                    <div className="mb-4">
                      <label className="block text-gray-300 text-sm font-medium mb-2">
                        {um("um_role_label")}
                      </label>
                      <select
                        value={filterRole}
                        onChange={(e) => setFilterRole(e.target.value)}
                        className="admin-input"
                      >
                        <option value="">{um("um_role_all")}</option>
                        <option value="user">{um("um_role_user")}</option>
                        <option value="admin">{um("um_role_admin")}</option>
                        <option value="owner">{um("um_role_owner")}</option>
                      </select>
                    </div>

                    {/* Status */}
                    <div className="mb-4">
                      <label className="block text-gray-300 text-sm font-medium mb-2">
                        {um("um_status_label")}
                      </label>
                      <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="admin-input"
                      >
                        <option value="">{um("um_status_all")}</option>
                        <option value="active">{um("um_status_active")}</option>
                        <option value="disabled">{um("um_status_disabled")}</option>
                      </select>
                    </div>

                    {/* Sort */}
                    <div className="mb-5">
                      <label className="block text-gray-300 text-sm font-medium mb-2">
                        {um("um_sort_label")}
                      </label>
                      <select
                        value={filterSort}
                        onChange={(e) => setFilterSort(e.target.value)}
                        className="admin-input"
                      >
                        <option value="name_asc">{um("um_sort_name_asc")}</option>
                        <option value="name_desc">{um("um_sort_name_desc")}</option>
                        <option value="newest">{um("um_sort_newest")}</option>
                        <option value="oldest">{um("um_sort_oldest")}</option>
                      </select>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <button
                        onClick={resetFilters}
                        className="admin-btn admin-btn-secondary flex-1"
                      >
                        {um("um_reset")}
                      </button>
                      <button
                        onClick={applyFilters}
                        className="admin-btn admin-btn-primary flex-1"
                      >
                        {um("um_apply")}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-gray-400">{um("um_empty")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-gray-400 text-xs uppercase">
                    <th className="py-3 px-4">{um("um_th_name")}</th>
                    <th className="py-3 px-4">{um("um_th_username")}</th>
                    <th className="py-3 px-4">{um("um_role_label")}</th>
                    <th className="py-3 px-4">{um("um_status_label")}</th>
                    <th className="py-3 px-4">{um("um_th_created")}</th>
                    <th className="py-3 px-4">{um("um_th_last_login")}</th>
                    <th className="py-3 px-4 text-right">{um("um_th_actions")}</th>
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
                          {u.role === "owner" ? um("um_role_owner") : u.role === "admin" ? um("um_role_admin") : um("um_role_user")}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`text-xs font-medium px-2 py-1 rounded ${
                          u.active
                            ? "bg-green-600/20 text-green-400"
                            : "bg-gray-600/20 text-gray-400"
                        }`}>
                          {u.active ? um("um_status_active") : um("um_status_disabled")}
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
                            {um("um_action_edit")}
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
                              {u.active ? um("um_action_disable") : um("um_action_enable")}
                            </button>
                          )}
                          {u.role !== "owner" && (
                            <button
                              onClick={() => setDeleteModal(u)}
                              className="px-2 py-1 bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded text-xs font-medium transition-colors"
                            >
                              {um("um_action_delete")}
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
            <h3 className="text-white font-semibold text-lg mb-4">{um("um_edit_title")}</h3>
            <form onSubmit={handleEditSave} className="space-y-4">
              {editError && (
                <div className="bg-red-600/10 border border-red-600/30 text-red-400 px-4 py-3 rounded-xl text-sm">
                  {editError}
                </div>
              )}
              <div>
                <label className="block text-gray-300 text-sm font-medium mb-2">{um("um_label_full_name")}</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="admin-input"
                  required
                />
              </div>
              <div>
                <label className="block text-gray-300 text-sm font-medium mb-2">{um("um_th_username")}</label>
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
                  {um("um_edit_password_hint")}
                </label>
                <input
                  type="password"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  className="admin-input"
                  placeholder={fmt("um_password_min", MIN_PASSWORD_LENGTH)}
                  autoComplete="new-password"
                />
              </div>
              {isOwner && editModal.role !== "owner" && (
                <div>
                  <label className="block text-gray-300 text-sm font-medium mb-2">{um("um_role_label")}</label>
                  <select
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value)}
                    className="admin-input"
                  >
                    <option value="user">{um("um_role_user")}</option>
                    <option value="admin">{um("um_role_admin")}</option>
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
                  {um("um_btn_cancel")}
                </button>
                <button
                  type="submit"
                  disabled={editSaving}
                  className="admin-btn admin-btn-primary flex items-center gap-2"
                >
                  {editSaving ? (
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : null}
                  {um("um_btn_save")}
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
              <h3 className="text-white font-semibold text-lg">{um("um_delete_title")}</h3>
            </div>
            <p className="text-gray-400 mb-2">
              {um("um_delete_confirm")}
            </p>
            <p className="text-gray-500 text-sm mb-6">
              &quot;{deleteModal.fullName || deleteModal.username}&quot; ({deleteModal.username}) — {um("um_delete_warning")}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteModal(null)}
                className="admin-btn admin-btn-secondary"
                disabled={deleting}
              >
                {um("um_btn_cancel")}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="admin-btn admin-btn-danger flex items-center gap-2"
              >
                {deleting ? (
                  <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : null}
                {um("um_action_delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
