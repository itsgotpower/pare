import type { Metadata, Viewport } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import { Sidebar } from "@/components/layout/navbar";
import { RegisterSW, OfflineBanner } from "@/components/pwa/register-sw";
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
  title: "Pare | Talk to Claude about your money",
  description:
    "Turn bank and credit-card statements into spending trends and forecasts, then talk to Claude over MCP to build a budget. Files deleted after parsing; nothing stored.",
  // Installed-PWA chrome on iOS (Android reads the same from the manifest).
  // "black-translucent" = the app draws under the status bar (no white strip)
  // — the most app-like look. Modern iOS flips the clock colour to stay
  // legible against the underlying content, so it's safe on both themes.
  appleWebApp: {
    capable: true,
    title: "pare",
    statusBarStyle: "black-translucent",
  },
};

// viewport-fit=cover so the bottom tab bar can pad into the home-indicator
// safe area on notched phones.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
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
      // The theme-seed script below may add `.dark` before hydration.
      suppressHydrationWarning
    >
      {/* Column on phones (top bar / content / tab bar via order classes),
          row on desktop (sidebar / content). */}
      <body className="h-full flex flex-col md:flex-row">
        {/* Pre-paint theme seed. Installed-PWA launches (standalone) default
            to dark on first run — the preferred installed look alongside the
            black-translucent status bar. Seeding localStorage — not just the
            class — keeps the Sidebar/landing toggles (which read `parse-dark`)
            in sync; an existing preference always wins. Parser-blocking on
            purpose so there's no light-theme flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var d=localStorage.getItem("parse-dark");var s=matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;if(d===null&&s){localStorage.setItem("parse-dark","true");d="true"}if(d==="true")document.documentElement.classList.add("dark")}catch(e){}`,
          }}
        />
        <Sidebar />
        <main className="flex-1 overflow-auto min-h-0">{children}</main>
        <RegisterSW />
        <OfflineBanner />
      </body>
    </html>
  );
}
