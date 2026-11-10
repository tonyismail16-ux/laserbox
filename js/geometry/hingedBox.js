/**
 * hingedBox.js — box presets whose lid is attached rather than removable:
 *
 *  - "living" hinge: the Back wall and the Lid are ONE continuous piece of
 *    material (no cut along the fold line at all); a band of short,
 *    alternating slits is cut across the fold so the material flexes there.
 *    This is the classic laser-cut living hinge.
 *
 *  - "node" hinge: the Back wall and the Lid are two SEPARATE panels whose
 *    shared edge is cut into interlocking rounded "knuckles" (like a piano
 *    hinge), with a small pin hole through the center of every knuckle so a
 *    dowel/rod/wire threaded through afterward becomes the actual pivot.
 *
 * Both styles support:
 *   hingeSegments: 'continuous' | 'segmented'  (one long hinge vs several
 *                  shorter ones separated by solid, uncut bridges — trades
 *                  flex smoothness for strength)
 *   lidOpening:    'oneWay'  — a single lid hinged at the back edge
 *                  'twoWay'  — a split lid: one half hinged at the front,
 *                              one half hinged at the back, meeting (not
 *                              joined) in the middle
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const BoxGenerator = isNode ? require('./boxGenerator.js') : root.BoxGenerator;
  const FingerJoint = isNode ? require('./fingerJoint.js') : root.FingerJoint;
  const Vec2 = isNode ? require('./vec2.js') : root.Vec2;

  const { buildJointPair, flatEdge, makePanel } = BoxGenerator;

  function hingedDefaults() {
    return {
      hingeStyle: 'living',       // 'living' | 'node'
      hingeSegments: 'continuous', // 'continuous' | 'segmented'
      hingeSegmentCount: 3,        // used when hingeSegments === 'segmented'
      lidOpening: 'oneWay',        // 'oneWay' | 'twoWay'
      lidDepthRatio: 1.0,          // one-way lid depth as a fraction of box width
      // Living-hinge slit pattern
      hingeBandHeight: 8,          // mm — width of the flex band across the fold
      hingeSlitPitch: 2.5,         // mm — center-to-center spacing of slits
      hingeSlitWidth: 0.5,         // mm — cut width of each slit (~ a hairline / kerf)
      hingeWebThickness: 0.8,      // mm — material left uncut at the alternating end of each slit
      hingeSegmentGap: 10,         // mm — gap between hinge segments when segmented
      // Node/knuckle hinge
      knuckleCount: 9,
      knuckleClearance: 0.25,      // mm — extra radius on the receiving notch so the joint can rotate
      pinHoleDiameter: 2.0,        // mm — for a wire/dowel pin through the knuckles
    };
  }

  // ------------------------------------------------------------------
  // Living hinge: alternating-slit flex pattern cut across a band.
  // ------------------------------------------------------------------

  /**
   * @returns {Array} rect cutout definitions (panel-local coords), each a
   *   short slit alternating which side of the band it's cut from.
   */
  function livingHingeSlits(regionWidth, bandHeight, originX, centerY, opts) {
    opts = opts || {};
    const pitch = opts.hingeSlitPitch || 2.5;
    const slitWidth = opts.hingeSlitWidth || 0.5;
    const web = Math.min(opts.hingeWebThickness || 0.8, bandHeight - 0.2);
    const margin = pitch;
    const slitHeight = bandHeight - web;
    const bandBottom = centerY - bandHeight / 2;

    const slits = [];
    let x = originX + margin;
    let i = 0;
    while (x <= originX + regionWidth - margin) {
      const fromBottom = i % 2 === 0;
      const y = fromBottom ? bandBottom + slitHeight / 2 : bandBottom + bandHeight - slitHeight / 2;
      slits.push({ type: 'rect', x, y, w: slitWidth, h: slitHeight, layer: 'cut' });
      x += pitch;
      i++;
    }
    return slits;
  }

  /**
   * Lay out one or more hinge bands (continuous or segmented) across a fold
   * line of total length `totalWidth`, centered vertically at `centerY`.
   */
  function buildHingePattern(totalWidth, centerY, opts) {
    const segmented = opts.hingeSegments === 'segmented';
    const count = segmented ? Math.max(1, opts.hingeSegmentCount || 3) : 1;
    const gap = segmented ? (opts.hingeSegmentGap || 10) : 0;
    const totalGap = gap * (count - 1);
    const segW = (totalWidth - totalGap) / count;
    let cutouts = [];
    for (let i = 0; i < count; i++) {
      const originX = i * (segW + gap);
      cutouts = cutouts.concat(livingHingeSlits(segW, opts.hingeBandHeight || 8, originX, centerY, opts));
    }
    return cutouts;
  }

  // ------------------------------------------------------------------
  // Node (knuckle) hinge: interlocking rounded tabs + aligned pin holes.
  // ------------------------------------------------------------------

  /**
   * Builds one panel's side of an interlocking knuckle hinge.
   * @returns {{ points: {along:number, depth:number}[], holes: {along:number}[] }}
   *   points are in the generic (along-edge, perpendicular-depth) convention
   *   panel.js already understands for 'custom' edges; holes are knuckle
   *   centers (this panel's OWN knuckles only) for pin-hole placement.
   */
  function buildKnuckleEdge(length, thickness, phase, opts) {
    const count = Math.max(2, Math.round(opts.knuckleCount || 5));
    const seg = FingerJoint.segmentEdge(length, { mode: 'count', count, phase });
    const r = seg.width / 2;
    const clearance = opts.knuckleClearance || 0.25;
    const arcSteps = 10;
    const points = [];
    const holes = [];

    for (const s of seg.segments) {
      const mid = (s.start + s.end) / 2;
      if (s.state === 'tab') {
        // This panel owns a rounded knuckle here: a semicircular bump
        // protruding OUTWARD (negative depth = outward, matching the
        // 'flat' edge convention where outward = -inward direction).
        for (let i = 0; i <= arcSteps; i++) {
          const a = Math.PI - (i / arcSteps) * Math.PI; // sweep start -> end across the bump
          points.push({ along: mid + r * Math.cos(a), depth: -r * Math.sin(a) });
        }
        holes.push({ along: mid });
      } else {
        // Receiving notch: recessed semicircle, slightly oversized (+clearance)
        // so the mating panel's knuckle can rotate freely once pinned.
        const rr = r + clearance;
        for (let i = 0; i <= arcSteps; i++) {
          const a = Math.PI - (i / arcSteps) * Math.PI;
          points.push({ along: mid + rr * Math.cos(a), depth: rr * Math.sin(a) });
        }
      }
    }
    return { points, holes, segmentWidth: seg.width, count: seg.count };
  }

  // ------------------------------------------------------------------
  // Shared helper: extend a finger-segment array with a flat continuation
  // (reused from the sliding-lid box's mixed-edge technique).
  // ------------------------------------------------------------------
  function extendWithFlatCap(pairSide, totalLength, jointedLength) {
    const extra = totalLength - jointedLength;
    if (extra <= 1e-6) return pairSide;
    const segments = pairSide.segments.concat([{ start: jointedLength, end: totalLength, width: extra, state: 'tab' }]);
    return Object.assign({}, pairSide, { segments });
  }

  // ------------------------------------------------------------------
  // Box builders
  // ------------------------------------------------------------------

  /** Shared chassis: Base + Front + Left + Right, open top (like finger5open). */
  function buildOpenChassis(p, warnings) {
    const t = p.thickness, H = p.height;
    const Lc = p.length - 2 * t;
    const famA = buildJointPair(p.width, p, warnings, 'width-joints (Left/Right <-> Base)');
    const famB = buildJointPair(H, p, warnings, 'height-joints (Left/Right <-> Front/Back)');
    const famC = buildJointPair(Math.max(Lc, 0.1), p, warnings, 'length-joints (Front/Back <-> Base)');
    const openTop = flatEdge(p.outlineCompensation, p.kerf);

    const left = makePanel('left', 'Left', p.width, H, { bottom: famA.a, top: openTop, left: famB.a, right: famB.a });
    const right = makePanel('right', 'Right', p.width, H, { bottom: famA.a, top: openTop, left: famB.a, right: famB.a });
    const front = makePanel('front', 'Front', Lc, H, { bottom: famC.a, top: openTop, left: famB.b, right: famB.b });
    const base = makePanel('base', 'Base', Lc, p.width, { bottom: famC.b, top: famC.b, left: famA.b, right: famA.b });

    return { panels: [front, left, right, base], famB, famC, Lc, H };
  }

  function buildLivingHingeBox(rawParams) {
    const p = Object.assign({}, hingedDefaults(), rawParams);
    const warnings = [];
    const t = p.thickness;
    const chassis = buildOpenChassis(p, warnings);
    const { famB, Lc, H } = chassis;
    const panels = chassis.panels;

    function combinedBackLidPanel(id, name, lidDepth) {
      const totalH = H + p.hingeBandHeight + lidDepth;
      // bottom/left/right (wall portion, 0..H) get standard joints; above H
      // (the lid portion) the left/right edges are free (not attached to
      // anything), so we cap them flat from H up to totalH.
      const left = extendWithFlatCap(famB.b, totalH, H);
      const right = extendWithFlatCap(famB.b, totalH, H);
      const panel = makePanel(id, name, Lc, totalH, {
        bottom: chassis.famC.a,
        top: flatEdge(p.outlineCompensation, p.kerf),
        left, right,
      });
      panel._hingeCenterY = H + p.hingeBandHeight / 2;
      panel._wallHeight = H;
      panel._lidDepth = lidDepth;
      return panel;
    }

    if (p.lidOpening === 'twoWay') {
      const half = (p.width * p.lidDepthRatio) / 2 - p.hingeSegmentGap / 2;
      const back = combinedBackLidPanel('back', 'Back + Lid (rear half, living hinge)', half);
      const front = panels.find(pn => pn.id === 'front');
      // Rebuild front as a combined Front+Lid panel the same way.
      const frontCombined = makePanel('front', 'Front + Lid (front half, living hinge)', Lc, H + p.hingeBandHeight + half, {
        bottom: front.edges.bottom, top: flatEdge(p.outlineCompensation, p.kerf),
        left: extendWithFlatCap(famB.b, H + p.hingeBandHeight + half, H),
        right: extendWithFlatCap(famB.b, H + p.hingeBandHeight + half, H),
      });
      frontCombined._hingeCenterY = H + p.hingeBandHeight / 2;
      frontCombined._wallHeight = H;
      frontCombined._lidDepth = half;
      const idx = panels.findIndex(pn => pn.id === 'front');
      panels[idx] = frontCombined;
      panels.push(back);
    } else {
      const lidDepth = p.width * p.lidDepthRatio;
      panels.push(combinedBackLidPanel('back', 'Back + Lid (living hinge)', lidDepth));
    }

    BoxGenerator.computeOutlines(panels);

    // Now stamp the hinge slit pattern(s) into each combined panel as cutouts.
    for (const panel of panels) {
      if (panel._hingeCenterY == null) continue;
      panel.cutouts = panel.cutouts.concat(buildHingePattern(panel.W, panel._hingeCenterY, p));
    }
    // Re-run outline computation is unnecessary — cutouts are independent holes,
    // not outline modifications — but keep panels' outlines already computed above.

    return { panels, warnings, info: { coreLength: Lc, wallHeight: H } };
  }

  function buildNodeHingeBox(rawParams) {
    const p = Object.assign({}, hingedDefaults(), rawParams);
    const warnings = [];
    const chassis = buildOpenChassis(p, warnings);
    const { Lc, H } = chassis;
    const panels = chassis.panels;
    const backStandard = buildJointPair(H, p, warnings, 'height-joints (Left/Right <-> Back)');
    // Rebuild Back with a standard bottom/side joint but a KNUCKLE top edge.
    const backKnuckle = buildKnuckleEdge(Lc, p.thickness, 0, p);
    const back = makePanel('back', 'Back', Lc, H, {
      bottom: chassis.famC.a, left: backStandard.b, right: backStandard.b,
      top: { type: 'custom', points: backKnuckle.points },
    });
    panels.push(back);

    function lidWithKnuckle(id, name, lidDepth, phase) {
      const lidKnuckle = buildKnuckleEdge(Lc, p.thickness, phase, p);
      const lid = makePanel(id, name, Lc, lidDepth, {
        top: flatEdge(p.outlineCompensation, p.kerf),
        left: flatEdge(p.outlineCompensation, p.kerf), right: flatEdge(p.outlineCompensation, p.kerf),
        bottom: { type: 'custom', points: lidKnuckle.points },
      });
      lid._knuckleHoles = lidKnuckle.holes;
      lid._pinRowY = 0;
      return { lid, knuckleWidth: lidKnuckle.segmentWidth };
    }

    if (p.lidOpening === 'twoWay') {
      const half = (p.width * p.lidDepthRatio) / 2 - p.hingeSegmentGap / 2;
      const { lid: lidBack } = lidWithKnuckle('lid-back', 'Lid (rear half, node hinge)', half, 1);
      panels.push(lidBack);
      // Front also gets a knuckle top edge, and a matching front-half lid.
      const frontIdx = panels.findIndex(pn => pn.id === 'front');
      const frontKnuckle = buildKnuckleEdge(Lc, p.thickness, 0, p);
      panels[frontIdx] = makePanel('front', 'Front', Lc, H, {
        bottom: panels[frontIdx].edges.bottom, left: panels[frontIdx].edges.left, right: panels[frontIdx].edges.right,
        top: { type: 'custom', points: frontKnuckle.points },
      });
      const { lid: lidFront } = lidWithKnuckle('lid-front', 'Lid (front half, node hinge)', half, 1);
      panels.push(lidFront);
    } else {
      const lidDepth = p.width * p.lidDepthRatio;
      const { lid } = lidWithKnuckle('lid', 'Lid (node hinge)', lidDepth, 1);
      panels.push(lid);
    }

    BoxGenerator.computeOutlines(panels);

    // Pin holes: stamp aligned holes at every knuckle center, on both the
    // fixed panel and the hinging panel, `pinHoleDiameter` in size.
    const pr = (p.pinHoleDiameter || 2) / 2;
    for (const panel of panels) {
      if (!panel._knuckleHoles) continue;
      panel.cutouts = panel.cutouts.concat(panel._knuckleHoles.map(h => ({ type: 'circle', x: h.along, y: pr + 0.5, r: pr, layer: 'cut' })));
    }
    const backPanel = panels.find(pn => pn.id === 'back');
    if (backPanel) {
      const holes = buildKnuckleEdge(Lc, p.thickness, 0, p).holes;
      backPanel.cutouts = backPanel.cutouts.concat(holes.map(h => ({ type: 'circle', x: h.along, y: H - pr - 0.5, r: pr, layer: 'cut' })));
    }

    return { panels, warnings, info: { coreLength: Lc, wallHeight: H } };
  }

  function buildHinged(rawParams) {
    const style = rawParams.hingeStyle || 'living';
    return style === 'node' ? buildNodeHingeBox(rawParams) : buildLivingHingeBox(rawParams);
  }

  if (root.BoxGenerator) {
    root.BoxGenerator.BoxTypes.hingedBox = {
      label: 'Hinged Box (living hinge or interlocking node hinge)',
      build: buildHinged,
      defaults: hingedDefaults(),
    };
  }

  const HingedBox = { buildHinged, buildLivingHingeBox, buildNodeHingeBox, hingedDefaults, buildHingePattern, buildKnuckleEdge, livingHingeSlits };
  if (typeof module !== 'undefined' && module.exports) module.exports = HingedBox;
  else root.HingedBox = HingedBox;
})(typeof window !== 'undefined' ? window : globalThis);
