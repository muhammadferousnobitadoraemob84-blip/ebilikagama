"use client";

import { useEffect, useState, useCallback } from "react";

interface Admin {
  id: string;
  username: string;
  fullName: string | null;
  role: string;
  active: boolean;
  createdAt: string;
}

interface Toast {
  type: "success" | "error";
  message: string;
}

export default function AdminManagement() {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formName, setFormName] = useState("");
  const [formUsername, setFormUsername] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formConfirmPassword, setFormConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState("");

  // Edit modal state
  const [editModal, setEditModal] = useState<Admin | null>(null);
  const [editName, setEditName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editNewPassword, setEditNewPassword] = useState("");
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  // Delete modal state
  const [deleteModal, setDeleteModal] = useState<Admin | null>(null);
  const [deleting, setDeleting] = useState(false);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchAdmins = useCallback(async () => {
    try {
      const res = await fetch("/api/admins");
      if (res.status === 403) {
        setAccessDenied(true);
        setLoading(false);
        return;
      }
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setAdmins(data);
    } catch {
      showToast("error", "Gagal memuatkan senarai admin");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAdmins();
  }, [fetchAdmins]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!formUsername.trim() || !formPassword) {
      setFormError("Username dan kata laluan diperlukan.");
      return;
    }

    if (formPassword !== formConfirmPassword) {
      setFormError("Password tidak sepadan.");
      return;
    }

    if (formPassword.length < 6) {
      setFormError("Kata laluan mestilah sekurang-kurangnya 6 aksara.");
      return;
    }

    setSaving(true);

    try {
      const res = await fetch("/api/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: formUsername.trim(),
          fullName: formName.trim() || null,
          password: formPassword,
          confirmPassword: formConfirmPassword,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setFormError(data.error || "Gagal mencipta admin.");
        setSaving(false);
        return;
      }

      showToast("success", "Admin berjaya ditambah.");
      setShowForm(false);
      setFormName("");
      setFormUsername("");
      setFormPassword("");
      setFormConfirmPassword("");
      fetchAdmins();
    } catch {
      setFormError("Ralat rangkaian. Sila cuba lagi.");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModal) return;
    setEditError("");

    if (editNewPassword && editNewPassword.length < 6) {
      setEditError("Kata laluan mestilah sekurang-kurangnya 6 aksara.");
      return;
    }

    setEditSaving(true);

    try {
      const body: Record<string, unknown> = {};
      if (editName.trim()) body.fullName = editName.trim();
      if (editUsername.trim() !== editModal.username) body.username = editUsername.trim();
      if (editNewPassword) body.newPassword = editNewPassword;

      const res = await fetch(`/api/admins/${editModal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setEditError(data.error || "Gagal mengemas kini admin.");
        setEditSaving(false);
        return;
      }

      showToast("success", "Admin berjaya dikemas kini.");
      setEditModal(null);
      fetchAdmins();
    } catch {
      setEditError("Ralat rangkaian.");
    } finally {
      setEditSaving(false);
    }
  };

  const handleToggleActive = async (admin: Admin) => {
    try {
      const res = await fetch(`/api/admins/${admin.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !admin.active }),
      });
      if (res.ok) {
        fetchAdmins();
        showToast("success", admin.active ? "Admin dinonaktifkan." : "Admin diaktifkan.");
      }
    } catch {
      showToast("error", "Gagal mengubah status admin.");
    }
  };

  const handleDelete = async () => {
    if (!deleteModal) return;
    setDeleting(true);

    try {
      const res = await fetch(`/api/admins/${deleteModal.id}`, { method: "DELETE" });
      const data = await res.json();

      if (!res.ok) {
        showToast("error", data.error || "Gagal memadam admin.");
        setDeleting(false);
        setDeleteModal(null);
        return;
      }

      showToast("success", "Admin berjaya dipadam.");
      setDeleteModal(null);
      fetchAdmins();
    } catch {
      showToast("error", "Gagal memadam admin.");
    } finally {
      setDeleting(false);
    }
  };

  // Access denied
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
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

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-white text-2xl font-bold">Pengurusan Admin</h1>
          <p className="text-gray-400 mt-1">Urus akaun pentadbir website</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="admin-btn admin-btn-primary flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Tambah Admin
        </button>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="admin-card mb-6">
          <h2 className="text-white font-semibold text-lg mb-4">Tambah Admin Baru</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            {formError && (
              <div className="bg-red-600/10 border border-red-600/30 text-red-400 px-4 py-3 rounded-xl text-sm">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-gray-300 text-sm font-medium mb-2">Nama Penuh</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="admin-input"
                  placeholder="Contoh: Ahmad bin Abu"
                />
              </div>
              <div>
                <label className="block text-gray-300 text-sm font-medium mb-2">Username *</label>
                <input
                  type="text"
                  value={formUsername}
                  onChange={(e) => setFormUsername(e.target.value)}
                  className="admin-input"
                  placeholder="Contoh: admin1"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-gray-300 text-sm font-medium mb-2">Kata Laluan *</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    className="admin-input pr-10"
                    placeholder="Min 6 aksara"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-gray-300"
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-gray-300 text-sm font-medium mb-2">Sahkan Kata Laluan *</label>
                <input
                  type="password"
                  value={formConfirmPassword}
                  onChange={(e) => setFormConfirmPassword(e.target.value)}
                  className="admin-input"
                  placeholder="Ulang kata laluan"
                  required
                />
              </div>
            </div>

            <div className="flex items-center gap-2 text-sm text-gray-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Akaun baru akan mempunyai peranan ADMIN.
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="admin-btn admin-btn-primary flex items-center gap-2 disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Mencipta...
                  </>
                ) : (
                  "Cipta Admin"
                )}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setFormError(""); }}
                className="admin-btn admin-btn-secondary"
              >
                Batal
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Admin List */}
      <div className="admin-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left text-gray-400 font-medium py-3 px-4">Nama</th>
                <th className="text-left text-gray-400 font-medium py-3 px-4">Username</th>
                <th className="text-left text-gray-400 font-medium py-3 px-4">Peranan</th>
                <th className="text-left text-gray-400 font-medium py-3 px-4">Status</th>
                <th className="text-left text-gray-400 font-medium py-3 px-4">Dicipta</th>
                <th className="text-right text-gray-400 font-medium py-3 px-4">Tindakan</th>
              </tr>
            </thead>
            <tbody>
              {admins.map((admin) => (
                <tr key={admin.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-gradient-to-br from-gray-600 to-gray-700 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                        {(admin.fullName || admin.username).charAt(0).toUpperCase()}
                      </div>
                      <span className="text-white font-medium">
                        {admin.fullName || "—"}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-gray-300">{admin.username}</td>
                  <td className="py-3 px-4">
                    <span className={`text-xs font-medium px-2 py-1 rounded ${
                      admin.role === "owner"
                        ? "bg-red-600/20 text-red-400"
                        : "bg-blue-600/20 text-blue-400"
                    }`}>
                      {admin.role === "owner" ? "OWNER" : "ADMIN"}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`text-xs font-medium px-2 py-1 rounded ${
                      admin.active
                        ? "bg-green-600/20 text-green-400"
                        : "bg-gray-600/20 text-gray-400"
                    }`}>
                      {admin.active ? "Aktif" : "Tidak Aktif"}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-gray-500 text-xs">
                    {new Date(admin.createdAt).toLocaleDateString("ms-MY")}
                  </td>
                  <td className="py-3 px-4 text-right">
                    {admin.role === "owner" ? (
                      <span className="text-gray-600 text-xs">—</span>
                    ) : (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleToggleActive(admin)}
                          className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                            admin.active
                              ? "bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/30"
                              : "bg-green-600/20 text-green-400 hover:bg-green-600/30"
                          }`}
                        >
                          {admin.active ? "Nyahaktif" : "Aktifkan"}
                        </button>
                        <button
                          onClick={() => {
                            setEditModal(admin);
                            setEditName(admin.fullName || "");
                            setEditUsername(admin.username);
                            setEditNewPassword("");
                            setEditError("");
                          }}
                          className="px-2 py-1 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 rounded text-xs font-medium transition-colors"
                        >
                          Sunting
                        </button>
                        <button
                          onClick={() => setDeleteModal(admin)}
                          className="px-2 py-1 bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded text-xs font-medium transition-colors"
                        >
                          Padam
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Modal */}
      {editModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 max-w-md w-full">
            <h3 className="text-white font-semibold text-lg mb-4">Sunting Admin</h3>
            <form onSubmit={handleEdit} className="space-y-4">
              {editError && (
                <div className="bg-red-600/10 border border-red-600/30 text-red-400 px-4 py-3 rounded-xl text-sm">
                  {editError}
                </div>
              )}
              <div>
                <label className="block text-gray-300 text-sm font-medium mb-2">Nama Penuh</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="admin-input"
                  placeholder="Nama penuh"
                />
              </div>
              <div>
                <label className="block text-gray-300 text-sm font-medium mb-2">Username</label>
                <input
                  type="text"
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                  className="admin-input"
                  required
                />
              </div>
              <div>
                <label className="block text-gray-300 text-sm font-medium mb-2">Kata Laluan Baru (biarkan kosong jika tidak mahu tukar)</label>
                <div className="relative">
                  <input
                    type={showEditPassword ? "text" : "password"}
                    value={editNewPassword}
                    onChange={(e) => setEditNewPassword(e.target.value)}
                    className="admin-input pr-10"
                    placeholder="Min 6 aksara"
                  />
                  <button
                    type="button"
                    onClick={() => setShowEditPassword(!showEditPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-gray-300"
                    tabIndex={-1}
                  >
                    {showEditPassword ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
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
              <h3 className="text-white font-semibold text-lg">Padam Admin</h3>
            </div>
            <p className="text-gray-400 mb-2">
              Adakah anda pasti mahu memadamkan admin ini?
            </p>
            <p className="text-gray-500 text-sm mb-6">
              &quot;{deleteModal.username}&quot; — Tindakan ini tidak boleh dibatalkan.
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
