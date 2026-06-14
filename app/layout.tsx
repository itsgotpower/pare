import type { Metadata, Viewport } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import { Sidebar } from "@/components/layout/navbar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PARE",
  description:
    "Turn bank and credit-card PDF statements into spending trends, forecasts, and budgets — private by design, free to start.",
};

// viewport-fit=cover so the bottom tab bar can pad into the home-indicator
// safe area on notched phones.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${jetbrainsMono.variable} h-full`}
    >
      {/* Column on phones (top bar / content / tab bar via order classes),
          row on desktop (sidebar / content). */}
      <body className="h-full flex flex-col md:flex-row">
        <Sidebar />
        <main className="flex-1 overflow-auto min-h-0">{children}</main>
      </body>
    </html>
  );
}
