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

    const NOTCHED_THRESHOLD = 20;  // px — within this, the entry is "the one"

    // ---------- Lamp acknowledgment driver ----------
    // When an entry becomes "the one" (dial-in moment), the fluorescent lamp
    // briefly blooms then holds slightly brighter. One CSS custom property —
    // --lamp-intensity, 0..1 — drives both the peak-glow overlay on the lamp
    // AND the identity gradient stretch, so they move in lockstep. Future
    // cursor-proximity can compose into the same variable (take the max, or
    // additive with a clamp) without a second system.
    //
    // Motion character is "dial detent," not "fluorescent physics." The rise
    // is the click of a rotary detent catching the notch: ~120ms, circOut
    // (front-loaded, reads as a crisp engagement). The decay to the held
    // level is ~420ms easeOut — smooth enough not to feel mechanical, quick
    // enough to complete before the eye returns from the scroll.
    //
    // Release is *deferred* by RELEASE_GRACE_MS. A dial passing through the
    // zone between two detents isn't "un-anchored" — it's mid-rotation. If
    // the next entry notches within the grace window, the release never
    // fires and the next acknowledge pulses from the current held level
    // (no dim-then-flash flicker). Only a genuine rest between entries
    // (or scroll to the top/bottom spacer) lets release run.
    const RELEASE_GRACE_MS = 180;
    let prevNotchedIdx = null;   // null = no observation yet; -1 = between entries; >=0 = dialed-in
    let lampAnim = null;
    let releaseTimer = 0;

    function acknowledge() {
      clearTimeout(releaseTimer);
      releaseTimer = 0;
      lampAnim?.stop();
      const from = parseFloat(getComputedStyle(root).getPropertyValue("--lamp-intensity")) || 0;
      lampAnim = animate(
        root,
        { "--lamp-intensity": [from, 1, 0.3] },
        { duration: 0.54, times: [0, 0.22, 1], ease: [circOut, easeOut] }
      );
    }

    function scheduleRelease() {
      clearTimeout(releaseTimer);
      releaseTimer = setTimeout(() => {
        releaseTimer = 0;
        lampAnim?.stop();
        lampAnim = animate(
          root,
          { "--lamp-intensity": 0 },
          { duration: 0.26, ease: easeOut }
        );
      }, RELEASE_GRACE_MS);
    }

    function updateFalloff() {
      raf = 0;
      if (mobileQuery.matches) return;
      const notch = notchY();
      const maxDist = window.innerHeight * MAX_DIST_RATIO;
      const targets = getTargets();

      // First pass — measure, find the entry closest to the notch.
      const dists = new Array(targets.length);
      let closestIdx = -1;
      let closestDist = Infinity;
      for (let i = 0; i < targets.length; i++) {
        const d = Math.abs(targets[i].getBoundingClientRect().top - notch);
        dists[i] = d;
        if (d < closestDist) { closestDist = d; closestIdx = i; }
      }
      const notchedIdx = closestDist <= NOTCHED_THRESHOLD ? closestIdx : -1;

      // Lamp acknowledgment — fire on state transitions only. The first
      // observation (prevNotchedIdx === null) seeds silently: if the page
      // loaded with an entry already parked, the sustained lift is a truth
      // of that state, not a moment we're transitioning into. Subsequent
      // changes animate — entering a notch (or re-notching onto a different
      // entry) pulses; leaving all notches releases.
      if (notchedIdx !== prevNotchedIdx) {
        if (prevNotchedIdx === null) {
          if (notchedIdx !== -1) root.style.setProperty("--lamp-intensity", "0.3");
        } else if (notchedIdx === -1) {
          scheduleRelease();
        } else {
          acknowledge();
        }
        prevNotchedIdx = notchedIdx;
      }

      // Second pass — apply opacity (circOut falloff) and toggle is-notched.
      // circOut matches iOS pickers: sharp drop near the notch, gentle tail.
      for (let i = 0; i < targets.length; i++) {
        const el = targets[i];
        const t = Math.min(1, dists[i] / maxDist);
        const eased = circOut(t);
        el.style.opacity = (1 - eased * (1 - MIN_OPACITY)).toFixed(3);
        el.classList.toggle("is-notched", i === notchedIdx);
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
        clearTimeout(releaseTimer);
        releaseTimer = 0;
        lampAnim?.stop();
        root.style.setProperty("--lamp-intensity", "0");
        prevNotchedIdx = null;
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
  const FADE_IN_MS = 180;
  const FADE_OUT_MS = 320;
  const IDLE_MS = 220;           // ms of scroll silence before fading out

  // Target alpha comes from CSS (--ruler-alpha), which is theme-tuned.
  // Read at animate-time so a theme swap is reflected on the next fade.
  function rulerTargetAlpha() {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue("--ruler-alpha")
      .trim();
    const parsed = parseFloat(raw);
    return isFinite(parsed) ? parsed : 0.08;
  }

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
        { opacity: rulerTargetAlpha() },
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
