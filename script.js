import { animate, stagger } from "https://cdn.jsdelivr.net/npm/motion@latest/+esm";

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (!reduced) {
  // Emil Kowalski-style snappy reveal:
  // - duration < 300ms (his rule for perceived performance)
  // - transform + opacity only (compositor-friendly, 60fps)
  // - ease-out for a fast-start/gradual-settle feel
  // https://emilkowal.ski/ui/great-animations
  animate(
    ".reveal",
    {
      opacity: [0, 1],
      transform: ["translateY(8px)", "translateY(0)"],
    },
    {
      duration: 0.25,
      ease: "easeOut",
      delay: stagger(0.03, { startDelay: 0.05 }),
    }
  );
}

// ---------- Theme toggle ----------
// data-theme is pre-set by the inline script in <head>. Here we sync the button
// state and wire clicks → flip theme, persist, update aria-pressed.
// OS-preference changes propagate live ONLY when the user has no stored override.
const root = document.documentElement;
const toggle = document.querySelector(".theme-toggle");

function syncPressed() {
  if (toggle) toggle.setAttribute("aria-pressed", root.dataset.theme === "dark" ? "true" : "false");
}
syncPressed();

if (toggle) {
  toggle.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch (e) {}
    syncPressed();
  });
}

// Follow OS changes when the user hasn't explicitly chosen.
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
  let stored = null;
  try { stored = localStorage.getItem("theme"); } catch (err) {}
  if (stored) return;
  root.dataset.theme = e.matches ? "dark" : "light";
  syncPressed();
});
