import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import LayoutShell from "@/components/LayoutShell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "eBilikAgamaTV - Siaran Langsung Televisyen Malaysia",
  description: "Tonton saluran televisyen Malaysia secara langsung. Semua saluran RTM di satu tempat.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ms" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-black text-white">
        <LayoutShell>{children}</LayoutShell>
      </body>
    </html>
  );
}
