"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  ArrowLeftRight,
  Upload,
  Tag,
  Target,
  Repeat,
  Store,
  Brain,
  PanelLeftClose,
  PanelLeft,
  Sun,
  Moon,
  User,
} from "lucide-react";
import { PALETTE } from "@/lib/colors";
import { Wordmark } from "@/components/layout/wordmark";

const REPO_URL = "https://github.com/itsgotpower/pare";
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "";

// "/" is the public marketing landing; the signed-in app starts at /dashboard.
// UPLOAD is deliberately NOT in this list — it's the primary action (ingest a
// statement), so it lives in its own group below, visually set apart.
const NAV_ITEMS = [
  { href: "/dashboard", label: "DASHBOARD", icon: LayoutDashboard },
  { href: "/transactions", label: "TRANSACTIONS", icon: ArrowLeftRight },
  { href: "/merchants", label: "MERCHANTS", icon: Store },
  { href: "/recurring", label: "RECURRING", icon: Repeat },
  { href: "/categories", label: "CATEGORIES", icon: Tag },
  { href: "/goals", label: "GOALS", icon: Target },
  { href: "/connect", label: "CLAUDE", icon: Brain },
];

// Bottom tab bar on phones: the five main destinations. Upload lives in the
// top bar as an action, connect/profile/theme ride along with it.
const MOBILE_TABS = [
  { href: "/dashboard", label: "DASH", icon: LayoutDashboard },
  { href: "/transactions", label: "TXNS", icon: ArrowLeftRight },
  { href: "/recurring", label: "RECUR", icon: Repeat },
  { href: "/categories", label: "CATS", icon: Tag },
  { href: "/goals", label: "GOALS", icon: Target },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [dark, setDark] = useState(false);
  // "Action needed" signal for the Upload item: true when the account has no
  // spend data yet (nothing imported). Cheap probe, re-run on navigation so the
  // badge clears once the first statement lands. Works in both deploy modes
  // (the summary route is gated per-user in hosted, single-user in self-host).
  const [needsUpload, setNeedsUpload] = useState(false);

  useEffect(() => {
    const storedDark = localStorage.getItem("parse-dark");
    if (storedDark === "true") {
      setDark(true);
      document.documentElement.classList.add("dark");
    }
    const storedCollapsed = localStorage.getItem("parse-sidebar-collapsed");
    if (storedCollapsed === "true") {
      setCollapsed(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/summary?type=has_data")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setNeedsUpload(!d.hasData);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("parse-dark", String(next));
  };

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("parse-sidebar-collapsed", String(next));
  };

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  // The login gate, the public marketing homepage, and the public marketing /
  // legal + marketing pages (about / mcp / privacy / terms / security / switch /
  // switching / how-it-works / blog) are full-screen — no app chrome.
  if (
    pathname === "/login" ||
    pathname === "/" ||
    pathname === "/demo" ||
    pathname === "/about" ||
    pathname === "/mcp" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname === "/security" ||
    pathname === "/switch" ||
    pathname === "/switch-from-monarch" ||
    pathname === "/switching" ||
    pathname === "/how-it-works" ||
    pathname === "/pricing" ||
    pathname === "/blog" ||
    pathname.startsWith("/blog/")
  )
    return null;

  return (
    <>
      {/* Mobile top bar — wordmark + actions (upload is an action, not a tab) */}
      <header className="md:hidden order-first shrink-0 z-40 bg-card border-b border-border pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between h-12 pl-4 pr-1">
          <Wordmark href="/dashboard" className="font-mono text-sm font-bold tracking-tight" />
          <div className="flex items-center">
            {[
              { href: "/upload", label: "Upload statements", icon: Upload },
              { href: "/connect", label: "Connect to Claude", icon: Brain },
            ].map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-label={label}
                className={`relative flex items-center justify-center w-11 h-12 transition-colors ${
                  isActive(href)
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="size-4" />
                {href === "/upload" && needsUpload && (
                  <span
                    aria-hidden
                    className="absolute top-2.5 right-2.5 size-1.5 rounded-full"
                    style={{ backgroundColor: PALETTE.dustyblue }}
                  />
                )}
              </Link>
            ))}
            <button
              onClick={toggleDark}
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
              className="flex items-center justify-center w-11 h-12 text-muted-foreground hover:text-foreground transition-colors"
            >
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
            <Link
              href="/profile"
              aria-label="Profile"
              className={`flex items-center justify-center w-11 h-12 transition-colors ${
                isActive("/profile")
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <User className="size-4" />
            </Link>
          </div>
        </div>
      </header>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden order-last shrink-0 z-40 bg-card border-t border-border pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-5">
          {MOBILE_TABS.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                style={active ? { borderTopColor: PALETTE.dustyblue } : undefined}
                className={`flex flex-col items-center justify-center gap-1 h-14 font-mono text-[9px] tracking-widest transition-colors border-t-2 ${
                  active
                    ? "text-foreground bg-accent"
                    : "text-muted-foreground border-transparent"
                }`}
              >
                <Icon className="size-4" style={active ? { color: PALETTE.dustyblue } : undefined} />
                <span>{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Desktop sidebar */}
      <aside
        className={`hidden md:flex h-screen sticky top-0 border-r border-border bg-card flex-col transition-[width] duration-200 ${
          collapsed ? "w-14" : "w-48"
        }`}
      >
        <div className="flex items-center justify-between px-3 h-14 border-b border-border">
          {!collapsed && (
            <Wordmark href="/dashboard" className="font-mono text-sm font-bold tracking-tight" />
          )}
          <button
            onClick={toggleCollapsed}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
          </button>
        </div>

        <nav className="flex-1 py-2 flex flex-col">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                title={collapsed ? label : undefined}
                style={active ? { borderLeftColor: PALETTE.dustyblue } : undefined}
                className={`flex items-center gap-3 px-4 py-2.5 font-mono text-xs tracking-widest leading-tight transition-colors border-l-2 ${
                  active
                    ? "text-foreground bg-accent"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50 border-transparent"
                }`}
              >
                <Icon
                  className="size-4 shrink-0"
                  style={active ? { color: PALETTE.dustyblue } : undefined}
                />
                {!collapsed && <span>{label}</span>}
              </Link>
            );
          })}

          {/* UPLOAD — the primary action, set apart from the browse/analyse nav.
              A dustyblue dot flags it when there's nothing imported yet. */}
          <div className="mt-auto px-3 pt-3">
            {(() => {
              const active = isActive("/upload");
              return (
                <Link
                  href="/upload"
                  title={collapsed ? "UPLOAD STATEMENTS" : undefined}
                  style={active ? { borderColor: PALETTE.dustyblue } : undefined}
                  className={`relative flex items-center gap-3 px-3 py-2.5 font-mono text-xs tracking-widest border transition-colors ${
                    active
                      ? "bg-accent text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-foreground hover:bg-accent/50"
                  }`}
                >
                  <Upload
                    className="size-4 shrink-0"
                    style={active ? { color: PALETTE.dustyblue } : undefined}
                  />
                  {!collapsed && <span>UPLOAD</span>}
                  {needsUpload && (
                    <span
                      aria-label="No statements imported yet"
                      className={`size-1.5 rounded-full ${collapsed ? "absolute top-1.5 right-1.5" : "ml-auto"}`}
                      style={{ backgroundColor: PALETTE.dustyblue }}
                    />
                  )}
                </Link>
              );
            })()}
          </div>
        </nav>

        <div className="border-t border-border py-2">
          <Link
            href="/profile"
            title={collapsed ? "PROFILE" : undefined}
            style={
              pathname.startsWith("/profile")
                ? { borderLeftColor: PALETTE.dustyblue }
                : undefined
            }
            className={`flex items-center gap-3 px-4 py-2.5 font-mono text-xs tracking-widest transition-colors border-l-2 ${
              pathname.startsWith("/profile")
                ? "text-foreground bg-accent"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50 border-transparent"
            }`}
          >
            <User
              className="size-4 shrink-0"
              style={pathname.startsWith("/profile") ? { color: PALETTE.dustyblue } : undefined}
            />
            {!collapsed && <span>PROFILE</span>}
          </Link>
          <button
            onClick={toggleDark}
            title={dark ? "Switch to light mode" : "Switch to dark mode"}
            className="flex items-center gap-3 px-4 py-2.5 w-full font-mono text-xs tracking-widest text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          >
            {dark ? <Sun className="size-4 shrink-0" /> : <Moon className="size-4 shrink-0" />}
            {!collapsed && <span>{dark ? "LIGHT" : "DARK"}</span>}
          </button>
          {!collapsed && APP_VERSION && (
            <a
              href={`${REPO_URL}/releases/tag/v${APP_VERSION}`}
              target="_blank"
              rel="noopener noreferrer"
              title={`Pare v${APP_VERSION} — release notes`}
              className="block px-4 pt-1.5 font-mono text-[10px] tracking-widest text-muted-foreground/60 hover:text-foreground transition-colors"
            >
              v{APP_VERSION}
            </a>
          )}
        </div>
      </aside>
    </>
  );
}
