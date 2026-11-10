/**
 * slidingLidBox.js — a box whose "lid" is a flat panel that slides
 * horizontally in a channel near the top of the box, held in only by
 * 2D through-cuts (no Z-axis routing, no engraved grooves). Everything here
 * is glued-up from flat, laser-cut layers of the SAME material thickness.
 *
 * ── Mechanism ──────────────────────────────────────────────────────────
 * Cross-section through a Left/Right side panel, from the base upward:
 *
 *   height ┤ ── top retainer rail (glued to inside face, flush with top,
 *          │     spans the back railLength of the depth, stops short of
 *          │     the front so the lid can be dropped in during assembly)
 *          │     └─ rail's underside sits `lidClearance` above the lid's
 *          │        top face, capping the channel without touching it
 *          │
 *          │   [ lid rides here, resting on the runner's top edge,
 *          │     sliding front <-> back ]
 *          │
 *  runnerH ┤ ── inner ledge runner (glued to inside face, from the base
 *          │     up to `runnerHeight = height - (thickness + lidClearance)`)
 *        0 ┴── base
 *
 * The FRONT panel's top edge is lowered by `frontLowerAmount` (default
 * `thickness + lidClearance`, i.e. just enough to clear the lid's own
 * thickness) so there is an open slot above the front through which the
 * lid is inserted top-down during assembly, then slid backward under the
 * rails into its running position. Left/Right/Back stay full height.
 *
 * Because Front is shorter than Left/Right, the Left/Right edge that mates
 * with Front only needs finger joints over the (shorter) front height —
 * the remaining strip above that, up to full height, is a plain
 * (unjointed) edge, appended as a synthetic full-material "tab" segment.
 *
 * All dimensions are external/outer, consistent with the rest of the app.
 * Reuses BoxGenerator.buildJointPair / flatEdge / makePanel so the finger
 * math and kerf compensation are identical to every other box type.
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const BoxGenerator = isNode ? require('./boxGenerator.js') : root.BoxGenerator;
  const PanelGeo = isNode ? require('./panel.js') : root.Panel;
  const Vec2 = isNode ? require('./vec2.js') : root.Vec2;

  const { buildJointPair, flatEdge, makePanel } = BoxGenerator;

  function slidingLidDefaults() {
    return {
      lidClearance: 0.2,        // mm — vertical slack so the lid slides freely under the rail
      horizontalClearance: 0.3, // mm — side-to-side slack between the lid and the outer sides
      frontLowerAmount: null,   // mm — null = auto (thickness + lidClearance)
      railWidth: null,          // mm — null = auto (== thickness)
      railSetbackFromFront: 24, // mm — how far the rail stops short of the front, for lid insertion
      thumbPull: { enabled: true, radius: 10 },
    };
  }

  /** Extend a finger-segment array with a plain full-material run up to `totalLength`. */
  function extendWithFlatCap(pairSide, totalLength, jointedLength) {
    const extra = totalLength - jointedLength;
    if (extra <= 1e-6) return pairSide;
    const segments = pairSide.segments.concat([{
      start: jointedLength, end: totalLength, width: extra, state: 'tab',
    }]);
    return Object.assign({}, pairSide, { segments });
  }

  function buildSlidingLid(rawParams) {
    const p = Object.assign({}, slidingLidDefaults(), rawParams);
    const warnings = [];
    const t = p.thickness, k = p.kerf, H = p.height;
    const Lc = p.length - 2 * t;

    const frontLowerAmount = p.frontLowerAmount != null ? p.frontLowerAmount : (t + p.lidClearance);
    const frontHeight = H - frontLowerAmount;

    if (Lc <= 0) warnings.push('Length is too small for the material thickness — Front/Back/Base would have zero or negative size.');
    if (frontHeight <= Math.max(t, 5)) warnings.push('Front panel height after lowering is too small to be structurally useful — increase box height or reduce frontLowerAmount.');
    const runnerHeight = H - (t + p.lidClearance);
    if (runnerHeight <= 0) warnings.push('Runner height is zero or negative — increase box height, or reduce thickness/lidClearance.');

    // ---- Joint families -----------------------------------------------
    const famA = buildJointPair(p.width, p, warnings, 'width-joints (Left/Right <-> Base)');
    const famBBack = buildJointPair(H, p, warnings, 'height-joints (Left/Right <-> Back)');
    const famBFront = buildJointPair(Math.max(frontHeight, 0.1), p, warnings, 'front-height-joints (Left/Right <-> Front)');
    const famC = buildJointPair(Math.max(Lc, 0.1), p, warnings, 'length-joints (Front/Back <-> Base)');

    const openTop = flatEdge(p.outlineCompensation, k);
    const leftFrontEdge = extendWithFlatCap(famBFront.a, H, frontHeight);
    const rightFrontEdge = extendWithFlatCap(famBFront.a, H, frontHeight);

    const left = makePanel('left', 'Left', p.width, H, {
      bottom: famA.a, top: openTop, left: leftFrontEdge, right: famBBack.a,
    });
    const right = makePanel('right', 'Right', p.width, H, {
      bottom: famA.a, top: openTop, left: rightFrontEdge, right: famBBack.a,
    });
    const back = makePanel('back', 'Back', Lc, H, {
      bottom: famC.a, top: openTop, left: famBBack.b, right: famBBack.b,
    });
    const front = makePanel('front', 'Front', Lc, Math.max(frontHeight, 0.1), {
      bottom: famC.a, top: openTop, left: famBFront.b, right: famBFront.b,
    });
    const base = makePanel('base', 'Base', Lc, p.width, {
      bottom: famC.b, top: famC.b, left: famA.b, right: famA.b,
    });

    const panels = [front, back, left, right, base];

    // ---- Inner ledge runners (glued, not finger-jointed: plain rectangles) ----
    const railWidth = p.railWidth != null ? p.railWidth : t;
    const runnerRect = (id, name) => makePanel(id, name, p.width, Math.max(runnerHeight, 0.1), {
      bottom: flatEdge('none', k), top: flatEdge('none', k), left: flatEdge('none', k), right: flatEdge('none', k),
    });
    const runnerLeft = runnerRect('runner-left', 'Inner Ledge Runner (Left)');
    const runnerRight = runnerRect('runner-right', 'Inner Ledge Runner (Right)');

    // ---- Top retainer rails: narrow strips, set back from the front ----
    const railLength = Math.max(p.width - p.railSetbackFromFront, railWidth * 2);
    if (p.width - p.railSetbackFromFront < railWidth * 2) {
      warnings.push('railSetbackFromFront leaves almost no rail length — the lid may not be retained. Reduce the setback or increase box width.');
    }
    const railRect = (id, name) => makePanel(id, name, railLength, railWidth, {
      bottom: flatEdge('none', k), top: flatEdge('none', k), left: flatEdge('none', k), right: flatEdge('none', k),
    });
    const railLeft = railRect('rail-left', 'Top Retainer Rail (Left)');
    const railRight = railRect('rail-right', 'Top Retainer Rail (Right)');

    // ---- The lid ---------------------------------------------------------
    const lidWidth = Math.max(Lc - p.horizontalClearance, 1); // spans between the outer sides, resting atop the runners
    const lidDepth = Math.max(p.width - t - p.horizontalClearance, 1); // stops just short of the Back panel's inside face
    const lid = makePanel('lid', 'Sliding Lid', lidWidth, lidDepth, {
      bottom: flatEdge('none', k), top: flatEdge('none', k), left: flatEdge('none', k), right: flatEdge('none', k),
    });

    const structural = [runnerLeft, runnerRight, railLeft, railRight, lid];
    for (const pn of structural) panels.push(pn);

    // Kerf-compensate the plain rectangular parts' outlines too (outline mode),
    // then compute all outlines exactly like every other box type.
    BoxGenerator.computeOutlines(panels);

    // Thumb-pull: a semicircular notch cut into the lid's front edge (local y=0).
    if (p.thumbPull && p.thumbPull.enabled) {
      const r = Math.min(p.thumbPull.radius || 10, lidWidth / 4);
      notchSemicircle(lid, lidWidth / 2, 0, r);
    }

    const info = {
      coreLength: Lc, frontHeight, runnerHeight, railWidth, railLength,
      lidWidth, lidDepth, frontLowerAmount,
    };
    return { panels, warnings, info };
  }

  /** Cut a semicircular notch of radius `r` into a panel's outline, centered at (cx, edgeY). */
  function notchSemicircle(panel, cx, edgeY, r) {
    const segs = 20;
    const notch = [];
    for (let i = 0; i <= segs; i++) {
      const a = Math.PI - (i / segs) * Math.PI; // sweep from (cx-r,edgeY) over the top to (cx+r,edgeY)
      notch.push({ x: cx + r * Math.cos(a), y: edgeY + r * Math.sin(a) });
    }
    // Splice the notch into the outline in place of the flat span it replaces.
    // Simplest robust approach for a rectangle: rebuild the outline by cutting
    // out points within [cx-r, cx+r] along the y==edgeY edge and inserting the arc.
    const kept = panel.outline.filter(pt => !(Math.abs(pt.y - edgeY) < 1e-6 && pt.x > cx - r && pt.x < cx + r));
    // Find insertion index: right after the last point with y==edgeY and x<=cx-r
    let insertAt = kept.findIndex(pt => Math.abs(pt.y - edgeY) < 1e-6 && pt.x >= cx - r - 1e-6);
    if (insertAt === -1) insertAt = 0;
    kept.splice(insertAt, 0, ...notch);
    panel.outline = kept;
  }

  // ---- Register the box type ----------------------------------------------
  if (root.BoxGenerator) {
    root.BoxGenerator.BoxTypes.slidingLid = {
      label: 'Sliding Lid Box (cut-only, layered)',
      build: buildSlidingLid,
      defaults: slidingLidDefaults(),
    };
  }

  const SlidingLidBox = { buildSlidingLid, slidingLidDefaults, notchSemicircle };
  if (typeof module !== 'undefined' && module.exports) module.exports = SlidingLidBox;
  else root.SlidingLidBox = SlidingLidBox;
})(typeof window !== 'undefined' ? window : globalThis);
