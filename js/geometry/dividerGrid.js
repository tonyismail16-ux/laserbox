/**
 * dividerGrid.js — parametric internal dividers (cross-lap grid) for a box.
 *
 * ── Terminology ───────────────────────────────────────────────────────────
 *  • "X-walls" are divider walls whose plane is perpendicular to the box's X
 *    axis (they span the Y direction). `dividerCountX` of them split the
 *    internal LENGTH into (countX + 1) columns.
 *  • "Y-walls" are perpendicular to Y (they span X). `dividerCountY` of them
 *    split the internal WIDTH into (countY + 1) rows.
 *
 * ── Cross-lap construction ────────────────────────────────────────────────
 * Wherever an X-wall crosses a Y-wall, each wall carries one slot of
 * half the divider height. X-walls are slotted from the TOP edge, Y-walls
 * from the BOTTOM edge, so the two interlock flush and every wall keeps its
 * full height elsewhere.
 *
 *   nominal slot width  = matingThickness + dividerSlotFit
 *   slot depth          = dividerHeight / 2
 *
 * ── Kerf (applied exactly once) ───────────────────────────────────────────
 * The divider polygon is drawn at NOMINAL size and then offset OUTWARD by
 * `resolveOutlineOffset(mode, kerf)` (kerf/2 in 'auto'). That one operation
 * grows the part by kerf/2 per edge and, because slot walls are part
 * boundary, narrows each slot by `kerf` in the cut file. The laser then
 * removes kerf/2 on each side, landing exactly on the nominal sizes.
 * Wall slots (holes for 'slotted' mounting) use the same rule: their cut
 * width is nominal − 2·offset.
 *
 * ── Mounting ──────────────────────────────────────────────────────────────
 *  'free'    removable grid: ends stop `dividerClearance` short of the walls.
 *  'slotted' each divider end has a tab that passes through a rectangular
 *            slot in the box wall. Slots are placed ≥ 2×wall-thickness away
 *            from the wall's finger joints and a full thickness above the
 *            bottom joint, so wall strength and joints are unaffected.
 *
 * All generated geometry is real 2D cut geometry (polygons + hole cutouts)
 * consumed unchanged by the 2D preview, sheet nesting and SVG/DXF export.
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const Kerf = isNode ? require('./kerf.js') : root.Kerf;
  const Vec2 = isNode ? require('./vec2.js') : root.Vec2;
  const Assembly = isNode ? require('./assembly.js') : root.Assembly;

  const MIN_COMPARTMENT = 3;   // mm — narrower than this is not a usable compartment
  const MIN_DIVIDER_HEIGHT = 6; // mm
  const MAX_DIVIDERS_PER_AXIS = 40;

  function dividerDefaults() {
    return {
      dividersEnabled: false,
      dividerPattern: 'grid',     // 'grid' | 'columns' | 'rows' | 'custom'
      dividerCountX: 1,           // walls splitting the length  -> countX+1 columns
      dividerCountY: 1,           // walls splitting the width   -> countY+1 rows
      customColumnWidths: '',     // pattern 'custom': clear widths, e.g. "40,60,0" (0 = take the remainder)
      customRowDepths: '',        // pattern 'custom': clear depths
      dividerHeight: null,        // null = auto (usable height minus clearance), else mm
      dividerClearance: 0.3,      // mm — gap at each end of a free (removable) divider and below the lid
      dividerSlotFit: 0.1,        // mm — extra width added to every slot over the mating thickness
      dividerMount: 'free',       // 'free' | 'slotted'
      dividerThickness: null,     // null = inherit body thickness
      dividerMaterialId: null, dividerMaterialName: null, dividerMaterialColor: null, dividerKerf: null,
    };
  }

  // ---------------------------------------------------------------------
  // Small geometry helpers
  // ---------------------------------------------------------------------

  /** Parse "40, 60 0" style lists. Returns { values, error }. */
  function parseList(str) {
    if (str === null || str === undefined) return { values: [], error: null };
    if (Array.isArray(str)) return { values: str.map(Number), error: str.some(v => !isFinite(v) || v < 0) ? 'Custom sizes must be non-negative numbers.' : null };
    const s = String(str).trim();
    if (!s) return { values: [], error: null };
    const parts = s.split(/[\s,;]+/).filter(Boolean);
    const values = parts.map(Number);
    if (values.some(v => !isFinite(v) || v < 0)) return { values: [], error: `Custom sizes "${s}" must be a list of non-negative numbers separated by commas.` };
    return { values, error: null };
  }

  /** Offset a CCW rectilinear polygon outward by `o` (negative shrinks). */
  function offsetPolygon(pts, o) {
    if (!o) return pts.map(p => ({ x: p.x, y: p.y }));
    const clean = Vec2.dedupe(pts, 1e-9);
    const n = clean.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      const prev = clean[(i - 1 + n) % n], cur = clean[i], next = clean[(i + 1) % n];
      const e1 = Vec2.sub(cur, prev), e2 = Vec2.sub(next, cur);
      const l1 = Vec2.len(e1) || 1, l2 = Vec2.len(e2) || 1;
      const n1 = { x: e1.y / l1, y: -e1.x / l1 }, n2 = { x: e2.y / l2, y: -e2.x / l2 };
      const den = 1 + (n1.x * n2.x + n1.y * n2.y);
      if (den < 1e-9) { out.push({ x: cur.x, y: cur.y }); continue; }
      out.push({ x: cur.x + o * (n1.x + n2.x) / den, y: cur.y + o * (n1.y + n2.y) / den });
    }
    return out;
  }

  /**
   * Nominal divider outline (CCW, origin bottom-left of the BODY of the part;
   * tabs extend to local x = 0 and x = bodyEnd + tabLen).
   * top / bottom: arrays of {a, b, depth} slot intervals (local x).
   * tab: { len, y0, y1 } or null.
   */
  function dividerPolygon(spec) {
    const tabLen = spec.tab ? spec.tab.len : 0;
    const xs0 = tabLen, xs1 = tabLen + spec.length, h = spec.height;
    const bottom = (spec.bottom || []).slice().sort((p, q) => p.a - q.a);
    const top = (spec.top || []).slice().sort((p, q) => q.a - p.a); // right-to-left on the top edge
    const pts = [];
    pts.push({ x: xs0, y: 0 });
    for (const s of bottom) { pts.push({ x: s.a, y: 0 }, { x: s.a, y: s.depth }, { x: s.b, y: s.depth }, { x: s.b, y: 0 }); }
    pts.push({ x: xs1, y: 0 });
    if (spec.tab) {
      pts.push({ x: xs1, y: spec.tab.y0 }, { x: xs1 + tabLen, y: spec.tab.y0 }, { x: xs1 + tabLen, y: spec.tab.y1 }, { x: xs1, y: spec.tab.y1 });
    }
    pts.push({ x: xs1, y: h });
    for (const s of top) { pts.push({ x: s.b, y: h }, { x: s.b, y: h - s.depth }, { x: s.a, y: h - s.depth }, { x: s.a, y: h }); }
    pts.push({ x: xs0, y: h });
    if (spec.tab) {
      pts.push({ x: xs0, y: spec.tab.y1 }, { x: xs0 - tabLen, y: spec.tab.y1 }, { x: xs0 - tabLen, y: spec.tab.y0 }, { x: xs0, y: spec.tab.y0 });
    }
    return Vec2.dedupe(pts, 1e-9);
  }

  // ---------------------------------------------------------------------
  // Layout planning
  // ---------------------------------------------------------------------

  /**
   * Plan one axis. Returns clear compartment widths and wall centres measured
   * from the inner face of the box wall at the start of this axis.
   */
  function planAxis(inner, count, dt, list, axisName) {
    const errors = [];
    let widths;
    if (list && list.length) {
      const zeros = list.filter(v => v === 0).length;
      const fixed = list.reduce((s, v) => s + v, 0);
      const remainder = inner - count * dt - fixed;
      if (zeros === 0) {
        if (Math.abs(remainder) > 0.05) {
          errors.push({ code: 'divider-custom-sum', message: `Custom ${axisName} sizes total ${fixed.toFixed(2)}mm + ${count} divider(s) of ${dt}mm = ${(fixed + count * dt).toFixed(2)}mm, but the internal ${axisName === 'column' ? 'length' : 'width'} is ${inner.toFixed(2)}mm. Adjust the sizes or enter 0 for one compartment to take the remainder.` });
        }
        widths = list.slice();
      } else {
        const each = remainder / zeros;
        if (each < MIN_COMPARTMENT) errors.push({ code: 'divider-custom-remainder', message: `The remainder left for the "0" ${axisName}(s) is only ${each.toFixed(2)}mm each — reduce the other custom sizes.` });
        widths = list.map(v => (v === 0 ? each : v));
      }
    } else {
      widths = new Array(count + 1).fill((inner - count * dt) / (count + 1));
    }
    widths.forEach((w, i) => {
      if (!(w >= MIN_COMPARTMENT)) errors.push({ code: 'divider-compartment-too-small', message: `Compartment ${axisName} ${i + 1} is ${isFinite(w) ? w.toFixed(2) : 'invalid'}mm wide — dividers of ${dt}mm leave no usable space. Reduce the divider count or thickness, or enlarge the box.` });
    });
    const centers = [];
    let pos = 0;
    for (let i = 0; i < count; i++) {
      pos += widths[i];
      centers.push(pos + dt / 2);
      pos += dt;
    }
    return { widths, centers, errors };
  }

  /** Resolve pattern + counts (and custom lists) into per-axis wall counts. */
  function resolveCounts(p) {
    const errors = [];
    const intCheck = (v, label) => {
      if (!Number.isInteger(v) || v < 0 || v > MAX_DIVIDERS_PER_AXIS) {
        errors.push({ code: 'divider-count', message: `${label} must be a whole number between 0 and ${MAX_DIVIDERS_PER_AXIS} (got ${v}).` });
        return 0;
      }
      return v;
    };
    let nx = 0, ny = 0, cw = null, rd = null;
    switch (p.dividerPattern) {
      case 'columns': nx = intCheck(p.dividerCountX, 'Divider count along X'); break;
      case 'rows': ny = intCheck(p.dividerCountY, 'Divider count along Y'); break;
      case 'custom': {
        const c = parseList(p.customColumnWidths), r = parseList(p.customRowDepths);
        if (c.error) errors.push({ code: 'divider-custom-parse', message: c.error });
        if (r.error) errors.push({ code: 'divider-custom-parse', message: r.error });
        if (c.values.length) { cw = c.values; nx = c.values.length - 1; }
        if (r.values.length) { rd = r.values; ny = r.values.length - 1; }
        break;
      }
      case 'grid':
      default:
        nx = intCheck(p.dividerCountX, 'Divider count along X');
        ny = intCheck(p.dividerCountY, 'Divider count along Y');
    }
    return { nx, ny, cw, rd, errors };
  }

  // ---------------------------------------------------------------------
  // Main builder
  // ---------------------------------------------------------------------

  /**
   * @param {object} p    parameters (dividerDefaults() merged with the box parameters)
   * @param {object} ctx  {
   *    L, W, H, tb, bodyKerf, outlineMode,   // body external size + thickness
   *    bo: [x,y,z],                           // body origin in global space
   *    closedTop, hasBottom,                  // body construction
   *    plugBlock,                             // mm of interior headroom taken by a lid plug (0 if none)
   *    material                               // resolved divider material
   *  }
   * @returns {{panels, wallCutouts, errors, warnings, info}}
   */
  function buildDividers(p, ctx) {
    const errors = [], warnings = [];
    const mat = ctx.material;
    const dt = mat.thickness, kd = mat.kerf;
    const tb = ctx.tb;
    const bo = ctx.bo || [0, 0, 0];

    const Li = ctx.L - 2 * tb, Wi = ctx.W - 2 * tb;
    const Hi = ctx.H - (ctx.hasBottom ? tb : 0) - (ctx.closedTop ? tb : 0);
    const info = { enabled: true, internal: { length: Li, width: Wi, height: Hi } };

    if (!(dt > 0) || !isFinite(dt)) errors.push({ code: 'divider-thickness', message: `Divider thickness must be a positive number (got ${dt}).` });
    if (!(Li > 0 && Wi > 0 && Hi > 0)) errors.push({ code: 'divider-internal', message: 'The box has no internal space for dividers — increase its size or reduce the wall thickness.' });
    if (!ctx.hasBottom) errors.push({ code: 'divider-no-bottom', message: 'Dividers need a bottom panel to stand on — set Bottom to "Flat panel".' });
    const cl = p.dividerClearance, fit = p.dividerSlotFit;
    if (!(cl >= 0 && cl <= 5)) errors.push({ code: 'divider-clearance', message: `Divider clearance must be between 0 and 5mm (got ${cl}).` });
    if (!(fit >= 0 && fit <= 2)) errors.push({ code: 'divider-fit', message: `Divider slot fit allowance must be between 0 and 2mm (got ${fit}).` });
    if (p.dividerMount !== 'free' && p.dividerMount !== 'slotted') errors.push({ code: 'divider-mount', message: `Unknown divider mount "${p.dividerMount}" (use "free" or "slotted").` });

    const counts = resolveCounts(p);
    counts.errors.forEach(e => errors.push(e));
    if (errors.length) return { panels: [], wallCutouts: {}, errors, warnings, info };

    const { nx, ny } = counts;
    const plug = ctx.plugBlock || 0;
    const autoHeight = Hi - cl - plug;
    let hd;
    if (p.dividerHeight === null || p.dividerHeight === undefined || p.dividerHeight === '') hd = autoHeight;
    else {
      hd = Number(p.dividerHeight);
      if (!(hd > 0) || !isFinite(hd)) errors.push({ code: 'divider-height', message: `Divider height must be a positive number (got ${p.dividerHeight}).` });
      else if (hd > Hi - plug + 1e-6) {
        errors.push({ code: 'divider-height-exceeds', message: plug > 0
          ? `Divider height ${hd}mm collides with the lid's locating plug — the usable height under the plug is ${(Hi - plug).toFixed(2)}mm.`
          : `Divider height ${hd}mm exceeds the available internal height of ${Hi.toFixed(2)}mm.` });
      }
    }
    if (errors.length) return { panels: [], wallCutouts: {}, errors, warnings, info };
    if (nx + ny > 0 && hd < MIN_DIVIDER_HEIGHT) errors.push({ code: 'divider-height-small', message: `Divider height ${hd.toFixed(2)}mm is too small for cross-lap slots (minimum ${MIN_DIVIDER_HEIGHT}mm). Increase the box height.` });

    // Axis plans -----------------------------------------------------------
    const planX = planAxis(Li, nx, dt, counts.cw, 'column');
    const planY = planAxis(Wi, ny, dt, counts.rd, 'row');
    planX.errors.forEach(e => errors.push(e));
    planY.errors.forEach(e => errors.push(e));

    info.counts = { x: nx, y: ny };
    info.columnWidths = planX.widths;
    info.rowDepths = planY.widths;
    info.height = hd;
    info.autoHeight = autoHeight;
    info.compartmentCount = (nx + 1) * (ny + 1);
    info.intersections = nx * ny;
    info.mount = p.dividerMount;
    info.compartments = [];
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) info.compartments.push({ col: i, row: j, width: planX.widths[i], depth: planY.widths[j], height: hd });

    if (nx + ny === 0) return { panels: [], wallCutouts: {}, errors, warnings, info };
    if (errors.length) return { panels: [], wallCutouts: {}, errors, warnings, info };

    // Dimensions shared by both wall families -------------------------------
    const slotted = p.dividerMount === 'slotted';
    const o = Kerf.resolveOutlineOffset(ctx.outlineMode, kd);          // divider outline offset
    const ob = Kerf.resolveOutlineOffset(ctx.outlineMode, ctx.bodyKerf); // body (wall slot) offset
    const wn = dt + fit;                       // nominal cross-lap slot width (mating thickness = dt)
    const slotDepth = hd / 2;
    info.slotWidthNominal = wn;
    info.slotWidthInCutFile = wn - 2 * o;
    info.slotDepth = slotDepth;

    let tab = null, tabLen = 0;
    if (slotted) {
      tabLen = tb;
      const y0 = tb, y1 = hd - tb;
      if (y1 - y0 < 4) {
        errors.push({ code: 'divider-slotted-short', message: `Dividers of ${hd.toFixed(1)}mm height are too short to carry wall-slot tabs (need > ${(2 * tb + 4).toFixed(1)}mm). Use "free" mounting or a taller box.` });
        return { panels: [], wallCutouts: {}, errors, warnings, info };
      }
      tab = { len: tabLen, y0, y1 };
    }

    const makeWall = (axis) => {
      // axis 'x' -> X-wall (spans Y), 'y' -> Y-wall (spans X)
      const span = axis === 'x' ? Wi : Li;                  // internal span available
      const lenBody = slotted ? span : span - 2 * cl;       // length of the divider body between walls
      const g0Rel = slotted ? -tb : cl;                      // local x=0 expressed relative to the inner face
      const own = axis === 'x' ? planX : planY;
      const cross = axis === 'x' ? planY : planX;
      const crossCount = axis === 'x' ? ny : nx;
      const ownCount = axis === 'x' ? nx : ny;
      const walls = [];
      if (lenBody <= 0) {
        errors.push({ code: 'divider-length', message: `Divider clearance (${cl}mm) leaves no divider length across the ${axis === 'x' ? 'width' : 'length'} of the box.` });
        return walls;
      }
      for (let i = 0; i < ownCount; i++) {
        const slots = cross.centers.slice(0, crossCount).map(c => {
          const local = c - g0Rel;                           // centre in local x (tabs included)
          return { a: local - wn / 2, b: local + wn / 2, depth: slotDepth, center: local };
        });
        const total = lenBody + 2 * tabLen;
        for (const s of slots) {
          if (s.a < tabLen + 1 - 1e-9 || s.b > tabLen + lenBody - 1 + 1e-9) {
            errors.push({ code: 'divider-slot-position', message: `A cross-lap slot falls too close to the end of divider ${axis.toUpperCase()}${i + 1}. Increase the clearance between dividers or reduce the divider count.` });
          }
        }
        for (let a = 1; a < slots.length; a++) {
          if (slots[a].a < slots[a - 1].b + 1 - 1e-9) {
            errors.push({ code: 'divider-slot-overlap', message: `Adjacent cross-lap slots on divider ${axis.toUpperCase()}${i + 1} overlap — the compartments are too narrow for the slot width of ${wn.toFixed(2)}mm.` });
            break;
          }
        }
        const poly = dividerPolygon({
          length: lenBody, height: hd,
          top: axis === 'x' ? slots : [],
          bottom: axis === 'y' ? slots : [],
          tab,
        });
        walls.push({ axis, index: i, total, lenBody, poly, slots, center: own.centers[i], g0Rel });
      }
      return walls;
    };

    const xWalls = nx ? makeWall('x') : [];
    const yWalls = ny ? makeWall('y') : [];
    if (errors.length) return { panels: [], wallCutouts: {}, errors, warnings, info };

    // Global placement ------------------------------------------------------
    const x0 = bo[0] + tb, y0 = bo[1] + tb, z0 = bo[2] + (ctx.hasBottom ? tb : 0);
    const panels = [];
    const addPanel = (w) => {
      const id = `divider-${w.axis}${w.index + 1}`;
      const name = `Divider ${w.axis.toUpperCase()}${w.index + 1}`;
      const nominalBounds = { minX: 0, minY: 0, maxX: w.total, maxY: hd };
      const outline = offsetPolygon(w.poly, o);
      const panel = { id, name, W: w.total, H: hd, edges: null, fixedOutline: true, outline, cutouts: [], engravings: [] };
      const frame3d = w.axis === 'x'
        ? { x: [0, 1, 0], y: [0, 0, 1], z: [1, 0, 0], origin: [x0 + w.center - dt / 2, y0 + w.g0Rel, z0] }
        : { x: [1, 0, 0], y: [0, 0, 1], z: [0, 1, 0], origin: [x0 + w.g0Rel, y0 + w.center - dt / 2, z0] };
      Assembly.tagPanel(panel, {
        assemblyId: 'dividers', componentType: 'divider', material: mat, frame3d,
        explodeDir: [0, 0, 0.5],
        joint: slotted ? 'cross-lap + wall-slot tabs' : 'cross-lap (removable grid)',
        mating: w.slots.map(s => `cross-lap slot @ ${(s.center - tabLen).toFixed(2)}mm`),
        coreBounds: { minX: tabLen, minY: 0, maxX: tabLen + w.lenBody, maxY: hd },
      });
      panel.layoutBounds = nominalBounds;
      panels.push(panel);
    };
    xWalls.forEach(addPanel);
    yWalls.forEach(addPanel);

    // Wall slots for 'slotted' mounting ---------------------------------------
    const wallCutouts = { front: [], back: [], left: [], right: [] };
    if (slotted) {
      const th = tab.y1 - tab.y0;
      const slotW = wn - 2 * ob, slotH = (th + fit) - 2 * ob;
      const slotY = tb + tab.y0 + th / 2 - 0; // wall-local y (wall bottom = body bottom)
      const minEdge = 2 * tb;
      const place = (sideIds, centers, wallLen, offsetLocal, wallLabel) => {
        for (const c of centers) {
          const lx = c + offsetLocal;
          if (lx - wn / 2 < minEdge - 1e-9 || lx + wn / 2 > wallLen - minEdge + 1e-9) {
            errors.push({ code: 'divider-wall-slot-edge', message: `A divider wall-slot on the ${wallLabel} wall would sit closer than ${minEdge.toFixed(1)}mm to its finger joints — use "free" mounting, fewer dividers, or a larger box.` });
            return;
          }
          for (const id of sideIds) {
            wallCutouts[id].push({ type: 'rect', x: lx, y: slotY, w: slotW, h: slotH, layer: 'cut', structural: true, source: 'divider-slot' });
          }
        }
      };
      if (nx) place(['front', 'back'], planX.centers, ctx.L - 2 * tb, 0, 'front/back');
      if (ny) place(['left', 'right'], planY.centers, ctx.W, tb, 'left/right');
      info.wallSlots = { frontBack: nx, leftRight: ny, widthNominal: wn, heightNominal: th + fit };
    }
    if (errors.length) return { panels: [], wallCutouts: {}, errors, warnings, info };

    if (hd < 10) warnings.push(`Dividers are only ${hd.toFixed(1)}mm tall — they may be fragile and the cross-lap slots very shallow.`);
    if (kd >= dt * 0.8) warnings.push(`Divider kerf (${kd}mm) is close to the divider thickness (${dt}mm) — slots will be loose.`);

    info.dividerCount = panels.length;
    return { panels, wallCutouts, errors, warnings, info };
  }

  const DividerGrid = { dividerDefaults, buildDividers, planAxis, parseList, offsetPolygon, dividerPolygon, resolveCounts, MIN_COMPARTMENT, MIN_DIVIDER_HEIGHT };

  if (isNode) module.exports = DividerGrid;
  else root.DividerGrid = DividerGrid;
})(typeof window !== 'undefined' ? window : globalThis);
