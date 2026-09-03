"use client";

import { usePathname } from "next/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import PageLoader from "@/components/PageLoader";

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname.startsWith("/admin");

  // Login page gets no chrome at all
  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  // Other admin pages get no public header/footer (admin has its own layout)
  if (isAdmin) {
    return <>{children}</>;
  }

  // Public pages get full chrome + loading overlay
  return (
    <>
      <PageLoader />
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </>
  );
}
