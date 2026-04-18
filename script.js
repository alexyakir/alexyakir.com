import { animate, circOut, easeOut, stagger } from "https://cdn.jsdelivr.net/npm/motion@latest/+esm";

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const root = document.documentElement;

if ("scrollRestoration" in history) history.scrollRestoration = "manual";

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

function dialY() {
  return window.innerHeight * 0.42;
}

function getTargets() {
  return [...document.querySelectorAll(".cv-intro, .cv-entry")];
}

// Targets carry padding-top: var(--lamp-gap) so the divider sits above
// the title. Dial math aligns on the title y, so we offset rect.top
// by the element's padding-top (25 on desktop, 0 on mobile).
let titleOffset = 0;
function measureTitleOffset() {
  const el = document.querySelector(".cv-entry");
  if (!el) { titleOffset = 0; return; }
  const cs = getComputedStyle(el);
  titleOffset = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0);
}
measureTitleOffset();
window.addEventListener("resize", measureTitleOffset);

function titleTop(el) {
  return el.getBoundingClientRect().top + titleOffset;
}

function currentIndex(targets) {
  const y = dialY();
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < targets.length; i++) {
    const d = Math.abs(titleTop(targets[i]) - y);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

function scrollToIndex(targets, i) {
  const clamped = Math.max(0, Math.min(targets.length - 1, i));
  const el = targets[clamped];
  if (!el) return;
  const top = window.scrollY + titleTop(el) - dialY();
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

function initLamp() {
  const MIN_OPACITY = 0.3;
  const MAX_DIST_RATIO = 0.35;
  let raf = 0;

  const DIAL_THRESHOLD = 20;
  const DIAL_VELOCITY_MAX = 0.4;

  const BLOOM_PEAK = 0.7;
  const CURSOR_PEAK = 0.22;
  const CURSOR_RADIUS = 400;
  const V_PEAK = 2.5;
  const LERP_UP = 0.22;
  const LERP_DOWN = 0.10;
  const IDLE_MS = 140;
  const DETENT_DAMPING = 0.05;
  const VEL_SMOOTHING = 0.55;

  let prevDialedIdx = null;
  let lampIntensity = 0;
  let scrollBloom = 0;
  let cursorBloom = 0;
  let velEMA = 0;
  let lastScrollY = window.scrollY;
  let lastScrollT = performance.now();
  let scrollIdleTimer = 0;
  let lampCx = 0, lampCy = 0;

  const canVibrate = "vibrate" in navigator;

  const lampEl = document.querySelector(".theme-toggle__lamp");
  const detentEl = document.querySelector(".dial-ruler__detent");
  let detentAnim = null;

  function detentPulse() {
    if (!detentEl || reduced) return;
    detentAnim?.stop?.();

    // Reach rightward from the ruler to the first entry's left edge — the tick
    // stretches out to greet the dialed-in section and pulls back. Measured
    // live so desktop (37px gap) and mobile (9px gap) both land on the edge.
    const ruler = detentEl.parentElement;
    const entry = document.querySelector(".cv-entry");
    let reach = 1;
    if (ruler && entry) {
      const r = ruler.getBoundingClientRect();
      const e = entry.getBoundingClientRect();
      if (r.width > 0) reach = Math.max(1, (e.left - r.left) / r.width);
    }

    detentAnim = animate(
      detentEl,
      {
        scaleX: [null, reach, 1],
        opacity: [null, 1, 0],
      },
      { duration: 0.5, times: [0, 0.26, 1], ease: [circOut, easeOut] }
    );
  }

  function measureLamp() {
    if (!lampEl) return;
    const r = lampEl.getBoundingClientRect();
    lampCx = r.left + r.width / 2;
    lampCy = r.top + r.height / 2;
  }
  measureLamp();

  function sampleScrollVelocity() {
    const now = performance.now();
    const y = window.scrollY;
    const dy = Math.abs(y - lastScrollY);
    const dt = Math.max(1, now - lastScrollT);
    velEMA = velEMA * VEL_SMOOTHING + (dy / dt) * (1 - VEL_SMOOTHING);
    lastScrollY = y;
    lastScrollT = now;
    scrollBloom = BLOOM_PEAK * circOut(Math.min(1, velEMA / V_PEAK));

    clearTimeout(scrollIdleTimer);
    scrollIdleTimer = setTimeout(() => {
      scrollIdleTimer = 0;
      velEMA = 0;
      scrollBloom = 0;
      schedule();
    }, IDLE_MS);
  }

  function detent() {
    if (canVibrate) navigator.vibrate(3);
    velEMA *= DETENT_DAMPING;
    scrollBloom = 0;
  }

  function updateCursorBloom(clientX, clientY) {
    if (!lampEl) { cursorBloom = 0; return; }
    const dx = clientX - lampCx;
    const dy = clientY - lampCy;
    const dist = Math.hypot(dx, dy);
    const t = Math.max(0, 1 - dist / CURSOR_RADIUS);
    cursorBloom = CURSOR_PEAK * t * t;
  }

  function updateFalloff() {
    raf = 0;
    const dial = dialY();
    const maxDist = window.innerHeight * MAX_DIST_RATIO;
    const targets = getTargets();

    const dists = new Array(targets.length);
    let closestIdx = -1;
    let closestDist = Infinity;
    for (let i = 0; i < targets.length; i++) {
      const d = Math.abs(titleTop(targets[i]) - dial);
      dists[i] = d;
      if (d < closestDist) { closestDist = d; closestIdx = i; }
    }
    const dialedIdx = (closestDist <= DIAL_THRESHOLD && velEMA < DIAL_VELOCITY_MAX) ? closestIdx : -1;

    if (dialedIdx !== prevDialedIdx) {
      if (prevDialedIdx !== null && dialedIdx !== -1) detent();
      if (dialedIdx !== -1) detentPulse();
      prevDialedIdx = dialedIdx;
    }

    for (let i = 0; i < targets.length; i++) {
      const el = targets[i];
      const t = Math.min(1, dists[i] / maxDist);
      const eased = circOut(t);
      el.style.opacity = (1 - eased * (1 - MIN_OPACITY)).toFixed(3);
      el.classList.toggle("is-dialed-in", i === dialedIdx);
    }

    const lampTarget = Math.max(scrollBloom, cursorBloom);

    const diff = lampTarget - lampIntensity;
    if (Math.abs(diff) > 0.002) {
      const rate = diff > 0 ? LERP_UP : LERP_DOWN;
      lampIntensity += diff * rate;
      root.style.setProperty("--lamp-intensity", lampIntensity.toFixed(3));
      schedule();
    } else if (lampIntensity !== lampTarget) {
      lampIntensity = lampTarget;
      root.style.setProperty("--lamp-intensity", lampIntensity.toFixed(3));
    }
  }

  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(updateFalloff);
  }

  window.addEventListener("scroll", () => {
    sampleScrollVelocity();
    schedule();
  }, { passive: true });
  window.addEventListener("resize", () => {
    measureLamp();
    schedule();
  });
  window.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    updateCursorBloom(e.clientX, e.clientY);
    schedule();
  }, { passive: true });
  document.documentElement.addEventListener("mouseleave", () => {
    cursorBloom = 0;
    schedule();
  });
  updateFalloff();
}

// Boot sequence: lamp lights first (narrative origin), then identity lines
// glide in from the left, then intro + entries rise from below in a stagger.
// Motion's timeline (at:) overlaps the regions so the whole thing reads as
// layered depth rather than a serial list. Shared expo-out curve
// ([0.16, 1, 0.3, 1]) unifies the feel across regions. type:"tween" is
// explicit because motion.dev defaults transform props (x/y) to a mild-bounce
// spring and silently ignores `ease`. CSS parks the start poses.
if (!reduced && root.getAttribute("data-boot") === "scroll") {
  let cleaned = false;

  // Park scroll so when boot ends and scroll-snap re-engages, the intro is
  // already aligned to the dial — no post-boot smooth-snap correction. Intro
  // is parked 16px below its rest line; subtract to recover layout top.
  const firstTarget = document.querySelector(".cv-intro");
  if (firstTarget) {
    const padTop = parseFloat(getComputedStyle(root).scrollPaddingTop) || 0;
    const layoutTop = firstTarget.getBoundingClientRect().top + window.scrollY - 16;
    const scrollTarget = Math.max(0, layoutTop - padTop);
    if (scrollTarget !== window.scrollY) window.scrollTo(0, scrollTarget);
  }

  // Sort identity lines by visual y so mobile's flex-order rearrangement
  // still staggers top-to-bottom rather than DOM order.
  const idLines = [...document.querySelectorAll(".cv-id__line")]
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

  // Pre-roll: the eye needs ~300–400ms after paint to land on the page, so
  // shift the whole timeline forward. Without this, the animation is already
  // 80% done by the time the user refocuses — they only catch the tail.
  const PRE = 0.4;
  const ease = [0.16, 1, 0.3, 1];
  const rulerAlpha = parseFloat(
    getComputedStyle(root).getPropertyValue("--ruler-alpha")
  ) || 0.08;

  const bootAnim = animate([
    [".theme-toggle__lamp",
      { opacity: [0, 1] },
      { type: "tween", duration: 0.18, at: PRE }],

    [idLines,
      { opacity: [0, 1], x: [-12, 0] },
      { type: "tween", duration: 0.5, delay: stagger(0.06), ease, at: "-0.06" }],

    [".cv-intro",
      { opacity: [0, 1], y: [16, 0], filter: ["blur(4px)", "blur(0px)"] },
      { type: "tween", duration: 0.7, ease, at: PRE + 0.28 }],

    [".cv-entry",
      { opacity: [0, 1], y: [16, 0] },
      { type: "tween", duration: 0.55, delay: stagger(0.05), ease, at: PRE + 0.32 }],

    // Ruler wipe: clip-path reveals top-to-bottom so the ticks read as a
    // scaffold being laid out in front of the eye, then the track fades back
    // to its rest opacity (0) — the scroll-fade system handles it from there.
    [".dial-ruler__track",
      { clipPath: ["inset(0% 0% 100% 0%)", "inset(0% 0% 0% 0%)"] },
      { type: "tween", duration: 0.9, ease, at: PRE }],

    [".dial-ruler__track",
      { opacity: [0, rulerAlpha, rulerAlpha, 0] },
      { type: "tween", duration: 1.4, times: [0, 0.2, 0.7, 1], ease, at: PRE }],
  ]);

  function finishBoot() {
    if (cleaned) return;
    cleaned = true;
    root.removeAttribute("data-boot");
    bootAnim.stop();
    document.querySelectorAll(
      ".theme-toggle__lamp, .cv-id__line, .cv-intro, .cv-entry, .dial-ruler__track"
    ).forEach(n => {
      n.style.opacity = "";
      n.style.transform = "";
      n.style.filter = "";
      n.style.clipPath = "";
      n.style.willChange = "";
    });
    window.removeEventListener("wheel", finishBoot);
    window.removeEventListener("touchstart", finishBoot);
    window.removeEventListener("keydown", finishBoot);
    initLamp();
  }

  bootAnim.finished.then(finishBoot).catch(() => {});
  setTimeout(finishBoot, 2500);
  window.addEventListener("wheel",      finishBoot, { passive: true });
  window.addEventListener("touchstart", finishBoot, { passive: true });
  window.addEventListener("keydown",    finishBoot);
} else {
  root.removeAttribute("data-boot");
  initLamp();
}

if (!reduced) {
  const track = document.querySelector(".dial-ruler__track");
  const FADE_IN_MS = 180;
  const FADE_OUT_MS = 320;
  const IDLE_MS = 220;

  function rulerTargetAlpha() {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue("--ruler-alpha")
      .trim();
    const parsed = parseFloat(raw);
    return isFinite(parsed) ? parsed : 0.08;
  }

  if (track) {
    let current = null;
    let idleTimer = 0;
    let shown = false;

    function fadeIn() {
      if (shown) return;
      shown = true;
      current?.stop();
      current = animate(
        track,
        { opacity: rulerTargetAlpha() },
        { duration: FADE_IN_MS / 1000, ease: circOut }
      );
    }

    function fadeOut() {
      if (!shown) return;
      shown = false;
      current?.stop();
      current = animate(
        track,
        { opacity: 0 },
        { duration: FADE_OUT_MS / 1000, ease: easeOut }
      );
    }

    window.addEventListener("scroll", () => {
      // During boot, the reveal animation owns the track — don't let the
      // scroll-parking fire fadeIn/fadeOut and race with it.
      if (root.hasAttribute("data-boot")) return;
      fadeIn();
      clearTimeout(idleTimer);
      idleTimer = setTimeout(fadeOut, IDLE_MS);
    }, { passive: true });
  }
}
