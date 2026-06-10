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
  Plug,
  PanelLeftClose,
  PanelLeft,
  Sun,
  Moon,
  User,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "DASHBOARD", icon: LayoutDashboard },
  { href: "/transactions", label: "TRANSACTIONS", icon: ArrowLeftRight },
  { href: "/recurring", label: "RECURRING", icon: Repeat },
  { href: "/upload", label: "UPLOAD", icon: Upload },
  { href: "/categories", label: "CATEGORIES", icon: Tag },
  { href: "/goals", label: "GOALS", icon: Target },
  { href: "/connect", label: "CONNECT", icon: Plug },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [dark, setDark] = useState(false);

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

  // The login page is a full-screen gate — no chrome.
  if (pathname === "/login") return null;

  return (
    <aside
      className={`h-screen sticky top-0 border-r border-border bg-card flex flex-col transition-[width] duration-200 ${
        collapsed ? "w-14" : "w-48"
      }`}
    >
      <div className="flex items-center justify-between px-3 h-14 border-b border-border">
        {!collapsed && (
          <Link href="/" className="font-mono text-sm font-bold tracking-tight">
            PARSE
          </Link>
        )}
        <button
          onClick={toggleCollapsed}
          className="text-muted-foreground hover:text-foreground transition-colors p-1"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
      </div>

      <nav className="flex-1 py-2">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={`flex items-center gap-3 px-4 py-2.5 font-mono text-xs tracking-widest transition-colors ${
                isActive
                  ? "text-foreground bg-accent border-l-2 border-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50 border-l-2 border-transparent"
              }`}
            >
              <Icon className="size-4 shrink-0" />
              {!collapsed && <span>{label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border py-2">
        <Link
          href="/profile"
          title={collapsed ? "PROFILE" : undefined}
          className={`flex items-center gap-3 px-4 py-2.5 font-mono text-xs tracking-widest transition-colors ${
            pathname.startsWith("/profile")
              ? "text-foreground bg-accent border-l-2 border-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/50 border-l-2 border-transparent"
          }`}
        >
          <User className="size-4 shrink-0" />
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
      </div>
    </aside>
  );
}
