import { animate, stagger, circOut, easeOut } from "https://cdn.jsdelivr.net/npm/motion@latest/+esm";

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

// ---------- Keyboard navigation — go to next/previous entry ----------
// CSS scroll-snap handles the wheel and trackpad natively. Keyboard arrow
// keys bypass snap entirely — they scroll a fixed ~40px, and "scroll-snap-
// stop: always" only nudges to the nearest target afterward. Between two
// short entries (e.g. Wix body + EasySizes header), a single press can
// cross the boundary and drop you in the wrong slot. Intercepting arrow
// keys turns them into discrete "go to next/previous entry" moves — iOS
// picker behavior. Wheel/trackpad stay fully native.
function notchY() {
  return window.innerHeight * 0.42;
}

function getTargets() {
  return [...document.querySelectorAll(".cv-intro, .cv-entry")];
}

function currentIndex(targets) {
  const y = notchY();
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < targets.length; i++) {
    const d = Math.abs(targets[i].getBoundingClientRect().top - y);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

function scrollToIndex(targets, i) {
  const clamped = Math.max(0, Math.min(targets.length - 1, i));
  const el = targets[clamped];
  if (!el) return;
  const top = window.scrollY + el.getBoundingClientRect().top - notchY();
  window.scrollTo({ top, behavior: "smooth" });
}

window.addEventListener("keydown", (e) => {
  const t = e.target;
  if (t && t.matches && t.matches("input, textarea, [contenteditable]")) return;

  const step = e.key === "ArrowDown" || e.key === "PageDown" ? 1
             : e.key === "ArrowUp"   || e.key === "PageUp"   ? -1
             : 0;
  if (!step) return;

  e.preventDefault();
  const targets = getTargets();
  scrollToIndex(targets, currentIndex(targets) + step);
});

// ---------- First-paint anchor on intro ----------
// Intro is position 7/11 on the drum — the canonical center. On load we
// silently scroll so it parks at the notch. .reveal opacity:0 masks the
// pre-anchor state; what the user sees is the drum already in position.
const mobileQuery = window.matchMedia("(max-width: 600px)");

if (!mobileQuery.matches) {
  const introEl = document.querySelector(".cv-intro");
  if (introEl) {
    const y = introEl.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: y - notchY(), behavior: "auto" });
  }
}

// ---------- Distance falloff (Layer 2) ----------
// Each snap target's opacity scales with its distance from the notch: 1.0
// at the notch, linearly down to MIN_OPACITY at MAX_DIST_RATIO × vh. The
// entry at the notch reads as "selected," others fade into ambient context.
// Opacity only; no transforms. RAF-throttled. Disabled on mobile.
if (!reduced) {
  // Armed after reveal's ~600ms window so fade-in finishes cleanly before
  // we start mutating inline opacity on canonical entries.
  setTimeout(() => {
    const MIN_OPACITY = 0.3;
    const MAX_DIST_RATIO = 0.35;
    let raf = 0;

    function updateFalloff() {
      raf = 0;
      if (mobileQuery.matches) return;
      const notch = notchY();
      const maxDist = window.innerHeight * MAX_DIST_RATIO;
      for (const el of getTargets()) {
        const dist = Math.abs(el.getBoundingClientRect().top - notch);
        const t = Math.min(1, dist / maxDist);
        // circOut = circular ease-out. Same curve iOS pickers use for the
        // focal-item dim. Sharp drop-off near the notch (neighbors visibly
        // fade, center reads as selected) and a gentle tail at the periphery
        // (far entries don't slam into the floor).
        const eased = circOut(t);
        el.style.opacity = (1 - eased * (1 - MIN_OPACITY)).toFixed(3);
      }
    }

    function schedule() {
      if (raf) return;
      raf = requestAnimationFrame(updateFalloff);
    }

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    mobileQuery.addEventListener("change", () => {
      if (mobileQuery.matches) {
        for (const el of getTargets()) el.style.opacity = "";
      } else {
        schedule();
      }
    });
    updateFalloff();
  }, 700);
}

// ---------- Dial ruler ----------
// Fixed strip of repeating 1px ticks in the gutter between columns. Hidden
// by default. Fades in on scroll start (circOut, 180ms) and back out after
// scroll stops (easeOut, 320ms debounced by 220ms of inactivity). Runs on
// desktop only; CSS hides the element on mobile and in reduced motion.
if (!reduced && !mobileQuery.matches) {
  const ruler = document.querySelector(".dial-ruler");
  const body = document.querySelector(".cv-body");
  const RULER_ALPHA = 0.08;      // final opacity when visible
  const FADE_IN_MS = 180;
  const FADE_OUT_MS = 320;
  const IDLE_MS = 220;           // ms of scroll silence before fading out

  if (ruler && body) {
    // Horizontal alignment: entry ticks extend from .cv-body.left - 32 to
    // .cv-body.left - 14. Ruler sits to the LEFT of that region with a tiny
    // visual gap, so they read as a continuous tick column rather than
    // overlapping. Ruler is 6px wide; put its right edge at .cv-body.left
    // - 36 (4px clear space between ruler and entry ticks).
    function positionRuler() {
      const rect = body.getBoundingClientRect();
      const rulerWidth = ruler.offsetWidth;
      ruler.style.left = Math.round(rect.left - 36 - rulerWidth) + "px";
    }
    positionRuler();
    window.addEventListener("resize", positionRuler);

    let current = null;          // in-flight animation
    let idleTimer = 0;
    let shown = false;

    function fadeIn() {
      if (shown) return;
      shown = true;
      current?.stop();
      current = animate(
        ruler,
        { opacity: RULER_ALPHA },
        { duration: FADE_IN_MS / 1000, ease: circOut }
      );
    }

    function fadeOut() {
      if (!shown) return;
      shown = false;
      current?.stop();
      current = animate(
        ruler,
        { opacity: 0 },
        { duration: FADE_OUT_MS / 1000, ease: easeOut }
      );
    }

    window.addEventListener("scroll", () => {
      fadeIn();
      clearTimeout(idleTimer);
      idleTimer = setTimeout(fadeOut, IDLE_MS);
    }, { passive: true });
  }
}
