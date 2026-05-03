import { animate, circOut, easeOut, stagger } from "https://cdn.jsdelivr.net/npm/motion@12/+esm";

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

// Module-level hover state. The ruler-hover module owns updates; the lamp's
// updateFalloff reads it to add a tiny --bright floor on the hovered entry
// (a hint of warmth on hover, never enough to compete with the dialed entry).
const hovered = new WeakSet();
const HOVER_BRIGHT_FLOOR = 0.18;

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

// Programmatic-scroll flag. Set true before any scrollTo we initiate
// (arrow-key, click-to-dial, idle-snap) so the idle-snap watcher doesn't
// re-trigger on the scrollend that fires when our own smooth-scroll
// finishes. Cleared on the next scrollend after we set it.
let programmaticScroll = false;

function scrollToIndex(targets, i) {
  const clamped = Math.max(0, Math.min(targets.length - 1, i));
  const el = targets[clamped];
  if (!el) return;
  const top = window.scrollY + titleTop(el) - dialY();
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
  const targets = getTargets();
  scrollToIndex(targets, currentIndex(targets) + step);
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

  let prevDialedIdx = null;
  let ackedIdx = -1;

  // Proximity-driven --bright. Each frame, every entry's brightness is a
  // continuous function of how close its title is to the dial line. The
  // dial reads as a magnetic detent: entries fade in approaching it and
  // fade out leaving it, so scroll itself drives the dim→lit transition
  // (interruptible, reactive, no animation to fight). BRIGHT_RANGE_LH sets
  // how wide the lit zone is around the dial; the ^2 falloff keeps the
  // edges soft while pinning full bright across the dial center.
  // Click-to-dial (is-lit-hold) overrides to 1 as an explicit commit.
  // Hover does NOT light the text — the cv-pill behind the entry is the
  // hover affordance, so a hovered entry doesn't compete with the dialed
  // one for "lit" attention.
  const BRIGHT_RANGE_LH = 3;

  function brightFromDistance(d, range) {
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
  let lampCx = 0, lampCy = 0;

  const canVibrate = "vibrate" in navigator;

  const lampEl = document.querySelector(".theme-toggle__lamp");
  const detentEl = document.querySelector(".dial-ruler__detent");
  let detentAnim = null;

  function detentPulse() {
    if (!detentEl || reduced) return;
    detentAnim?.stop?.();

    // Acknowledging ignition: the entry has landed at the dial, so the tick
    // lights up in place to mark the alignment. No reach — this is a
    // response, not a gesture. Crisp ignite, slower fade reads as a filament
    // catching and cooling.
    detentAnim = animate(
      detentEl,
      { opacity: [null, 1, 0] },
      { duration: 0.6, times: [0, 0.12, 1], ease: [circOut, easeOut] }
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
      prevDialedIdx = dialedIdx;
    }

    // Acknowledge ignition fires once per settle. velEMA reaches 0 only at
    // boot or after the idle timer zeros it (IDLE_MS after the last scroll
    // event) — by then all motion including snap has finished, so the tick
    // lights up strictly after the entry has landed.
    if (dialedIdx !== ackedIdx) {
      if (dialedIdx === -1) ackedIdx = -1;
      else if (velEMA === 0) { detentPulse(); ackedIdx = dialedIdx; }
    }

    // Lamp sits at tick-y on screen; the identity column is on the left so
    // the light's horizontal origin is always at x=0. Per-entry --lit-angle
    // is a smooth function of the entry's signed vertical distance from the
    // lamp — below → 135° (top-left origin), level → 90° (left), above →
    // 45° (bottom-left). Saturated over ~350px so most of the visible stack
    // covers the full range.
    const lampY = dial - 25;
    const lhEl = targets[0];
    const lhPx = lhEl ? (parseFloat(getComputedStyle(lhEl).lineHeight) || 24) : 24;
    const brightRange = lhPx * BRIGHT_RANGE_LH;
    for (let i = 0; i < targets.length; i++) {
      const el = targets[i];
      // is-acked = the entry has settled at the dial and the detent tick has
      // fired. Drives the detent-pulse one-shot only; --bright is no longer
      // class-driven, so the class is purely a state marker for the
      // ackedIdx logic and any external CSS that might key off it.
      const wasAcked = el.classList.contains("is-acked");
      const isAcked = i === ackedIdx;
      if (wasAcked !== isAcked) el.classList.toggle("is-acked", isAcked);
      if (isAcked) el.classList.remove("is-lit-hold");

      // --bright = continuous proximity-to-dial value, overridden to 1 by
      // explicit commits (hover, click-to-dial). Smooth ^2 falloff over
      // BRIGHT_RANGE_LH gives a soft edge with full bright across the dial
      // center — the entry feels like it docks into a magnetic detent
      // rather than snapping a class on/off.
      const proximity = brightFromDistance(dists[i], brightRange);
      const pinned = el.classList.contains("is-lit-hold");
      const hoverFloor = hovered.has(el) ? HOVER_BRIGHT_FLOOR : 0;
      const bright = pinned ? 1 : Math.max(proximity, hoverFloor);
      el.style.setProperty("--bright", bright.toFixed(3));

      const r = el.getBoundingClientRect();
      const centreY = r.top + r.height / 2;
      const lampRel = Math.max(-1, Math.min(1, (centreY - lampY) / 350));
      el.style.setProperty("--lit-angle", `${(90 + lampRel * 45).toFixed(1)}deg`);
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

  // Idle-snap. Replaces CSS scroll-snap (was: scroll-snap-type: y proximity).
  // Free scroll during gesture; on scrollend, ALWAYS pull the closest entry's
  // title onto the dial. Guarantees an entry is dialed at every rest position
  // — there is no "limbo" state between entries. The dead-zone (< 1px) skips
  // a no-op scroll when we're already aligned.
  const SCROLLEND_FALLBACK_MS = 160;
  let scrollEndTimer = 0;

  function snapToNearest() {
    if (programmaticScroll) { programmaticScroll = false; return; }
    const targets = getTargets();
    if (!targets.length) return;
    const dial = dialY();
    let bestIdx = -1, bestDist = Infinity, bestSigned = 0;
    for (let i = 0; i < targets.length; i++) {
      const signed = titleTop(targets[i]) - dial;
      const d = Math.abs(signed);
      if (d < bestDist) { bestDist = d; bestIdx = i; bestSigned = signed; }
    }
    if (bestIdx === -1) return;
    if (bestDist < 1) return;
    programmaticScroll = true;
    window.scrollTo({ top: window.scrollY + bestSigned, behavior: "smooth" });
  }

  // Native scrollend (Safari 18+/Chromium) is preferred — fires once when the
  // scroll genuinely settles, including after momentum. Idle-timer fallback
  // only registers when the native event is missing, so we never double-fire.
  const hasScrollEnd = "onscrollend" in window;
  if (hasScrollEnd) {
    window.addEventListener("scrollend", snapToNearest, { passive: true });
  }

  window.addEventListener("scroll", () => {
    sampleScrollVelocity();
    schedule();
    if (!hasScrollEnd) {
      clearTimeout(scrollEndTimer);
      scrollEndTimer = setTimeout(snapToNearest, SCROLLEND_FALLBACK_MS);
    }
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
  // Hover floor on --bright — the ruler-hover module flips the hovered
  // WeakSet, then dispatches this event so the falloff loop re-evaluates.
  window.addEventListener("cv:hoverchange", schedule);

  updateFalloff();

  // Safety net for "stuck dim on initial load". updateFalloff measures
  // positions ONCE here; if the layout shifts afterward (videos resolving
  // to their natural aspect ratio, dvh updating as the mobile URL bar
  // settles, fonts metrics swapping in) the closest entry can drift off
  // the dial with no further events to re-evaluate, and stays stamped
  // at --bright: 0 — the "have to Cmd+Shift+R to fix" symptom. We can't
  // wait for arbitrary user input, so re-snap on the next frame and
  // again at window.load. Skip if a real user gesture has already moved
  // them — auto-snapping into a user's scroll feels like a fight.
  let userMoved = false;
  const markUserMoved = () => { userMoved = true; };
  window.addEventListener("wheel",      markUserMoved, { passive: true, once: true });
  window.addEventListener("touchstart", markUserMoved, { passive: true, once: true });
  window.addEventListener("keydown",    markUserMoved, { once: true });

  function realignAfterSettle() {
    if (userMoved) return;
    const targets = getTargets();
    if (!targets.length) return;
    const dial = dialY();
    let bestIdx = -1, bestDist = Infinity, bestSigned = 0;
    for (let i = 0; i < targets.length; i++) {
      const signed = titleTop(targets[i]) - dial;
      const d = Math.abs(signed);
      if (d < bestDist) { bestDist = d; bestIdx = i; bestSigned = signed; }
    }
    if (bestIdx === -1) return;
    if (bestDist >= 1) {
      programmaticScroll = true;
      // Instant, not smooth — this is a one-shot init correction, not a
      // user gesture. Smooth would draw the eye to a 300px slide in the
      // bug case where boot scroll-park missed the dial entirely. Instant
      // also means a follow-up realignAfterSettle (load, loadedmetadata)
      // sees the settled scroll position and short-circuits at dist < 1.
      window.scrollTo({ top: window.scrollY + bestSigned, left: 0, behavior: "instant" });
    }
    updateFalloff();
  }
  requestAnimationFrame(realignAfterSettle);
  if (document.readyState !== "complete") {
    window.addEventListener("load", realignAfterSettle, { once: true });
  }
  // Videos in entries below cv-intro reflow their containers when metadata
  // arrives — re-snap once each video reports loadedmetadata so a scroll
  // that ended on, say, easysizes doesn't drift away while we sit idle.
  document.querySelectorAll("video").forEach(v => {
    v.addEventListener("loadedmetadata", realignAfterSettle, { once: true });
  });
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
  // Use dialY() (innerHeight-derived) rather than getComputedStyle's
  // scroll-padding-top: in cold-load timing edge cases that variable can
  // resolve to "0px" before dvh is known, which would scroll cv-intro to
  // the top of the viewport instead of the dial — leaving updateFalloff
  // measuring a 300px+ distance and stamping --bright at 0, which is the
  // "stuck dim on initial load" symptom that needs Cmd+Shift+R to clear.
  const firstTarget = document.querySelector(".cv-intro");
  if (firstTarget) {
    const padTop = dialY();
    const layoutTop = firstTarget.getBoundingClientRect().top + window.scrollY - 16;
    const scrollTarget = Math.max(0, layoutTop - padTop);
    if (scrollTarget !== window.scrollY) window.scrollTo(0, scrollTarget);
  }

  // Mark the intro as dialed BEFORE the boot animation runs. Two reasons:
  //   1. CSS target for is-acked = opacity 1, matching what the boot
  //      animates the intro to. When inline clears at finishBoot, the
  //      computed value doesn't change → no snap.
  //   2. The other entries animate to opacity 0.22 (their CSS target,
  //      since they aren't acked). Same story — inline ends at 0.22, CSS
  //      says 0.22, no snap.
  // initLamp's first updateFalloff confirms or corrects this once boot is
  // done; any correction rides the normal 720ms transition smoothly.
  firstTarget?.classList.add("is-acked");

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

    // Lands at 0.22 — the dim CSS target for non-acked entries. Boot's
    // final inline matches the post-boot CSS, so finishBoot's clear is a
    // no-op visually (no second "snap" to a different dim value).
    [".cv-entry",
      { opacity: [0, 0.22], y: [16, 0] },
      { type: "tween", duration: 0.55, delay: stagger(0.05), ease, at: PRE + 0.32 }],

    // Ruler wipe: clip-path reveals top-to-bottom so the ticks read as a
    // scaffold being laid out in front of the eye, then the track fades back
    // to its rest opacity (0) — the scroll-fade system handles it from there.
    // Applied to .dial-ruler (100vh) not __track (10000px) so the animation's
    // percentage space matches the visible window. Detent is opacity:0 during
    // boot, so clip-path incidentally clipping it horizontally is harmless.
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

// Hover frame — two horizontal lines that grow from the ruler's left edge
// across the entry's content width, marking the hovered entry's vertical
// span (top + bottom). Hidden when hovered === dialed (the detent already
// locks the dialed entry). Lines live inside .dial-ruler so its sticky
// coordinate frame matches viewport y; ruler's overflow-x is visible so
// the lines extend rightward through the column gap and across the
// content. Width clings to the widest piece of CONTENT (text or video) in
// the entry, not its full column — measured per-hover via Range API +
// media bbox union.
function initRulerHover() {
  const ruler = document.querySelector(".dial-ruler");
  const hoverTop = document.querySelector(".dial-ruler__hover--top");
  const hoverBottom = document.querySelector(".dial-ruler__hover--bottom");
  if (!ruler || !hoverTop || !hoverBottom) return;
  const entries = [...document.querySelectorAll(".cv-intro, .cv-entry")];
  if (!entries.length) return;

  let hoveredIdx = -1;
  let dialedIdx = entries.findIndex(el => el.classList.contains("is-acked"));

  const HOVER_EASE = [0.32, 0.72, 0, 1];
  const HOVER_DURATION = 0.28;
  // motion.dev animations are interruptible: a new animate() call on the
  // same element cancels the previous and starts from the current value,
  // which is what motion-principles asks for here — switching hover
  // between entries doesn't snap, and a quick pull-out reverses smoothly.
  // We animate transform: scaleX (well-supported by WAAPI) instead of
  // width (Chrome freezes width transitions on these elements).
  const animScale = (el, sx) =>
    animate(el, { transform: `scaleX(${sx})` }, { duration: HOVER_DURATION, ease: HOVER_EASE });

  // Walk text nodes (line-rendered rects, ignoring the block container's
  // full-column rect) and union with media bboxes — same content-bound
  // measurement we used for the pill, just kept for the line's right edge.
  function measureContentBounds(el) {
    let minL = Infinity, maxR = -Infinity, minT = Infinity, maxB = -Infinity;

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (r.width === 0 || r.height === 0) continue;
        if (r.left   < minL) minL = r.left;
        if (r.right  > maxR) maxR = r.right;
        if (r.top    < minT) minT = r.top;
        if (r.bottom > maxB) maxB = r.bottom;
      }
    }
    for (const m of el.querySelectorAll("video, img")) {
      const r = m.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.left   < minL) minL = r.left;
      if (r.right  > maxR) maxR = r.right;
      if (r.top    < minT) minT = r.top;
      if (r.bottom > maxB) maxB = r.bottom;
    }
    if (!isFinite(minL)) return null;
    return { left: minL, right: maxR, top: minT, bottom: maxB };
  }

  function hide() {
    animScale(hoverTop, 0);
    animScale(hoverBottom, 0);
  }

  function update() {
    if (hoveredIdx === -1 || hoveredIdx === dialedIdx) {
      hide();
      return;
    }
    const el = entries[hoveredIdx];
    const bounds = measureContentBounds(el);
    if (!bounds) { hide(); return; }
    const rulerRect = ruler.getBoundingClientRect();
    // Ruler is sticky at top:0, so its inner coords map 1:1 to viewport y.
    // Width spans from ruler's left edge to the rightmost content edge.
    const lineWidth = bounds.right - rulerRect.left;
    // Set width inline immediately (no animation here — width transitions
    // are broken on these elements; scaleX handles the grow). Top y is
    // CSS-transitioned so switching hover between entries slides smoothly.
    hoverTop.style.width    = `${lineWidth}px`;
    hoverBottom.style.width = `${lineWidth}px`;
    hoverTop.style.top    = `${bounds.top}px`;
    hoverBottom.style.top = `${bounds.bottom}px`;
    animScale(hoverTop, 1);
    animScale(hoverBottom, 1);
  }

  function setHovered(idx) {
    if (idx === hoveredIdx) return;
    if (hoveredIdx !== -1) hovered.delete(entries[hoveredIdx]);
    hoveredIdx = idx;
    if (idx !== -1) hovered.add(entries[idx]);
    update();
    // Notify the lamp so its updateFalloff re-evaluates --bright with the
    // hover floor. Custom event keeps the scope clean.
    window.dispatchEvent(new CustomEvent("cv:hoverchange"));
  }

  // pointerenter on each entry rather than delegating: pointerover bubbles
  // and refires on every child crossing, which is noisier than we need.
  for (const el of entries) {
    el.addEventListener("pointerenter", (e) => {
      if (e.pointerType !== "mouse") return;
      setHovered(entries.indexOf(el));
    });
    el.addEventListener("pointerleave", (e) => {
      if (e.pointerType !== "mouse") return;
      // Only clear if leaving entirely — relatedTarget inside another
      // entry is handled by that entry's pointerenter.
      if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest(".cv-intro, .cv-entry")) return;
      setHovered(-1);
    });
  }

  // Scroll can slide an entry out from under a stationary cursor; clear
  // hover so the lines don't follow a phantom target.
  window.addEventListener("scroll", () => {
    if (hoveredIdx !== -1) setHovered(-1);
  }, { passive: true });

  // If the dialed entry changes (snap settled on a new one), re-evaluate —
  // a hovered entry that just became dialed should hide the hover frame.
  const obs = new MutationObserver(() => {
    const i = entries.findIndex(el => el.classList.contains("is-acked"));
    if (i !== dialedIdx) {
      dialedIdx = i;
      update();
    }
  });
  entries.forEach(el =>
    obs.observe(el, { attributes: true, attributeFilter: ["class"] })
  );

  window.addEventListener("resize", update);
}

initRulerHover();

// Click-to-dial. A click on a non-dialed entry commits to bringing it to
// the dial position. We add .is-lit-hold immediately so the entry stays
// fully bright and infused through the smooth scroll — this is the bridge
// between :hover ending (cursor leaves the entry as it moves) and
// .is-acked taking over (after the entry settles at the dial). Without
// the bridge, the user would see the entry retract and re-light, the
// "double infusion" we're trying to avoid.
//
// .is-lit-hold is cleared when .is-acked fires for the same entry (in
// updateFalloff), or after a 1500ms safety timeout if the user
// interrupts the scroll and is-acked never settles.
{
  const entries = getTargets();
  const HOLD_TIMEOUT_MS = 1500;
  let holdTimer = 0;

  entries.forEach((el, i) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("a")) return;
      if (el.classList.contains("is-acked")) return;

      clearTimeout(holdTimer);
      entries.forEach(x => x.classList.remove("is-lit-hold"));
      el.classList.add("is-lit-hold");
      scrollToIndex(entries, i);
      holdTimer = setTimeout(
        () => el.classList.remove("is-lit-hold"),
        HOLD_TIMEOUT_MS
      );
    });
  });
}

if (!reduced) {
  const track = document.querySelector(".dial-ruler__track");
  // Enter slightly slower than exit would invert the principle "exits ~20%
  // faster than entrances". Ruler is a scaffold acknowledging scroll — it
  // should appear with the gesture and recede a touch quicker.
  const FADE_IN_MS = 220;
  const FADE_OUT_MS = 180;
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
