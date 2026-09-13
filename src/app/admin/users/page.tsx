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

interface ImportRow {
  raw: string[]; // original cells (mapping mode)
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

  // XLSX/DOCX import
  const [importing, setImporting] = useState(false);
  const [importNeedsMapping, setImportNeedsMapping] = useState(false);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [importMapping, setImportMapping] = useState<{ fullName: number | null; username: number | null; password: number | null }>({
    fullName: null,
    username: null,
    password: null,
  });

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
        // Strip UTF-8 BOM so the first header column is not polluted
        let text = String(reader.result || "");
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

        // RFC-4180-style row tokenizer with quote handling
        const parseCsvRows = (raw: string, delim: string): string[][] => {
          const out: string[][] = [];
          let row: string[] = [];
          let field = "";
          let inQuotes = false;
          for (let i = 0; i < raw.length; i++) {
            const ch = raw[i];
            if (inQuotes) {
              if (ch === '"') {
                if (raw[i + 1] === '"') {
                  field += '"';
                  i++;
                } else {
                  inQuotes = false;
                }
              } else {
                field += ch;
              }
            } else if (ch === '"') {
              inQuotes = true;
            } else if (ch === delim) {
              row.push(field);
              field = "";
            } else if (ch === "\n" || ch === "\r") {
              if (ch === "\r" && raw[i + 1] === "\n") i++;
              row.push(field);
              field = "";
              out.push(row);
              row = [];
            } else {
              field += ch;
            }
          }
          if (field.length > 0 || row.length > 0) {
            row.push(field);
            out.push(row);
          }
          return out;
        };

        // Auto-detect delimiter from the first non-empty line
        const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || "";
        const counts: Record<string, number> = {
          ",": (firstLine.match(/,/g) || []).length,
          ";": (firstLine.match(/;/g) || []).length,
          "\t": (firstLine.match(/\t/g) || []).length,
        };
        const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
          ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
          : ",";
        console.log(`[UserImport] CSV "${file.name}": delimiter=${JSON.stringify(delim)}`);

        const allRows = parseCsvRows(text, delim).filter((r) =>
          r.some((c) => c.trim())
        );

        // Reuse the shared header detection so "Full Name;Username;Password"
        // headers work with any casing/spacing, and headerless 3-col files
        // still map positionally.
        const nameRe = /^(full[\s._-]*)?name$/i;
        const userRe = /^(user(name)?|email)(\s*\/?\s*(email))?$/i;
        const passRe = /^(pass(word)?|pwd|kata[\s._-]*laluan)$/i;
        let headerIdx = -1;
        let map = { fullName: 0, username: 1, password: 2 };
        const limit = Math.min(allRows.length, 8);
        for (let i = 0; i < limit; i++) {
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
        const parsed: StagedRow[] = dataRows
          .filter((r) => r.some((c) => c.trim()))
          .map((r) => ({
            fullName: (r[map.fullName] || "").trim(),
            username: (r[map.username] || "").trim(),
            // Preserve the password exactly as imported (no trim on purpose):
            // special characters and intentional spaces stay intact.
            password: r[map.password] || "",
          }))
          .filter((r) => r.fullName || r.username);

        console.log(
          `[UserImport] CSV "${file.name}": ${allRows.length} rows read, header=${headerIdx}, ${parsed.length} valid rows`
        );

        if (parsed.length === 0) {
          setCsvError(um("um_import_err_norows"));
        } else {
          setBulkRows(parsed); // replace placeholders with imported rows
          showToast("success", fmt("um_import_success", parsed.length));
        }
      } catch {
        setCsvError(um("um_import_err_upload"));
      }
      // Allow re-importing the same file later
      e.target.value = "";
    };
    reader.readAsText(file);
  };

  // ── XLSX / DOCX import: parse server-side, then stage rows ──
  const handleDocImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setCsvError("");
    setImportNeedsMapping(false);
    setImportRows([]);
    const file = e.target.files?.[0];
    if (!file) return;

    // CSV keeps the lightweight client-side path
    if (file.name.toLowerCase().endsWith(".csv")) {
      handleCsvImport(e);
      return;
    }

    console.log(
      `[UserImport] file="${file.name}" size=${file.size} type=${file.type || "unknown"}`
    );

    setImporting(true);
    try {
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
        `[UserImport] parsed "${file.name}": sheets=${JSON.stringify(data.debug?.sheets ?? [])} selected="${data.debug?.selected ?? "?"}" rows=${data.rowCount} needsMapping=${data.needsMapping}`
      );
      if (!data.rows || data.rows.length === 0) {
        setCsvError(um("um_import_err_notable"));
        return;
      }
      setImportHeaders(data.headers || []);
      if (data.needsMapping) {
        // Columns not confidently identified → manual mapping step
        setImportNeedsMapping(true);
        setImportRows(data.rows.map((r: { raw: string[] }) => ({ ...r, fullName: "", username: "", password: "" })));
        setImportMapping(data.mapping || { fullName: null, username: null, password: null });
      } else {
        // All required columns identified → stage rows directly (replaces placeholders)
        stageImportRows(data.rows, data.mapping);
        showToast("success", fmt("um_import_success", data.rows.length));
      }
    } catch {
      setCsvError(um("um_import_err_upload"));
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  const stageImportRows = (
    rows: { fullName?: string; username?: string; password?: string; raw?: string[] }[],
    mapping?: { fullName: number | null; username: number | null; password: number | null }
  ) => {
    const staged: StagedRow[] = rows.map((r) => {
      const fullName = (r.fullName ?? (mapping && mapping.fullName !== null && r.raw ? r.raw[mapping.fullName] : "") ?? "").trim();
      const username = (r.username ?? (mapping && mapping.username !== null && r.raw ? r.raw[mapping.username] : "") ?? "").trim();
      const password = (r.password ?? (mapping && mapping.password !== null && r.raw ? r.raw[mapping.password] : "") ?? "").trim();
      return { fullName, username, password };
    });
    setBulkRows(staged);
    setImportNeedsMapping(false);
  };

  // ── Bulk: validate preview ──
  const buildBulkPreview = () => {
    const preview: PreviewRow[] = bulkRows.map((r) => {
      const fullName = r.fullName.trim();
      if (!fullName) return { ...r, valid: false, reason: translateError(um, "Full name is required") };
      const uErr = validateUsernameLocal(r.username);
      if (uErr) return { ...r, valid: false, reason: translateError(um, uErr) };
      const pErr = validatePasswordLocal(r.password);
      if (pErr) return { ...r, valid: false, reason: translateError(um, pErr) };
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
        showToast("error", translateError(um, data.error) || um("um_err_create"));
        return;
      }
      setBulkResult(data);
      setBulkRows([]);
      setBulkPreview(null);
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

      {/* ═══════════ BULK ADD USERS ═══════════ */}
      {tab === "bulk" && (
        <div className="admin-card max-w-4xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-white font-semibold text-lg">{um("um_bulk_title")}</h2>
              <p className="text-gray-400 text-sm mt-1">
                {um("um_bulk_desc")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="admin-btn admin-btn-secondary cursor-pointer flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                {importing ? um("um_importing") : um("um_btn_import")}
                <input
                  type="file"
                  accept=".csv,.xlsx,.docx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={handleDocImport}
                  className="hidden"
                  disabled={importing}
                />
              </label>
            </div>
          </div>

          {csvError && (
            <div className="bg-red-600/10 border border-red-600/30 text-red-400 px-4 py-3 rounded-xl text-sm mb-4">
              {csvError}
            </div>
          )}

          {/* XLSX/DOCX column-mapping step */}
          {importNeedsMapping && (
            <div className="bg-blue-600/10 border border-blue-600/30 rounded-xl p-4 mb-4">
              <h3 className="text-white font-semibold mb-1">{um("um_mapping_title")}</h3>
              <p className="text-gray-400 text-sm mb-3">
                Map the file columns to the user fields, then click Apply.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                {(["fullName", "username", "password"] as const).map((field) => (
                  <div key={field}>
                    <label className="block text-gray-300 text-xs font-medium mb-1">
                      {field === "fullName" ? um("um_label_full_name") : field === "username" ? um("um_th_username") : um("um_label_password")}
                    </label>
                    <select
                      className="admin-input"
                      value={importMapping[field] ?? ""}
                      onChange={(e) =>
                        setImportMapping((m) => ({
                          ...m,
                          [field]: e.target.value === "" ? null : parseInt(e.target.value, 10),
                        }))
                      }
                    >
                      <option value="">{um("um_mapping_none")}</option>
                      {importHeaders.map((h, i) => (
                        <option key={i} value={i}>
                          {h.trim() || fmt("um_mapping_column", i + 1)}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              {/* First rows preview for mapping context */}
              <div className="overflow-x-auto mb-3 max-h-40">
                <table className="w-full text-xs">
                  <tbody>
                    {importRows.slice(0, 5).map((r, ri) => (
                      <tr key={ri} className="border-b border-white/5">
                        {r.raw.map((cell, ci) => (
                          <td key={ci} className="py-1 px-2 text-gray-400 whitespace-nowrap">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => stageImportRows(importRows, importMapping)}
                  disabled={importMapping.fullName === null || importMapping.username === null}
                  className="admin-btn admin-btn-primary text-sm disabled:opacity-50"
                >
                  {um("um_mapping_apply")}
                </button>
                <button
                  onClick={() => {
                    setImportNeedsMapping(false);
                    setImportRows([]);
                  }}
                  className="admin-btn admin-btn-secondary text-sm"
                >
                  {um("um_btn_cancel")}
                </button>
              </div>
            </div>
          )}

          {/* Staged rows table */}
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-gray-400 text-xs uppercase">
                  <th className="py-2 px-2">{um("um_label_full_name")}</th>
                  <th className="py-2 px-2">{um("um_th_username")}</th>
                  <th className="py-2 px-2">{um("um_label_password")}</th>
                  <th className="py-2 px-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {bulkRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-gray-500 text-sm">
                      {um("um_bulk_empty")}
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
              {um("um_bulk_add_row")}
            </button>
            <button
              onClick={buildBulkPreview}
              disabled={bulkRows.length === 0}
              className="admin-btn admin-btn-primary text-sm disabled:opacity-50"
            >
              {um("um_bulk_validate")}
            </button>
          </div>

          {/* Preview */}
          {bulkPreview && (
            <div className="border border-white/10 rounded-xl overflow-hidden">
              <div className="bg-gray-800 px-4 py-3 flex items-center justify-between">
                <h3 className="text-white text-sm font-medium">{um("um_bulk_review")}</h3>
                <p className="text-xs text-gray-400">
                  {bulkValidCount} {um("um_bulk_valid")} · {bulkPreview.length - bulkValidCount} {um("um_bulk_invalid")}
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
                  {um("um_btn_cancel")}
                </button>
                <button
                  onClick={handleBulkCreate}
                  disabled={bulkCreating || bulkValidCount === 0}
                  className="admin-btn admin-btn-primary text-sm disabled:opacity-50 flex items-center gap-2"
                >
                  {bulkCreating ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      {um("um_btn_creating")}
                    </>
                  ) : (
                    fmt("um_bulk_create_valid", bulkValidCount)
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Bulk result summary */}
          {bulkResult && (
            <div className="mt-4 border border-white/10 rounded-xl overflow-hidden">
              <div className="bg-gray-800 px-4 py-3">
                <h3 className="text-white text-sm font-medium">{um("um_bulk_done")}</h3>
                <p className="text-gray-400 text-xs mt-1">
                  {um("um_bulk_created")} {bulkResult.createdCount} · {um("um_bulk_skipped")} {bulkResult.skippedCount} · {um("um_bulk_failed")} {bulkResult.failedCount}
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
                    {um("um_bulk_all_ok")}
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
