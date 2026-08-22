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
  description: "Media Bilik Agama™ yang dibangunkan oleh Unit Hal Ehwal Islam SMJK Chung Hwa Tenom untuk memperluas dakwah Islam dikalangan murid dan ibu bapa.",
  openGraph: {
    title: "eBilikAgamaTV - Siaran Langsung Televisyen Malaysia",
    description: "Media Bilik Agama™ yang dibangunkan oleh Unit Hal Ehwal Islam SMJK Chung Hwa Tenom untuk memperluas dakwah Islam dikalangan murid dan ibu bapa.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "eBilikAgamaTV - Siaran Langsung Televisyen Malaysia",
    description: "Media Bilik Agama™ yang dibangunkan oleh Unit Hal Ehwal Islam SMJK Chung Hwa Tenom untuk memperluas dakwah Islam dikalangan murid dan ibu bapa.",
  },
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
