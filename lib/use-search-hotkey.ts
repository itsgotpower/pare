import { useEffect } from "react";

// Focus a search box from anywhere on the page by pressing "/" (the convention
// GitHub / Slack / many web apps use). Escape clears the field and blurs it.
// Targets the input by id via the DOM so it works regardless of whether the
// underlying control forwards a ref. Ignores "/" while the user is already
// typing in a field so it never eats a literal slash.
export function useSearchHotkey(inputId: string, onClear?: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.getElementById(inputId) as HTMLInputElement | null;
      if (!el) return;
      const active = document.activeElement as HTMLElement | null;
      const typing =
        active instanceof HTMLElement &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        el.focus();
      } else if (e.key === "Escape" && active === el) {
        onClear?.();
        el.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inputId, onClear]);
}
