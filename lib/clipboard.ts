// Copy text to the clipboard with a non-secure-context fallback. The Clipboard
// API needs HTTPS/localhost; plain-HTTP LAN access (a common self-host setup)
// falls back to the legacy execCommand path.
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}
