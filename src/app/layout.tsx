import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import LayoutShell from "@/components/LayoutShell";
import { LanguageProvider } from "@/components/LanguageProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#dc2626",
  viewportFit: "cover",
};

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
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "eBilikAgamaTV",
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body className="min-h-full flex flex-col bg-black text-white">
        <LanguageProvider>
          <LayoutShell>{children}</LayoutShell>
        </LanguageProvider>
      </body>
    </html>
  );
}
