/**
 * boxGenerator.js — turns box parameters (L, W, H, thickness, kerf, joint
 * settings) into a set of flat Panel definitions ready for preview/export.
 *
 * ── Construction convention ("endcap" style) ──────────────────────────────
 * Left & Right panels are full-size end caps (W × H), reaching the box's
 * true outer corners in Y and Z. Front/Back and Top/Bottom are recessed by
 * the material thickness on their X ends, so they fit snugly *between* the
 * two end caps (their own thickness fills the recess). This keeps the
 * assembled OUTER box dimensions exactly L × W × H, and guarantees every
 * mating edge pair has an identical nominal length — required for finger
 * joints to interlock correctly. See README.md for the full derivation.
 *
 * Panels & local axes (local x = "along width", local y = "along height",
 * origin bottom-left):
 *   LEFT   (W=width,        H=height)   at X=0
 *   RIGHT  (W=width,        H=height)   at X=length
 *   FRONT  (W=length-2t,    H=height)   at Y=0
 *   BACK   (W=length-2t,    H=height)   at Y=width
 *   BOTTOM (W=length-2t,    H=width)    at Z=0
 *   TOP    (W=length-2t,    H=width)    at Z=height
 *
 * Joint families (edges that must share the same nominal length):
 *   A (length = width):     LEFT.bottom/RIGHT.bottom ↔ BOTTOM.left/right
 *                            LEFT.top/RIGHT.top       ↔ TOP.left/right
 *   B (length = height):    LEFT.left/right           ↔ FRONT/BACK.left
 *                            RIGHT.left/right          ↔ FRONT/BACK.right
 *   C (length = length-2t): FRONT/BACK.bottom/top     ↔ BOTTOM/TOP.bottom/top
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const FJ = isNode ? require('./fingerJoint.js') : root.FingerJoint;
  const Kerf = isNode ? require('./kerf.js') : root.Kerf;
  const PanelGeo = isNode ? require('./panel.js') : root.Panel;
  const Assembly = isNode ? require('./assembly.js') : root.Assembly;

  /**
   * Build a finger-jointed pair for one family: returns { a, b } where each
   * is a fully kerf-compensated segment array ready for Panel.buildOutline.
   */
  function buildJointPair(length, params, warnings, familyLabel) {
    const fjOpts = {
      mode: params.fingerMode,
      count: params.fingerCount,
      width: params.fingerWidth,
      phase: 0,
      minFingerWidth: params.minFingerWidth,
      maxFingerWidth: params.maxFingerWidth,
      kerf: params.kerf,
    };
    const resultA = FJ.segmentEdge(length, fjOpts);
    const resultB = FJ.segmentEdge(length, Object.assign({}, fjOpts, { phase: 1 }));
    resultA.warnings.forEach(w => warnings.push(`[${familyLabel}] ${w}`));

    const segA = Kerf.compensateSegments(resultA.segments, params.kerf);
    const segB = Kerf.compensateSegments(resultB.segments, params.kerf);
    return {
      a: { type: 'finger', segments: segA, thickness: params.thickness },
      b: { type: 'finger', segments: segB, thickness: params.thickness },
      fingerWidth: resultA.width,
      fingerCount: resultA.count,
    };
  }

  function flatEdge(offsetMode, kerf) {
    return { type: 'flat', outlineOffset: Kerf.resolveOutlineOffset(offsetMode, kerf) };
  }

  function makePanel(id, name, W, H, edges) {
    return { id, name, W, H, edges, cutouts: [], engravings: [] };
  }

  /**
   * @param {object} p  box parameters (see UI / state schema)
   * @returns {{panels: object[], warnings: string[], info: object}}
   */
  function buildFinger6(p) {
    const warnings = [];
    const t = p.thickness, k = p.kerf;
    const Lc = p.length - 2 * t; // core length used by Front/Back/Top/Bottom
    if (Lc <= 0) warnings.push('Length is too small for the material thickness — Front/Back/Top/Bottom would have zero or negative size.');

    const famA = buildJointPair(p.width, p, warnings, 'width-joints (Left/Right ↔ Top/Bottom)');
    const famB = buildJointPair(p.height, p, warnings, 'height-joints (Left/Right ↔ Front/Back)');
    const famC = buildJointPair(Math.max(Lc, 0.1), p, warnings, 'length-joints (Front/Back ↔ Top/Bottom)');

    const left = makePanel('left', 'Left', p.width, p.height, {
      bottom: famA.a, top: famA.a, left: famB.a, right: famB.a,
    });
    const right = makePanel('right', 'Right', p.width, p.height, {
      bottom: famA.a, top: famA.a, left: famB.a, right: famB.a,
    });
    const front = makePanel('front', 'Front', Lc, p.height, {
      bottom: famC.a, top: famC.a, left: famB.b, right: famB.b,
    });
    const back = makePanel('back', 'Back', Lc, p.height, {
      bottom: famC.a, top: famC.a, left: famB.b, right: famB.b,
    });
    const bottom = makePanel('bottom', 'Bottom', Lc, p.width, {
      bottom: famC.b, top: famC.b, left: famA.b, right: famA.b,
    });
    const top = makePanel('top', 'Top', Lc, p.width, {
      bottom: famC.b, top: famC.b, left: famA.b, right: famA.b,
    });

    let panels = [front, back, left, right, bottom, top];
    if (p.lidStyle === 'none') panels = panels.filter(pn => pn.id !== 'top');
    if (p.bottomStyle === 'none') panels = panels.filter(pn => pn.id !== 'bottom');

    const info = {
      fingerWidthA: famA.fingerWidth, fingerCountA: famA.fingerCount,
      fingerWidthB: famB.fingerWidth, fingerCountB: famB.fingerCount,
      fingerWidthC: famC.fingerWidth, fingerCountC: famC.fingerCount,
      coreLength: Lc,
    };
    return { panels, warnings, info };
  }

  /** Simple 6-panel box, plain butt-jointed edges (no fingers) — for glue/tape assembly. */
  function buildBasic6(p) {
    const warnings = [];
    const t = p.thickness;
    const Lc = p.length - 2 * t;
    if (Lc <= 0) warnings.push('Length is too small for the material thickness.');
    const flat = () => flatEdge(p.outlineCompensation, p.kerf);
    const edges4 = () => ({ bottom: flat(), top: flat(), left: flat(), right: flat() });

    let panels = [
      makePanel('left', 'Left', p.width, p.height, edges4()),
      makePanel('right', 'Right', p.width, p.height, edges4()),
      makePanel('front', 'Front', Lc, p.height, edges4()),
      makePanel('back', 'Back', Lc, p.height, edges4()),
      makePanel('bottom', 'Bottom', Lc, p.width, edges4()),
      makePanel('top', 'Top', Lc, p.width, edges4()),
    ];
    if (p.lidStyle === 'none') panels = panels.filter(pn => pn.id !== 'top');
    if (p.bottomStyle === 'none') panels = panels.filter(pn => pn.id !== 'bottom');
    return { panels, warnings, info: { coreLength: Lc } };
  }

  /** 4-sided open box: Front/Back/Left/Right only, plain edges, no top or bottom. */
  function buildSimple4(p) {
    const warnings = [];
    const flat = () => flatEdge(p.outlineCompensation, p.kerf);
    const edges4 = () => ({ bottom: flat(), top: flat(), left: flat(), right: flat() });
    const panels = [
      makePanel('left', 'Left', p.width, p.height, edges4()),
      makePanel('right', 'Right', p.width, p.height, edges4()),
      makePanel('front', 'Front', p.length, p.height, edges4()),
      makePanel('back', 'Back', p.length, p.height, edges4()),
    ];
    return { panels, warnings, info: {} };
  }

  /** Open-top finger box: like finger6 but Top is always omitted and the top rim edges become flat. */
  function buildFinger5Open(p) {
    const result = buildFinger6(Object.assign({}, p, { lidStyle: 'none' }));
    // Replace the top edges of the side panels (which referenced famA/famC "b" segments
    // meant to mate with a Top panel) with plain flat rim edges instead.
    const flat = () => flatEdge(p.outlineCompensation, p.kerf);
    for (const panel of result.panels) {
      if (panel.id === 'left' || panel.id === 'right') panel.edges.top = flat();
      if (panel.id === 'front' || panel.id === 'back') panel.edges.top = flat();
    }
    return result;
  }

  const BoxTypes = {
    finger6: { label: 'Finger-Joint Box (6 panel)', build: buildFinger6 },
    finger5open: { label: 'Finger-Joint Box, Open Top', build: buildFinger5Open },
    basic6: { label: 'Basic Box (6 panel, butt joint)', build: buildBasic6 },
    simple4: { label: 'Simple 4-Sided Frame', build: buildSimple4 },
  };

  /** Compute the closed outline (array of {x,y}) for every panel, mutating panel.outline. */
  function computeOutlines(panels) {
    for (const panel of panels) {
      // Panels with a hand-built outline (e.g. cross-lap dividers with
      // notches and tabs) set `fixedOutline` and are left untouched.
      if (panel.fixedOutline && panel.outline) continue;
      panel.outline = PanelGeo.buildOutline(panel.W, panel.H, panel.edges);
    }
    return panels;
  }

  function generate(params) {
    const type = BoxTypes[params.boxType] || BoxTypes.finger6;
    const result = type.build(params);
    computeOutlines(result.panels);
    result.errors = result.errors || [];
    // Legacy box types know nothing about assemblies/materials: default them
    // to the single body material so every consumer can rely on the metadata.
    if (Assembly) Assembly.tagLegacy(result.panels, params);
    return result;
  }

  const BoxGenerator = { generate, BoxTypes, computeOutlines, buildJointPair, flatEdge, makePanel };

  if (typeof module !== 'undefined' && module.exports) module.exports = BoxGenerator;
  else root.BoxGenerator = BoxGenerator;
})(typeof window !== 'undefined' ? window : globalThis);
