import { animate, circOut, easeOut, stagger } from "https://cdn.jsdelivr.net/npm/motion@12/+esm";

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const canHoverFine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
const root = document.documentElement;

if (new URLSearchParams(location.search).get("optical") === "css") root.dataset.opticalDriver = "css";

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
    const alphaPx = parseFloat(getComputedStyle(root).getPropertyValue("--ruler-alpha"));
    cachedRulerAlpha = Number.isFinite(alphaPx) ? alphaPx : (next === "dark" ? 0.14 : 0.08);
    syncEntryVideos();
  });
}

// Years of experience — counted inclusively from the first year of practice
// (2013 → 14 in 2026), so the intro never goes stale. The number in the markup
// is the no-JS fallback; this overwrites it from the visitor's clock at runtime.
const yearsSince = (start) => new Date().getFullYear() - start + 1;
for (const el of document.querySelectorAll("[data-years-since]")) {
  el.textContent = String(yearsSince(Number(el.dataset.yearsSince)));
}

// ── Unified Zero-Thrash Geometry Cache ────────────────────────────────────
// All DOM geometry (dialY, line-height, lamp coords, and each entry's
// document-relative top and height) is measured ONLY inside measureLayout()
// on ResizeObserver / fonts.ready / load. The 120Hz scroll rAF loop performs
// zero DOM layout reads.
const targets = [...document.querySelectorAll(".cv-intro, .cv-entry")];
const lampEl = document.querySelector(".theme-toggle__lamp");
const detentEl = document.querySelector(".dial-ruler__detent");

let cachedDialY = 200;
let cachedTickY = 180;
let cachedLhPx = 27;
let cachedRulerAlpha = 0.08;
let lampCx = 0;
let lampCy = 0;

const entryCache = targets.map((el) => ({
  el,
  docTop: 0,
  titleDocTop: 0,
  height: 0,
  prevSigned: null,
  prevBright: -1,
  prevAngle: -999,
}));

function measureLayout() {
  const scrollY = window.scrollY;
  const rootStyle = getComputedStyle(root);
  const dialPx = targets[0] ? parseFloat(getComputedStyle(targets[0]).scrollMarginTop) : NaN;
  cachedDialY = Number.isFinite(dialPx) && dialPx > 0 ? dialPx : window.innerHeight * 0.42;
  const alphaPx = parseFloat(rootStyle.getPropertyValue("--ruler-alpha"));
  cachedRulerAlpha = Number.isFinite(alphaPx) ? alphaPx : 0.08;

  if (targets[0]) {
    cachedLhPx = parseFloat(getComputedStyle(targets[0]).lineHeight) || 27;
  }

  if (lampEl) {
    const lr = lampEl.getBoundingClientRect();
    lampCx = lr.left + lr.width * 0.5;
    lampCy = lr.top + lr.height * 0.5;
    cachedTickY = lampCy;
  } else {
    cachedTickY = cachedDialY - cachedLhPx + 10;
  }

  const isBooting = root.getAttribute("data-boot") === "scroll";
  const bootOffset = isBooting ? 16 : 0;

  for (let i = 0; i < entryCache.length; i++) {
    const item = entryCache[i];
    const r = item.el.getBoundingClientRect();
    item.docTop = r.top + scrollY - bootOffset;
    item.titleDocTop = item.docTop;
    item.height = r.height;
  }
}

measureLayout();
document.fonts?.ready?.then(() => {
  measureLayout();
  window.dispatchEvent(new CustomEvent("cv:layout"));
});

// Module-level hover state. The ruler-hover module owns updates; the lamp's
// updateFalloff reads it to add a tiny --bright floor on the hovered entry
// (a hint of warmth on hover, never enough to compete with the dialed entry).
const hovered = new WeakSet();
const HOVER_BRIGHT_FLOOR = 0.18;

function currentIndex() {
  const y = cachedDialY;
  const scrollY = window.scrollY;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < entryCache.length; i++) {
    const d = Math.abs(entryCache[i].titleDocTop - scrollY - y);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

// Programmatic-scroll flag. Set true before any scrollTo we initiate
// (arrow-key, click-to-dial, idle-snap) so the idle-snap watcher doesn't
// re-trigger on the scrollend that fires when our own smooth-scroll
// finishes. Cleared on the next scrollend after we set it.
let programmaticScroll = false;

function scrollToIndex(i) {
  if (!entryCache.length) return;
  const clamped = Math.max(0, Math.min(entryCache.length - 1, i));
  const item = entryCache[clamped];
  if (!item) return;
  const top = Math.max(0, item.titleDocTop - cachedDialY);
  programmaticScroll = true;
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
  scrollToIndex(currentIndex() + step);
});

function initLamp() {
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
  const BRIGHT_RANGE_LH = 3;

  let prevDialedIdx = null;
  let ackedIdx = -1;
  let userEngaged = false;

  // Sub-pixel docking error (fractional dial-y, rounded scroll offsets) counts
  // as fully dialed so a docked entry always lands at exactly --bright: 1.
  function brightFromDistance(d, range) {
    if (d < 1) return 1;
    if (d >= range) return 0;
    const t = 1 - d / range;
    return t * t;
  }

  let lampIntensity = 0;
  let scrollBloom = 0;
  let cursorBloom = 0;
  let velEMA = 0;
  let lastScrollY = window.scrollY;
  let lastScrollT = performance.now();
  let scrollIdleTimer = 0;

  const canVibrate = "vibrate" in navigator;
  let detentAnim = null;

  function detentPulse() {
    if (!detentEl || reduced) return;
    detentAnim?.stop?.();
    detentAnim = animate(
      detentEl,
      { opacity: [null, 1, 0] },
      { duration: 0.6, times: [0, 0.12, 1], ease: [circOut, easeOut] }
    );
  }

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
    const scrollY = window.scrollY;
    const dial = cachedDialY;
    const lampY = cachedTickY;
    const brightRange = cachedLhPx * BRIGHT_RANGE_LH;

    let closestIdx = -1;
    let closestDist = Infinity;
    let zeroCrossedIdx = -1;

    for (let i = 0; i < entryCache.length; i++) {
      const item = entryCache[i];
      const signed = (item.titleDocTop - scrollY) - dial;
      const d = Math.abs(signed);

      // Zero-crossing detection across the focal horizon (--dial-y) for
      // stepped mouse-wheel parity on Windows/Linux and deliberate trackpad pass.
      if (item.prevSigned !== null && item.prevSigned !== signed) {
        if ((item.prevSigned > 0 && signed <= 0) || (item.prevSigned < 0 && signed >= 0)) {
          zeroCrossedIdx = i;
        }
      }
      item.prevSigned = signed;

      if (d < closestDist) {
        closestDist = d;
        closestIdx = i;
      }
    }

    const dialedIdx = (closestDist <= DIAL_THRESHOLD && velEMA < DIAL_VELOCITY_MAX)
      ? closestIdx
      : (zeroCrossedIdx !== -1 && velEMA < DIAL_VELOCITY_MAX ? zeroCrossedIdx : -1);

    if (dialedIdx !== prevDialedIdx) {
      if (prevDialedIdx !== null && dialedIdx !== -1) {
        detent();
        detentPulse();
        ackedIdx = dialedIdx;
      }
      prevDialedIdx = dialedIdx;
    }

    // Also acknowledge when motion settles at rest (boot or after fast flick snap).
    if (dialedIdx !== ackedIdx) {
      if (dialedIdx === -1) ackedIdx = -1;
      else if (velEMA === 0) {
        detentPulse();
        ackedIdx = dialedIdx;
      }
    }

    const cssOpticalDriver =
      root.dataset.opticalDriver === "css" &&
      typeof CSS !== "undefined" &&
      CSS.supports("animation-timeline: view()");

    for (let i = 0; i < entryCache.length; i++) {
      const item = entryCache[i];
      const el = item.el;
      const d = Math.abs((item.titleDocTop - scrollY) - dial);

      const isAcked = i === ackedIdx;
      el.classList.toggle("is-acked", isAcked);
      if (isAcked) el.classList.remove("is-lit-hold");

      if (cssOpticalDriver) {
        if (item.prevBright !== -1) {
          item.prevBright = -1;
          item.prevAngle = -999;
          el.style.removeProperty("--bright");
          el.style.removeProperty("--lit-angle");
        }
        continue;
      }

      const proximity = brightFromDistance(d, brightRange);
      const pinned = el.classList.contains("is-lit-hold");
      const hoverFloor = hovered.has(el) ? HOVER_BRIGHT_FLOOR : 0;
      // Top-of-Page Clamp: when window.scrollY <= 0 (including iOS top
      // rubber-band overscroll), clamp the first entry (#about) at --bright: 1.
      const topClamp = (i === 0 && scrollY <= 0) ? 1 : 0;
      const bright = pinned ? 1 : Math.max(proximity, hoverFloor, topClamp);

      if (Math.abs(bright - item.prevBright) > 0.002) {
        item.prevBright = bright;
        el.style.setProperty("--bright", bright.toFixed(3));
      }

      const centreY = (item.docTop - scrollY) + item.height * 0.5;
      const lampRel = Math.max(-1, Math.min(1, (centreY - lampY) / 350));
      const angle = 90 + lampRel * 45;
      if (Math.abs(angle - item.prevAngle) > 0.2) {
        item.prevAngle = angle;
        el.style.setProperty("--lit-angle", `${angle.toFixed(1)}deg`);
      }
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

  // Idle-snap: every rest position has an entry on the dial. A stepped mouse
  // wheel fires scrollend after each notch, so snapping straight to the
  // nearest entry dragged the reader back to the one they were leaving and the
  // page could not be wheeled past the intro. Instead, wait for the input to go
  // quiet, and when the nearest entry is still the one the gesture started on
  // but the reader moved past SNAP_INTENT_PX, step to its neighbour in the
  // direction they scrolled.
  const SCROLLEND_FALLBACK_MS = 160;
  const SNAP_IDLE_MS = 140;
  const SNAP_INTENT_PX = 12;
  let scrollEndTimer = 0;
  let snapTimer = 0;
  let restIdx = currentIndex();
  let restScrollY = window.scrollY;

  function markRest() {
    restIdx = currentIndex();
    restScrollY = window.scrollY;
  }

  function snapToNearest() {
    snapTimer = 0;
    if (!entryCache.length) return;
    const scrollY = window.scrollY;
    const moved = scrollY - restScrollY;
    let idx = currentIndex();
    if (idx === restIdx && Math.abs(moved) >= SNAP_INTENT_PX) {
      idx = Math.max(0, Math.min(entryCache.length - 1, restIdx + Math.sign(moved)));
    }
    const top = Math.max(0, entryCache[idx].titleDocTop - cachedDialY);
    restIdx = idx;
    restScrollY = top;
    if (Math.abs(top - scrollY) < 1) return;
    programmaticScroll = true;
    window.scrollTo({ top, behavior: "smooth" });
  }

  function armSnap(delay) {
    clearTimeout(snapTimer);
    snapTimer = setTimeout(snapToNearest, delay);
  }

  function onScrollEnd() {
    if (programmaticScroll) {
      programmaticScroll = false;
      markRest();
      return;
    }
    armSnap(SNAP_IDLE_MS);
  }

  // Wheel or touch is the reader taking over an in-flight smooth scroll.
  // Wheel also re-arms the snap with a longer delay: at the end of the page
  // the wheel no longer scrolls, so no scrollend would ever arrive to settle
  // an overshoot. While a finger is down nothing snaps.
  window.addEventListener("wheel", () => {
    programmaticScroll = false;
    armSnap(SNAP_IDLE_MS + 120);
  }, { passive: true });
  window.addEventListener("touchstart", () => {
    programmaticScroll = false;
    clearTimeout(snapTimer);
  }, { passive: true });
  window.addEventListener("touchend", () => armSnap(SNAP_IDLE_MS + 120), { passive: true });

  const hasScrollEnd = "onscrollend" in window;
  if (hasScrollEnd) {
    window.addEventListener("scrollend", onScrollEnd, { passive: true });
  }

  window.addEventListener("scroll", () => {
    if (!programmaticScroll) {
      userEngaged = true;
      clearTimeout(snapTimer);
    }
    sampleScrollVelocity();
    schedule();
    if (!hasScrollEnd) {
      clearTimeout(scrollEndTimer);
      scrollEndTimer = setTimeout(onScrollEnd, SCROLLEND_FALLBACK_MS);
    }
  }, { passive: true });

  window.addEventListener("resize", () => {
    measureLayout();
    schedule();
  });

  window.visualViewport?.addEventListener("resize", () => {
    measureLayout();
    schedule();
  });

  if (canHoverFine) {
    window.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      updateCursorBloom(e.clientX, e.clientY);
      schedule();
    }, { passive: true });
    document.documentElement.addEventListener("mouseleave", () => {
      cursorBloom = 0;
      schedule();
    });
  }

  window.addEventListener("cv:hoverchange", schedule);
  window.addEventListener("cv:layout", schedule);

  updateFalloff();

  function dockNearest() {
    measureLayout();
    if (!entryCache.length) return;
    const scrollY = window.scrollY;
    const dial = cachedDialY;
    let bestSigned = 0;
    let bestDist = Infinity;
    for (let i = 0; i < entryCache.length; i++) {
      const signed = (entryCache[i].titleDocTop - scrollY) - dial;
      const d = Math.abs(signed);
      if (d < bestDist) {
        bestDist = d;
        bestSigned = signed;
      }
    }
    if (bestDist >= 1) {
      programmaticScroll = true;
      window.scrollTo({ top: Math.max(0, scrollY + bestSigned), left: 0, behavior: "instant" });
      requestAnimationFrame(() => { programmaticScroll = false; });
    }
    markRest();
    updateFalloff();
  }

  function ensureDialed() {
    if (userEngaged || window.scrollY > 2) {
      userEngaged = true;
      return;
    }
    dockNearest();
  }

  requestAnimationFrame(ensureDialed);
  if (document.readyState !== "complete") {
    window.addEventListener("load", ensureDialed, { once: true });
  }
  for (const m of document.querySelectorAll(".cv-entry video, .cv-entry img")) {
    if (m.tagName === "VIDEO") m.addEventListener("loadedmetadata", ensureDialed, { once: true });
    else if (!m.complete)     m.addEventListener("load",           ensureDialed, { once: true });
  }
  setTimeout(ensureDialed, 600);

  let reflowTimer = 0;
  function onReflow() {
    measureLayout();
    window.dispatchEvent(new CustomEvent("cv:layout"));
    schedule();
    clearTimeout(reflowTimer);
    reflowTimer = setTimeout(() => {
      if (velEMA !== 0 || programmaticScroll) return;
      dockNearest();
    }, 120);
  }
  if ("ResizeObserver" in window) {
    new ResizeObserver(onReflow).observe(document.body);
  }
}

// iOS Safari ignores muted autoplay until the video is actually on screen, and
// Low Power Mode ignores it until a tap. Several 60fps loops started together
// also get dropped. Posters cover the wait. Only the on-screen cut for the
// active theme is asked to play; the other theme cut stays mounted (so a
// switch can resume it) but paused.
const entryVideos = [...document.querySelectorAll(".cv-entry__video")];
const videosInView = new Set();

function videoMatchesTheme(v) {
  const theme = root.dataset.theme === "light" ? "light" : "dark";
  if (v.classList.contains("cv-entry__video--dark")) return theme === "dark";
  if (v.classList.contains("cv-entry__video--light")) return theme === "light";
  return true;
}

function playEntryVideo(v) {
  v.muted = true;
  v.playsInline = true;
  v.setAttribute("playsinline", "");
  v.setAttribute("webkit-playsinline", "");
  if (v.preload !== "auto") v.preload = "auto";
  const pending = v.play();
  if (pending) pending.catch(() => {});
}

function syncEntryVideos() {
  if (root.getAttribute("data-boot") === "scroll") return;
  for (const v of entryVideos) {
    const shouldPlay = videoMatchesTheme(v) && videosInView.has(v);
    if (shouldPlay) {
      if (v.paused || v.ended) playEntryVideo(v);
    } else if (!v.paused) {
      v.pause();
    }
  }
}

if (entryVideos.length && "IntersectionObserver" in window) {
  const videoWatch = new IntersectionObserver((observed) => {
    for (const entry of observed) {
      if (entry.isIntersecting) videosInView.add(entry.target);
      else videosInView.delete(entry.target);
    }
    syncEntryVideos();
  }, { rootMargin: "12% 0px", threshold: 0.05 });
  for (const v of entryVideos) videoWatch.observe(v);
} else {
  for (const v of entryVideos) videosInView.add(v);
}

window.addEventListener("pointerup", syncEntryVideos, { passive: true });
window.addEventListener("touchend", syncEntryVideos, { passive: true });
window.addEventListener("pageshow", syncEntryVideos);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") syncEntryVideos();
});

// Boot sequence
if (!reduced && root.getAttribute("data-boot") === "scroll") {
  let cleaned = false;

  const firstItem = entryCache[0];
  if (firstItem) {
    const scrollTarget = Math.max(0, firstItem.titleDocTop - cachedDialY);
    if (scrollTarget !== window.scrollY) window.scrollTo(0, scrollTarget);
    firstItem.el.classList.add("is-acked");
  }

  const idLines = [...document.querySelectorAll(".cv-id__line")]
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

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

    [".dial-ruler",
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
      ".theme-toggle__lamp, .cv-id__line, .cv-intro, .cv-entry, .dial-ruler__track, .dial-ruler"
    ).forEach((n) => {
      n.style.opacity = "";
      n.style.transform = "";
      n.style.filter = "";
      n.style.clipPath = "";
      n.style.willChange = "";
    });
    window.removeEventListener("wheel", finishBoot);
    window.removeEventListener("touchstart", finishBoot);
    window.removeEventListener("keydown", finishBoot);
    measureLayout();
    initLamp();
    syncEntryVideos();
  }

  bootAnim.finished.then(finishBoot).catch(() => {});
  setTimeout(finishBoot, 2500);
  window.addEventListener("wheel",      finishBoot, { passive: true });
  window.addEventListener("touchstart", finishBoot, { passive: true });
  window.addEventListener("keydown",    finishBoot);
} else {
  root.removeAttribute("data-boot");
  measureLayout();
  initLamp();
  syncEntryVideos();
}

// Hover warmth — a mouse resting on an undialed entry lifts it to
// HOVER_BRIGHT_FLOOR. No outline or frame: the text itself warms.
function initHoverWarmth() {
  if (!canHoverFine) return;
  let hoveredIdx = -1;

  function setHovered(idx) {
    if (idx === hoveredIdx) return;
    if (hoveredIdx !== -1) hovered.delete(entryCache[hoveredIdx].el);
    hoveredIdx = idx;
    if (idx !== -1) hovered.add(entryCache[idx].el);
    window.dispatchEvent(new CustomEvent("cv:hoverchange"));
  }

  entryCache.forEach((item, idx) => {
    item.el.addEventListener("pointerenter", (e) => {
      if (e.pointerType !== "mouse") return;
      setHovered(idx);
    });
    item.el.addEventListener("pointerleave", (e) => {
      if (e.pointerType !== "mouse") return;
      if (e.relatedTarget?.closest?.(".cv-intro, .cv-entry")) return;
      setHovered(-1);
    });
  });

  window.addEventListener("scroll", () => {
    if (hoveredIdx !== -1) setHovered(-1);
  }, { passive: true });
}

initHoverWarmth();

// Click-to-dial
{
  const HOLD_TIMEOUT_MS = 1500;
  let holdTimer = 0;

  entryCache.forEach((item, i) => {
    item.el.addEventListener("click", (e) => {
      if (e.target.closest("a")) return;
      if (item.el.classList.contains("is-acked")) return;

      clearTimeout(holdTimer);
      entryCache.forEach((x) => x.el.classList.remove("is-lit-hold"));
      item.el.classList.add("is-lit-hold");
      scrollToIndex(i);
      holdTimer = setTimeout(
        () => item.el.classList.remove("is-lit-hold"),
        HOLD_TIMEOUT_MS
      );
    });
  });
}

if (!reduced) {
  const track = document.querySelector(".dial-ruler__track");
  const FADE_IN_MS = 220;
  const FADE_OUT_MS = 180;
  const IDLE_MS = 220;

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
        { opacity: cachedRulerAlpha },
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
      if (root.hasAttribute("data-boot")) return;
      fadeIn();
      clearTimeout(idleTimer);
      idleTimer = setTimeout(fadeOut, IDLE_MS);
    }, { passive: true });
  }
}
