"use client";

import { useState, useEffect } from "react";

interface UserInfo {
  username: string;
  fullName: string | null;
  role: string;
}

export default function AccountSettings() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        setUser(data);
        setNewUsername(data.username);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (newPassword && newPassword !== confirmPassword) {
      setError("Kata laluan baru tidak sepadan");
      return;
    }

    if (!currentPassword) {
      setError("Kata laluan semasa diperlukan untuk mengesahkan");
      return;
    }

    setSaving(true);

    try {
      const body: Record<string, string> = { currentPassword };
      if (newUsername !== user?.username) body.newUsername = newUsername;
      if (newPassword) body.newPassword = newPassword;

      if (!body.newUsername && !body.newPassword) {
        setError("Tiada perubahan dilakukan");
        setSaving(false);
        return;
      }

      const res = await fetch("/api/auth/account", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Gagal mengemas kini akaun");
        setSaving(false);
        return;
      }

      setSuccess("Akaun berjaya dikemas kini");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      if (data.username) {
        setUser((prev) => (prev ? { ...prev, username: data.username } : prev));
      }
    } catch {
      setError("Ralat rangkaian. Sila cuba lagi.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const PasswordToggle = ({
    show,
    onClick,
  }: {
    show: boolean;
    onClick: () => void;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-gray-300 transition-colors"
      tabIndex={-1}
    >
      {show ? (
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
  );

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-white text-2xl font-bold">Tetapan Akaun</h1>
        <p className="text-gray-400 mt-1">Urus profil dan keselamatan akaun anda</p>
      </div>

      <div className="max-w-2xl space-y-6">
        {/* Account Info Card */}
        <div className="admin-card">
          <h2 className="text-white font-semibold text-lg mb-4">Maklumat Akaun</h2>
          <div className="flex items-center gap-4 mb-6">
            <div className="w-16 h-16 bg-gradient-to-br from-red-600 to-red-800 rounded-2xl flex items-center justify-center text-white font-bold text-xl">
              {(user?.fullName || user?.username || "O").charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-white font-semibold text-lg">{user?.fullName || user?.username}</p>
              <p className="text-gray-400 text-sm">@{user?.username}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="inline-flex items-center gap-1.5 bg-red-600/10 border border-red-600/20 text-red-400 text-xs font-medium px-3 py-1 rounded-full">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  Role: OWNER
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Change Credentials */}
        <div className="admin-card">
          <h2 className="text-white font-semibold text-lg mb-4">Tukar Kelayakan</h2>
          <p className="text-gray-400 text-sm mb-6">
            Untuk mengubah tetapan akaun, anda mesti mengesahkan kata laluan semasa.
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="bg-red-600/10 border border-red-600/30 text-red-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                {error}
              </div>
            )}

            {success && (
              <div className="bg-green-600/10 border border-green-600/30 text-green-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {success}
              </div>
            )}

            {/* Current Password (required for any change) */}
            <div>
              <label className="block text-gray-300 text-sm font-medium mb-2">
                Kata Laluan Semasa *
              </label>
              <div className="relative">
                <input
                  type={showCurrentPassword ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="admin-input pr-10"
                  placeholder="Masukkan kata laluan semasa"
                  required
                  autoComplete="current-password"
                />
                <PasswordToggle
                  show={showCurrentPassword}
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                />
              </div>
            </div>

            <hr className="border-white/10" />

            {/* New Username */}
            <div>
              <label className="block text-gray-300 text-sm font-medium mb-2">
                Username Baru
              </label>
              <input
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className="admin-input"
                placeholder="Masukkan username baru"
                autoComplete="username"
              />
            </div>

            {/* New Password */}
            <div>
              <label className="block text-gray-300 text-sm font-medium mb-2">
                Kata Laluan Baru
              </label>
              <div className="relative">
                <input
                  type={showNewPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="admin-input pr-10"
                  placeholder="Masukkan kata laluan baru (min 6 aksara)"
                  autoComplete="new-password"
                />
                <PasswordToggle
                  show={showNewPassword}
                  onClick={() => setShowNewPassword(!showNewPassword)}
                />
              </div>
            </div>

            {/* Confirm New Password */}
            {newPassword && (
              <div>
                <label className="block text-gray-300 text-sm font-medium mb-2">
                  Sahkan Kata Laluan Baru
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="admin-input"
                  placeholder="Ulang kata laluan baru"
                  autoComplete="new-password"
                />
              </div>
            )}

            {/* Submit */}
            <div className="flex gap-4 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="admin-btn admin-btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Menyimpan...
                  </>
                ) : (
                  "Simpan Perubahan"
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
