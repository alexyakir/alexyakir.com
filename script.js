import { animate, circOut, easeOut } from "https://cdn.jsdelivr.net/npm/motion@latest/+esm";

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

// Boot slide: fade + slide from below driven by a motion.dev tween. Circular
// ease-out decelerates along a quarter-arc — mechanical feel, no overshoot,
// long soft landing. type:"tween" is explicit because motion.dev defaults
// transform props (y) to a mild-bounce spring and silently ignores `ease`.
// CSS parks the start pose; motion.dev owns the glide.
if (!reduced && root.getAttribute("data-boot") === "scroll") {
  const cvBody = document.querySelector(".cv-body");
  if (cvBody) {
    let cleaned = false;

    const startY = window.innerHeight * 0.22;

    // Park scroll at the first section's dial-in target before the glide runs.
    // Otherwise, once boot ends and scroll-snap re-engages, the browser smooth-
    // scroll-snaps the page by ~48px — reads as a second motion after the glide.
    const firstTarget = document.querySelector(".cv-intro");
    if (firstTarget) {
      const padTop = parseFloat(getComputedStyle(root).scrollPaddingTop) || 0;
      const layoutTop = firstTarget.getBoundingClientRect().top + window.scrollY - startY;
      const scrollTarget = Math.max(0, layoutTop - padTop);
      if (scrollTarget !== window.scrollY) window.scrollTo(0, scrollTarget);
    }

    const bootAnim = animate(
      cvBody,
      { opacity: [0, 1], y: [startY, 0] },
      { type: "tween", duration: 1.1, ease: circOut }
    );

    function finishBoot() {
      if (cleaned) return;
      cleaned = true;
      root.removeAttribute("data-boot");
      bootAnim.stop();
      cvBody.style.opacity = "";
      cvBody.style.transform = "";
      cvBody.style.willChange = "";
      window.removeEventListener("wheel", finishBoot);
      window.removeEventListener("touchstart", finishBoot);
      window.removeEventListener("keydown", finishBoot);
      initLamp();
    }

    bootAnim.finished.then(finishBoot).catch(() => {});
    setTimeout(finishBoot, 2000);
    window.addEventListener("wheel",      finishBoot, { passive: true });
    window.addEventListener("touchstart", finishBoot, { passive: true });
    window.addEventListener("keydown",    finishBoot);
  } else {
    initLamp();
  }
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
      fadeIn();
      clearTimeout(idleTimer);
      idleTimer = setTimeout(fadeOut, IDLE_MS);
    }, { passive: true });
  }
}
