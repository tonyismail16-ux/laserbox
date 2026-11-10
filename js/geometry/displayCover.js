/**
 * displayCover.js — "clear acrylic display cover over a wooden base".
 *
 * Reference product: a transparent acrylic enclosure sitting over an opaque
 * wooden base. This module generates the PARAMETRIC construction, not that
 * specific object.
 *
 * ── Assemblies ────────────────────────────────────────────────────────────
 *   base assembly  (assemblyId 'body', plywood):
 *       box body (+ optional dividers)  — built by customBox.js
 *       base plate                      — cover outer size + overhang
 *       seat ring                       — a flat frame glued to the plate that
 *                                         locates the cover (cover inner =
 *                                         ring outer + 2×coverClearance)
 *   cover assembly (assemblyId 'cover', acrylic):
 *       top + 4 sidewalls, BUTT-jointed (solvent-cement). Finger joints are
 *       deliberately NOT used: they are brittle in acrylic and need tight
 *       fits that solvent cement cannot provide.
 *
 * ── Fit calculation (all per side) ────────────────────────────────────────
 *   ring inner  = body external + 2·coverBodyGap
 *   ring outer  = ring inner + 2·ringWidth
 *   cover inner = ring outer + 2·coverClearance
 *   cover outer = cover inner + 2·coverThickness
 * When the user fixes coverWidth/coverDepth (outer), ringWidth is derived
 * instead and validated (≥ 3mm).
 *
 * Cover height (outer) defaults to body height + coverTopGap + coverThickness.
 *
 * Butt-joint construction of the cover shell (outer L×W×H, thickness t):
 *   top        L × W        (overlaps the wall tops)
 *   front/back L × (H − t)  (full length)
 *   left/right (W − 2t) × (H − t) (between front and back)
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const BoxGenerator = isNode ? require('./boxGenerator.js') : root.BoxGenerator;
  const Kerf = isNode ? require('./kerf.js') : root.Kerf;
  const Assembly = isNode ? require('./assembly.js') : root.Assembly;

  const MIN_RING_WIDTH = 3;

  function coverDefaults() {
    return {
      coverMaterialId: 'acrylic3', coverMaterialName: '3mm Acrylic', coverMaterialColor: '#bfe3f0',
      coverThickness: 3, coverKerf: 0.1,
      coverWidth: null, coverDepth: null, coverHeight: null, // outer size; null = derive from the body
      coverSidewalls: true,       // false -> a flat acrylic top that rests on the body
      coverClearance: 0.5,        // mm per side between seat ring and cover inner face
      coverBodyGap: 0.5,          // mm per side between body and seat ring
      coverRingWidth: 6,          // mm — seat ring width when the cover width is derived
      coverTopGap: 5,             // mm — headroom between body top and cover underside
      coverSeat: 'ring',          // 'ring' (base plate + locating ring) | 'none'
      coverPlateOverhang: 6,      // mm — base plate margin beyond the cover
    };
  }

  /**
   * Butt-jointed five-sided shell (open bottom). Frames are built directly in
   * assembled orientation. Returns un-tagged-for-assembly panels with outlines.
   */
  function buildButtShell(o) {
    const { idPrefix, nameBase, L, W, H, t, material, assemblyId, origin, outlineMode, explodeDir, joint, notes } = o;
    const off = Kerf.resolveOutlineOffset(outlineMode, material.kerf);
    const flat = () => ({ type: 'flat', outlineOffset: off });
    const edges4 = () => ({ bottom: flat(), top: flat(), left: flat(), right: flat() });
    const wallH = H - t;
    const [ox, oy, oz] = origin;
    const defs = [
      { key: 'top', name: `${nameBase} Top`, W: L, H: W, frame: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], origin: [ox, oy, oz + H - t] }, type: 'top' },
      { key: 'front', name: `${nameBase} Front`, W: L, H: wallH, frame: { x: [1, 0, 0], y: [0, 0, 1], z: [0, 1, 0], origin: [ox, oy, oz] }, type: 'wall' },
      { key: 'back', name: `${nameBase} Back`, W: L, H: wallH, frame: { x: [1, 0, 0], y: [0, 0, 1], z: [0, 1, 0], origin: [ox, oy + W - t, oz] }, type: 'wall' },
      { key: 'left', name: `${nameBase} Left`, W: W - 2 * t, H: wallH, frame: { x: [0, 1, 0], y: [0, 0, 1], z: [1, 0, 0], origin: [ox, oy + t, oz] }, type: 'wall' },
      { key: 'right', name: `${nameBase} Right`, W: W - 2 * t, H: wallH, frame: { x: [0, 1, 0], y: [0, 0, 1], z: [1, 0, 0], origin: [ox + L - t, oy + t, oz] }, type: 'wall' },
    ];
    const panels = defs.map(d => {
      const panel = BoxGenerator.makePanel(`${idPrefix}-${d.key}`, d.name, Math.max(d.W, 0.1), Math.max(d.H, 0.1), edges4());
      Assembly.tagPanel(panel, {
        assemblyId, componentType: d.type === 'top' ? 'cover-top' : 'cover-wall', material,
        frame3d: d.frame, explodeDir: explodeDir || [0, 0, 1], joint: joint || 'butt joint (solvent cement)',
        notes: notes || 'Top overlaps the wall edges; side walls sit between front and back.',
      });
      return panel;
    });
    BoxGenerator.computeOutlines(panels);
    return panels;
  }

  /**
   * Plan + build the cover assembly's geometry. Returns the body origin so the
   * caller can place the body (and dividers) correctly beneath the cover.
   *
   * @param {object} p    merged parameters
   * @param {object} ctx  { L, W, H, tb, outlineMode, coverMat, baseMat }
   *   baseMat — material used for the plate and ring (the "lid/base" material)
   */
  function buildDisplayCover(p, ctx) {
    const errors = [], warnings = [];
    const { L, W, H } = ctx;
    const ct = ctx.coverMat.thickness, lt = ctx.baseMat.thickness;
    const g = p.coverBodyGap, clr = p.coverClearance;
    const seat = p.coverSeat === 'ring';
    const num = (v, label, min, max) => {
      if (!(v >= min && v <= max) || !isFinite(v)) { errors.push({ code: 'cover-param', message: `${label} must be between ${min} and ${max}mm (got ${v}).` }); return false; }
      return true;
    };
    num(g, 'Cover body gap', 0, 10); num(clr, 'Cover clearance', 0, 5); num(p.coverTopGap, 'Cover top gap', 0, 50);
    if (!(ct > 0)) errors.push({ code: 'cover-thickness', message: `Cover material thickness must be positive (got ${ct}).` });
    if (!(lt > 0) && seat) errors.push({ code: 'cover-base-thickness', message: `Base plate/ring material thickness must be positive (got ${lt}).` });
    if (p.coverSeat !== 'ring' && p.coverSeat !== 'none') errors.push({ code: 'cover-seat', message: `Unknown cover seat "${p.coverSeat}" (use "ring" or "none").` });
    if (errors.length) return { panels: [], errors, warnings, bo: [0, 0, 0], info: {} };

    let ringInnerL = L + 2 * g, ringInnerW = W + 2 * g;
    let ringOuterL, ringOuterW, coverInnerL, coverInnerW;
    const userW = p.coverWidth !== null && p.coverWidth !== undefined && p.coverWidth !== '';
    const userD = p.coverDepth !== null && p.coverDepth !== undefined && p.coverDepth !== '';
    if (seat) {
      ringOuterL = userW ? p.coverWidth - 2 * ct - 2 * clr : ringInnerL + 2 * p.coverRingWidth;
      ringOuterW = userD ? p.coverDepth - 2 * ct - 2 * clr : ringInnerW + 2 * p.coverRingWidth;
      const rwL = (ringOuterL - ringInnerL) / 2, rwW = (ringOuterW - ringInnerW) / 2;
      if (rwL < MIN_RING_WIDTH - 1e-9 || rwW < MIN_RING_WIDTH - 1e-9) {
        errors.push({ code: 'cover-too-small', message: `The cover (${userW ? p.coverWidth : '—'} × ${userD ? p.coverDepth : '—'}mm outer) is too small to enclose the ${L} × ${W}mm body with a ${MIN_RING_WIDTH}mm minimum seat ring. Enlarge the cover or set the seat to "none".` });
      }
      coverInnerL = ringOuterL + 2 * clr; coverInnerW = ringOuterW + 2 * clr;
    } else {
      coverInnerL = userW ? p.coverWidth - 2 * ct : L + 2 * clr;
      coverInnerW = userD ? p.coverDepth - 2 * ct : W + 2 * clr;
      if (coverInnerL < L + 2 * g - 1e-9 || coverInnerW < W + 2 * g - 1e-9) {
        errors.push({ code: 'cover-too-small', message: `The cover's inside (${coverInnerL.toFixed(1)} × ${coverInnerW.toFixed(1)}mm) cannot enclose the ${L} × ${W}mm body.` });
      }
    }
    const coverOuterL = coverInnerL + 2 * ct, coverOuterW = coverInnerW + 2 * ct;
    const userH = p.coverHeight !== null && p.coverHeight !== undefined && p.coverHeight !== '';
    const coverOuterH = userH ? p.coverHeight : H + p.coverTopGap + ct;
    if (!(coverOuterH - ct >= H + 0.5)) {
      errors.push({ code: 'cover-height', message: `The cover's inside height (${(coverOuterH - ct).toFixed(1)}mm) is not tall enough to enclose the ${H}mm body. Increase the cover height.` });
    }
    if (errors.length) return { panels: [], errors, warnings, bo: [0, 0, 0], info: {} };

    const panels = [];
    const plateOv = p.coverPlateOverhang;
    let plateL = 0, plateW = 0, pt = 0, bo, coverOrigin;
    if (seat) {
      if (!(plateOv >= 0 && plateOv <= 50)) { errors.push({ code: 'cover-plate', message: `Base plate overhang must be between 0 and 50mm (got ${plateOv}).` }); return { panels: [], errors, warnings, bo: [0, 0, 0], info: {} }; }
      plateL = coverOuterL + 2 * plateOv; plateW = coverOuterW + 2 * plateOv; pt = lt;
      bo = [(plateL - L) / 2, (plateW - W) / 2, pt];
      coverOrigin = [(plateL - coverOuterL) / 2, (plateW - coverOuterW) / 2, pt];

      const off = Kerf.resolveOutlineOffset(ctx.outlineMode, ctx.baseMat.kerf);
      const flat = () => ({ type: 'flat', outlineOffset: off });
      const e4 = () => ({ bottom: flat(), top: flat(), left: flat(), right: flat() });

      const plate = BoxGenerator.makePanel('cover-base-plate', 'Display Base Plate', plateL, plateW, e4());
      Assembly.tagPanel(plate, {
        assemblyId: 'body', componentType: 'base-plate', material: ctx.baseMat,
        frame3d: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], origin: [0, 0, 0] },
        explodeDir: [0, 0, -1], joint: 'glued', notes: 'Body and seat ring are glued onto this plate.',
      });
      panels.push(plate);

      const ring = BoxGenerator.makePanel('cover-seat-ring', 'Cover Seat Ring', ringOuterL, ringOuterW, e4());
      ring.cutouts.push({ type: 'rect', x: ringOuterL / 2, y: ringOuterW / 2, w: ringInnerL - 2 * off, h: ringInnerW - 2 * off, layer: 'cut', structural: true, source: 'seat-ring' });
      const rwL = (ringOuterL - ringInnerL) / 2, rwW = (ringOuterW - ringInnerW) / 2;
      Assembly.tagPanel(ring, {
        assemblyId: 'body', componentType: 'seat-ring', material: ctx.baseMat,
        frame3d: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], origin: [(plateL - ringOuterL) / 2, (plateW - ringOuterW) / 2, pt] },
        explodeDir: [0, 0, 0.3], joint: 'glued', notes: 'Glue to the base plate; the cover drops over its outside edge.',
        collisionBoxes: [
          { minX: 0, minY: 0, maxX: rwL, maxY: ringOuterW }, { minX: ringOuterL - rwL, minY: 0, maxX: ringOuterL, maxY: ringOuterW },
          { minX: rwL, minY: 0, maxX: ringOuterL - rwL, maxY: rwW }, { minX: rwL, minY: ringOuterW - rwW, maxX: ringOuterL - rwL, maxY: ringOuterW },
        ],
      });
      panels.push(ring);
    } else {
      bo = [(coverOuterL - L) / 2, (coverOuterW - W) / 2, 0];
      coverOrigin = [0, 0, 0];
    }
    BoxGenerator.computeOutlines(panels);

    const shell = buildButtShell({
      idPrefix: 'cover', nameBase: 'Cover', L: coverOuterL, W: coverOuterW, H: coverOuterH, t: ct,
      material: ctx.coverMat, assemblyId: 'cover', origin: coverOrigin, outlineMode: ctx.outlineMode,
    });
    shell.forEach(s => panels.push(s));

    if (ctx.coverMat.kerf >= ct * 0.8) warnings.push(`Cover kerf (${ctx.coverMat.kerf}mm) is close to the cover thickness (${ct}mm).`);
    warnings.push('Acrylic cover panels are butt-jointed: bond with acrylic solvent cement (e.g. dichloromethane-based) after masking the cut edges. Clear acrylic is not finger-jointed.');

    return {
      panels, errors, warnings, bo,
      info: {
        cover: { outer: { length: coverOuterL, width: coverOuterW, height: coverOuterH }, inner: { length: coverInnerL, width: coverInnerW, height: coverOuterH - ct }, thickness: ct, joint: 'butt' },
        seat: seat ? { ring: { outer: { length: ringOuterL, width: ringOuterW }, inner: { length: ringInnerL, width: ringInnerW }, width: (ringOuterL - ringInnerL) / 2 }, plate: { length: plateL, width: plateW, thickness: pt }, coverClearance: clr } : null,
        bodyOrigin: bo,
      },
    };
  }

  const DisplayCover = { coverDefaults, buildDisplayCover, buildButtShell, MIN_RING_WIDTH };
  if (isNode) module.exports = DisplayCover;
  else root.DisplayCover = DisplayCover;
})(typeof window !== 'undefined' ? window : globalThis);
