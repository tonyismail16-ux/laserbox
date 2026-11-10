/**
 * innerBed.js — an INNER LAYER ("bed") that sits inside the box body.
 *
 * Typical use: a raised false floor / insert tray that holds a product above
 * the bottom of the box, or a shallow tray that lifts the contents closer to
 * the rim. It is its own assembly (`bed`): cut, exported and nested on its own.
 *
 *   bedStyle 'tray'  open-top finger-jointed tray (bottom + 4 walls); with
 *                    bedFlipped it is turned UPSIDE DOWN — walls stand on the
 *                    floor/elevation and the plate is on top, like a table
 *   bedStyle 'plate' a single flat plate (a false floor)
 *
 *   plan size   = body internal size − 2·bedClearance          (per side gap)
 *   bedElevation= mm from the body's internal floor to the bed's underside
 *                 (0 = sits on the floor; larger = raised)
 *   bedHeight   = outer height of the tray (ignored for 'plate'). Blank (null) =
 *                 AUTO: the tray fills from its elevation up to the rim, or up to
 *                 the underside of an inset lid / inner collar / lid plug.
 *
 * DOUBLE LAYER (local backing patches): pocket holes are cut THROUGH the pocket plate, so
 * an item that does not reach the box floor would simply fall through. Every item that
 * needs support therefore gets its OWN small backing patch, glued flat against the UNDERSIDE
 * of the pocket plate directly beneath that hole. The hole stays cut through the top plate
 * and the patch is NOT cut out, so the item rests on it (3mm plate + 3mm patch = 6mm there).
 * The patch is the pocket outline grown by `bedBackingMargin` (default 5mm per side) so there
 * is a ledge of glue area all the way round. Nothing is added under the rest of the plate.
 *
 * An item is TALL (no patch) when its `itemHeight` rises at least `bedTallItemMin` (default
 * 50mm = 5cm) above the top of the bed: it stands on the box floor and the pocket only holds
 * it upright, e.g. a lamp base. Flat things (acrylic laid flat, hamper contents ...) and any
 * item with no height entered get a patch. Each patch is its own 'bed-backing' part.
 * `bedBacking: false` turns the automatic patches off.
 *
 * The bed may reach ABOVE the body rim (elevation + height > internal height):
 * that is allowed (warning only) so an insert can stand proud of the box, but a
 * lid or divider that occupies the same space is reported as a collision.
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const BoxGenerator = isNode ? require('./boxGenerator.js') : root.BoxGenerator;
  const Kerf = isNode ? require('./kerf.js') : root.Kerf;
  const PanelGeo = isNode ? require('./panel.js') : root.Panel;
  const Assembly = isNode ? require('./assembly.js') : root.Assembly;

  const STYLES = ['tray', 'plate'];

  function bedDefaults() {
    return {
      bedEnabled: false,
      bedStyle: 'tray',      // 'tray' | 'plate'
      bedHeight: 20,         // mm — outer tray height; null/blank = AUTO (fill up to the rim / the lid's underside)
      bedElevation: 0,       // mm — underside of the bed above the internal floor
      bedOnFloor: false,     // true = the bed TOUCHES the floor: walls stand on it (platform), height is measured from the floor, no floating
      bedFlipped: false,     // tray only: true = UPSIDE DOWN (open side down: a raised platform)
      bedItems: [],          // pocket items (see buildPockets)
      bedPocketFit: 0.1,     // mm added to every pocket (0 = tightest friction fit)
      bedBacking: true,      // double layer: a local backing patch under each pocket that needs support (tall items get none)
      bedBackingMargin: 5,   // mm — patch is this much larger than the pocket on every side (glue ledge)
      bedTallItemMin: 50,    // mm — an item rising this far above the bed top needs no base (stands on the box floor)
      bedLayers: 1,          // stacked pocket plates (plate style / upside-down tray): deeper grip for tall acrylic
      bedClearance: 0.5,     // mm per side between bed and body inner walls
      bedThickness: null,    // null = inherit body thickness
      bedMaterialId: null, bedMaterialName: null, bedMaterialColor: null, bedKerf: null,
    };
  }


  /**
   * Foam-style pocket items: { type:'round'|'lamp'|'rect'|'slot'|'bottle'|'acrylic', x, y, w, h, rot, ... }
   *   x,y  = centre, mm from the bed centre.  w,h = size (round: w = diameter).  rot = degrees.
   *   round + cable:true  -> keyhole: circle + cable channel (cableAngle, cableWidth, cableLen) + optional coil pocket (cableCoil dia)
   *   lamp: w = base diameter, cableWidth = slot width (default 60% of w), cableLen = how far the slot reaches past the circle, cableAngle = direction (default 270 = down). Circle + rectangular cable slot with a small step where they meet.
   *   bottle: w = body width, h = total length, neckW, neckLen.   acrylic: w = sheet thickness, h = sheet width.
 *   square: w = side length (h ignored).
 *   radius (rect | square | acrylic | bottle): corner radius in mm, 0 = sharp. Clamped to half the short side.
 *   finger:true (any type): finger slot = round notch merged into the pocket so a fingertip can lift the item out.
 *     fingerAngle (deg from the item's own axis, default 90 = top), fingerWidth (notch diameter, default 20), fingerDepth (reach past the pocket edge, default = half the width).
 *   support: 'double' | 'none' | (blank = auto) — force / forbid the double-layer backing patch for this item.
   */
  const rad = (d) => d * Math.PI / 180;
  function arcPts(cx, cy, r, a0, a1, n) {
    const o = [];
    for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; o.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); }
    return o;
  }
  // circle + channel (+ coil) along +X, one closed outline
  function keyholePath(r1, h, d, r2) {
    const t1 = Math.asin(Math.min(0.95, h / r1)), pts = arcPts(0, 0, r1, t1, 2 * Math.PI - t1, 40);
    if (r2 > h + 1 && d - Math.sqrt(r2 * r2 - h * h) > r1 * Math.cos(t1) + 1) {
      const sx = d - Math.sqrt(r2 * r2 - h * h), f = Math.asin(h / r2);
      pts.push({ x: sx, y: -h });
      pts.push(...arcPts(d, 0, r2, -Math.PI + f, Math.PI - f, 40));
      pts.push({ x: sx, y: h });
    } else { pts.push({ x: d, y: -h }, { x: d, y: h }); }
    return pts;
  }
  // lamp base: full circle + a rectangular cable slot. The slot starts just inside the circle and is slightly wider than the
  // chord there, so the outline has a small step on each side where circle and slot meet (see the "for the cable" sketch).
  function lampPath(r, hw, xe) {
    const c = Math.min(0.83 * hw, r * 0.95), xs = Math.sqrt(r * r - c * c), t = Math.asin(c / r);
    const end = Math.max(xe, xs + 3);
    const pts = arcPts(0, 0, r, t, 2 * Math.PI - t, 60);      // the big arc, from the top step round the far side to the bottom step
    pts.push({ x: xs, y: -Math.max(hw, c) }, { x: end, y: -Math.max(hw, c) }, { x: end, y: Math.max(hw, c) }, { x: xs, y: Math.max(hw, c) });
    return { points: pts, ext: end };
  }

  // ---- smooth corners + finger slot helpers ----
  const signedArea = (P) => P.reduce((s2, q, k) => { const r = P[(k + 1) % P.length]; return s2 + (q.x * r.y - r.x * q.y); }, 0) / 2;
  const asCCW = (P) => (signedArea(P) < 0 ? P.slice().reverse() : P.slice());
  /** Round every corner of a polygon with a fillet of radius `rad` (clamped so neighbouring fillets never collide). */
  function filletPolygon(poly, rad) {
    if (!(rad > 0)) return poly;
    const n = poly.length, out = [];
    for (let i = 0; i < n; i++) {
      const P = poly[i], A = poly[(i + n - 1) % n], B = poly[(i + 1) % n];
      const ax = A.x - P.x, ay = A.y - P.y, bx = B.x - P.x, by = B.y - P.y, la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      if (la < 1e-9 || lb < 1e-9) { out.push(P); continue; }
      const ux = ax / la, uy = ay / la, vx = bx / lb, vy = by / lb;
      const th = Math.acos(Math.max(-1, Math.min(1, ux * vx + uy * vy)));
      if (th > Math.PI - 0.02 || th < 0.02) { out.push(P); continue; }          // (almost) straight: nothing to round
      const tn = Math.tan(th / 2), d = Math.min(rad / tn, Math.min(la, lb) / 2), r = d * tn;
      const bxx = ux + vx, byy = uy + vy, bl = Math.hypot(bxx, byy), dist = r / Math.sin(th / 2);
      const C = { x: P.x + bxx / bl * dist, y: P.y + byy / bl * dist };
      const T1 = { x: P.x + ux * d, y: P.y + uy * d }, T2 = { x: P.x + vx * d, y: P.y + vy * d };
      const a1 = Math.atan2(T1.y - C.y, T1.x - C.x); let da = Math.atan2(T2.y - C.y, T2.x - C.x) - a1;
      while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      const steps = Math.max(3, Math.ceil(Math.abs(da) / (Math.PI / 18)));     // chords of <= 10 degrees
      for (let k = 0; k <= steps; k++) { const a = a1 + da * k / steps; out.push({ x: C.x + r * Math.cos(a), y: C.y + r * Math.sin(a) }); }
    }
    return out;
  }
  function segHit(p, p2, q, q2) {
    const rx = p2.x - p.x, ry = p2.y - p.y, sx = q2.x - q.x, sy = q2.y - q.y, den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) return null;
    const t = ((q.x - p.x) * sy - (q.y - p.y) * sx) / den, u = ((q.x - p.x) * ry - (q.y - p.y) * rx) / den;
    return (t >= 0 && t < 1 && u >= 0 && u < 1) ? { t, u, x: p.x + t * rx, y: p.y + t * ry } : null;
  }
  /** Boolean union of two simple polygons -> ONE outline (null if they do not overlap / cannot be merged cleanly). */
  function unionPolys(A0, B0) {
    const A = asCCW(A0), B = asCCW(B0), ia = A.map(() => []), ib = B.map(() => []); let id = 0;
    for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) {
      const h = segHit(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length]);
      if (h) { ia[i].push({ t: h.t, x: h.x, y: h.y, id }); ib[j].push({ t: h.u, x: h.x, y: h.y, id }); id++; }
    }
    if (!id) { if (B.every(q => pointIn(q, A))) return A; if (A.every(q => pointIn(q, B))) return B; return null; }
    if (id % 2) return null;
    const build = (P, I) => { const o = []; P.forEach((q, i) => { o.push({ x: q.x, y: q.y, id: -1 }); I[i].sort((a, b) => a.t - b.t).forEach(h => o.push({ x: h.x, y: h.y, id: h.id })); }); return o; };
    const LA = build(A, ia), LB = build(B, ib), s0 = LA.findIndex(q => q.id < 0 && !pointIn(q, B));
    if (s0 < 0) return null;
    const out = []; let list = LA, other = LB, i = s0, guard = 0;
    do {
      const q = list[i]; out.push({ x: q.x, y: q.y });
      if (q.id >= 0) { const k = other.findIndex(z => z.id === q.id), t = list; list = other; other = t; i = k; }   // crossing: continue on the other outline
      i = (i + 1) % list.length;
      if (++guard > 20000) return null;
    } while (!(list === LA && i === s0));
    return out;
  }
  // furthest point where a ray from the origin leaves the polygon
  function rayExit(poly, ang) {
    const dx = Math.cos(ang), dy = Math.sin(ang); let best = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], sx = b.x - a.x, sy = b.y - a.y, den = dx * sy - dy * sx;
      if (Math.abs(den) < 1e-12) continue;
      const t = (a.x * sy - a.y * sx) / den, u = (a.x * dy - a.y * dx) / den;
      if (t > 0 && u >= 0 && u <= 1 && t > best) best = t;
    }
    return best;
  }
  // stadium / capsule between p0 and p1 with radius r (p0 == p1 gives a plain circle)
  function capsulePts(p0, p1, r, th) {
    const n = 16, o = [];
    for (let k = 0; k <= n; k++) { const a = th - Math.PI / 2 + Math.PI * k / n; o.push({ x: p1.x + r * Math.cos(a), y: p1.y + r * Math.sin(a) }); }
    for (let k = 0; k <= n; k++) { const a = th + Math.PI / 2 + Math.PI * k / n; o.push({ x: p0.x + r * Math.cos(a), y: p0.y + r * Math.sin(a) }); }
    return o;
  }
  /**
   * FINGER SLOT: a round notch merged into the pocket outline so a fingertip can get beside the item and lift it out.
   *   fingerAngle = side of the item (deg, relative to the item's own rotation; 0 right, 90 up, 180 left, 270 down)
   *   fingerWidth = diameter of the notch,  fingerDepth = how far it reaches past the pocket edge
   * Returns a new 'path' cutout (one closed outline, rotation baked in) or null if it could not be merged.
   */
  function withFingerSlot(c, it, g) {
    const n = (v, d) => (isFinite(parseFloat(v)) ? parseFloat(v) : d);
    const base = PanelGeo.buildCutout(Object.assign({}, c, { x: 0, y: 0 }));
    const r = Math.max(3, n(it.fingerWidth, 20) + g) / 2, depth = Math.max(1, n(it.fingerDepth, r)), th = rad(n(it.rot, 0) + n(it.fingerAngle, 90));
    const e = rayExit(base, th); if (e <= 0) return null;
    const dir = { x: Math.cos(th), y: Math.sin(th) }, edge = { x: dir.x * e, y: dir.y * e };
    const p1 = { x: edge.x + dir.x * (depth - r), y: edge.y + dir.y * (depth - r) }, p0 = depth >= r ? edge : p1;
    const u = unionPolys(base, capsulePts(p0, p1, r, th));
    if (!u) return null;
    return { type: 'path', x: c.x, y: c.y, points: u, rotation: 0, _ext: Math.max(c._ext || 0, ...u.map(q => Math.hypot(q.x, q.y))) };
  }

  function buildPockets(items, fit, kerf) {
    const out = [], errs = [], g = (fit || 0) - (kerf || 0);   // laser removes kerf: draw the hole smaller by it
    (Array.isArray(items) ? items : []).forEach((it, i) => {
      const n = (v, d) => (isFinite(parseFloat(v)) ? parseFloat(v) : d);
      const x = n(it.x, 0), y = n(it.y, 0), w = n(it.w, 0), h = n(it.h, 0), rot = n(it.rot, 0);
      let c = null;
      if (it.type === 'round') {
        if (w < 3) { errs.push(`Item ${i + 1}: diameter too small.`); return; }
        const r = (w + g) / 2;
        if (it.cable) {
          const hw = Math.max(2, n(it.cableWidth, 8) + g) / 2, len = Math.max(r + 5, r + n(it.cableLen, 40));
          const coil = n(it.cableCoil, 0) > 0 ? (n(it.cableCoil, 0) + g) / 2 : 0;
          const d = coil ? len + coil : len;
          c = { type: 'path', x, y, points: keyholePath(r, hw, d, coil), rotation: rot + n(it.cableAngle, 270), _ext: Math.max(r, d + coil) };
        } else c = { type: 'circle', x, y, r, _ext: r };
      } else if (it.type === 'lamp') {
        if (w < 10) { errs.push(`Item ${i + 1}: lamp base diameter too small.`); return; }
        const r = (w + g) / 2, hw = Math.max(3, n(it.cableWidth, Math.round(w * 0.6)) + g) / 2;
        const lp = lampPath(r, hw, r + Math.max(2, n(it.cableLen, 20)));
        c = { type: 'path', x, y, points: lp.points, rotation: rot + n(it.cableAngle, 270), _ext: Math.max(r, lp.ext) };
      } else if (it.type === 'bottle') {
        const bw = (w + g) / 2, nw = (n(it.neckW, w / 3) + g) / 2, L = h + g, nl = n(it.neckLen, h * 0.3), by = -L / 2, sy = L / 2 - nl;
        let pts = [{ x: -bw, y: by }, { x: bw, y: by }, { x: bw, y: sy }, { x: nw, y: sy + Math.min(nl * 0.3, 15) }, { x: nw, y: L / 2 }, { x: -nw, y: L / 2 }, { x: -nw, y: sy + Math.min(nl * 0.3, 15) }, { x: -bw, y: sy }];
        const rr = Math.max(0, n(it.radius, 0)); if (rr > 0.05) pts = filletPolygon(pts, rr);
        c = { type: 'path', x, y, rotation: rot, points: pts, _ext: L / 2 };
      } else if (it.type === 'slot') {
        c = { type: 'slot', x, y, length: Math.max(w, h) + g, width: Math.min(w, h) + g, rotation: rot + (w < h ? 90 : 0), _ext: Math.max(w, h) / 2 };
      } else if (it.type === 'rect' || it.type === 'acrylic' || it.type === 'square') {
        const sh = it.type === 'square' ? w : h;                                   // square: one side length drives both directions
        if (it.type === 'square' && w < 3) { errs.push(`Item ${i + 1}: square side too small.`); return; }
        const rr = Math.min(Math.max(0, n(it.radius, 0)), (Math.min(w, sh) + g) / 2);   // smooth corners: radius can never exceed half the short side
        if (rr > 0.05) {
          const hw = (w + g) / 2, hh = (sh + g) / 2;
          c = { type: 'path', x, y, points: filletPolygon([{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }], rr), rotation: rot, _ext: Math.hypot(w, sh) / 2 };
        } else c = { type: 'rect', x, y, w: w + g, h: sh + g, rotation: rot, _ext: Math.hypot(w, sh) / 2 };
      } else { errs.push(`Item ${i + 1}: unknown type.`); return; }
      if (it.finger) {
        const f = withFingerSlot(c, it, g);
        if (f) c = f; else errs.push(`Item ${i + 1}: the finger slot could not be merged into the pocket (check its side / size).`);
      }
      c.layer = 'cut'; c.source = 'bed-pocket'; c._ext = c._ext || 0; c._idx = i;
      out.push(c);
    });
    return { pockets: out, errors: errs };
  }

  /**
   * Does this pocket item need a solid base under it?  Tall items (itemHeight >= topAboveFloor + tallMin)
   * stand on the box floor through the bed; everything else (flat acrylic, hamper items, unknown height)
   * would fall through a bare hole.
   */
  function itemNeedsBase(it, topAboveFloor, tallMin) {
    if (it && it.support === 'double') return true;     // per-item override: always glue a backing patch under this pocket
    if (it && it.support === 'none') return false;      // per-item override: never (the item stands on the box floor)
    const h = parseFloat(it && it.itemHeight);
    if (!isFinite(h) || h <= 0) return true;
    return h - topAboveFloor < tallMin - 1e-9;
  }

  function pocketExtent(c) { return { hx: c._ext, hy: c._ext }; }  // conservative circle around the item

  const isNum = (v) => typeof v === 'number' && isFinite(v);

  // ---- geometry helpers for the backing patches ----
  const denseEdge = (poly) => { const o = []; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 1.5)); for (let k = 0; k < n; k++) o.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n }); } return o; };
  const pointIn = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i].y > pt.y) !== (poly[j].y > pt.y) && pt.x < (poly[j].x - poly[i].x) * (pt.y - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x) c = !c; return c; };
  const polysOverlap = (A, B) => denseEdge(A).some(q => pointIn(q, B)) || denseEdge(B).some(q => pointIn(q, A));
  function convexHull(pts) {
    const P = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y), cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lo = [], up = [];
    for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 1e-9) lo.pop(); lo.push(p); }
    for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 1e-9) up.pop(); up.push(p); }
    lo.pop(); up.pop(); return lo.concat(up);
  }
  // pocket outline grown outward by r (rounded corners) = hull of the outline, Minkowski-summed with a circle
  function growOutline(poly, r) {
    const hull = convexHull(poly), out = [], N = 32;
    hull.forEach(p => { for (let k = 0; k < N; k++) { const a = 2 * Math.PI * k / N; out.push({ x: p.x + r * Math.cos(a), y: p.y + r * Math.sin(a) }); } });
    return convexHull(out);
  }

  /**
   * @param {object} p   merged parameters
   * @param {object} ctx { L, W, H, tb, bo, Hi, hasBottom, outlineMode, material }
   */
  function buildBed(p, ctx) {
    const errors = [], warnings = [];
    const mat = ctx.material, bt = mat.thickness;
    const bo = ctx.bo || [0, 0, 0];
    const bc = p.bedClearance, elev = p.bedElevation;
    const auto = p.bedHeight === null || p.bedHeight === undefined || p.bedHeight === '';
    let bh = p.bedHeight;

    // ---- double layer: which items need a solid base under the pocket plate? ----
    const pk = buildPockets(p.bedItems, isNum(p.bedPocketFit) ? p.bedPocketFit : 0, mat.kerf || 0);
    const gripLayers = Math.max(1, Math.min(6, Math.round(p.bedLayers || 1)));
    const tallMin = isNum(p.bedTallItemMin) && p.bedTallItemMin >= 0 ? p.bedTallItemMin : 50;
    const ceil0 = ctx.bedCeiling !== undefined ? ctx.bedCeiling : ctx.Hi;
    // top of the bed above the internal floor, ignoring the base (the base only shifts the bed up inside the same envelope)
    const topGuess = p.bedStyle === 'plate' ? (isNum(elev) ? elev : 0) + bt * ((p.bedStyle === 'plate') ? gripLayers : 1)
      : (isNum(elev) ? elev : 0) + (auto ? ceil0 - (isNum(elev) ? elev : 0) : (isNum(bh) ? bh : 0));
    const needBase = pk.pockets.map(c => itemNeedsBase((p.bedItems || [])[c._idx], topGuess, tallMin));
    pk.pockets.forEach(c => { const it = (p.bedItems || [])[c._idx]; if (it && it.support === 'none' && itemNeedsBase(Object.assign({}, it, { support: 'auto' }), topGuess, tallMin)) warnings.push(`[bed] Item ${c._idx + 1} is set to "no backing" but is not tall enough to reach the box floor — it will fall through its pocket.`); });
    const wantBase = p.bedBacking !== false && needBase.some(Boolean);
    const bk = wantBase && isNum(bt) ? bt : 0;          // backing patch thickness (same material as the bed)
    // The patches hang UNDER the pocket plate, so an upright tray / flat plate is lifted by one thickness to make room.
    // An upside-down tray has its pocket plate on top: the patches fit inside the walls, nothing is lifted.
    const flippedTray = p.bedStyle === 'tray' && !!p.bedFlipped;
    const shift = flippedTray ? 0 : bk;
    if (auto && p.bedStyle === 'tray' && isNum(elev)) bh = ceil0 - elev - shift;
    const bad = (code, message) => errors.push({ code, message });

    if (STYLES.indexOf(p.bedStyle) < 0) bad('bed-style', `Unknown bed style "${p.bedStyle}" (use tray or plate).`);
    if (!(isNum(bt) && bt > 0)) bad('bed-thickness', `Bed material thickness must be positive (got ${bt}).`);
    if (!(isNum(bc) && bc >= 0 && bc <= 20)) bad('bed-clearance', `Bed clearance must be between 0 and 20mm per side (got ${bc}).`);
    if (!(isNum(elev) && elev >= 0)) bad('bed-elevation', `Bed elevation must be 0 or more (got ${elev}). It is measured up from the internal floor — a negative value would put the bed through the floor of the box.`);
    if (p.bedStyle === 'tray' && !(isNum(bh) && bh > 0)) bad('bed-height', auto ? `There is no room for an auto-height tray: the bed starts at ${elev}mm but the space under the lid ends at ${ctx.bedCeiling !== undefined ? ctx.bedCeiling : ctx.Hi}mm. Lower the elevation or enter a height.` : `Bed height must be a positive number (got ${bh}).`);
    if (errors.length) return { panels: [], errors, warnings, info: {} };

    const Li = ctx.L - 2 * ctx.tb, Wi = ctx.W - 2 * ctx.tb;
    const bl = Li - 2 * bc, bw = Wi - 2 * bc;
    if (bl < 10 || bw < 10) {
      bad('bed-size', `The bed would be only ${bl.toFixed(1)} × ${bw.toFixed(1)}mm inside the body — too small. Reduce the bed clearance or enlarge the box.`);
      return { panels: [], errors, warnings, info: {} };
    }
    if (p.bedStyle === 'tray' && bh < 3 * bt) {
      bad('bed-height', `A ${bh}mm ${auto ? 'auto-height ' : ''}tray is too short for ${bt}mm material — use at least ${(3 * bt).toFixed(1)}mm, or use the "plate" style.`);
      return { panels: [], errors, warnings, info: {} };
    }

    const x0 = bo[0] + ctx.tb + bc, y0 = bo[1] + ctx.tb + bc;
    const floorZ = bo[2] + (ctx.hasBottom ? ctx.tb : 0);
    const zBase = floorZ + elev;     // underside of the whole bed (= the bottom of the backing patches when there are any)
    const z0 = zBase + shift;        // underside of the tray / pocket plate
    const off = Kerf.resolveOutlineOffset(ctx.outlineMode, mat.kerf);
    let panels;
    let height;

    if (p.bedStyle === 'plate') {
      const flat = () => ({ type: 'flat', outlineOffset: off });
      const plate = BoxGenerator.makePanel('bed-plate', 'Bed Plate', bl, bw, { bottom: flat(), top: flat(), left: flat(), right: flat() });
      Assembly.tagPanel(plate, {
        assemblyId: 'bed', componentType: 'bed-plate', material: mat,
        frame3d: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], origin: [x0, y0, z0] },
        explodeDir: [0, 0, 0.5], joint: 'none (loose insert)', notes: 'Loose false floor; rests on whatever supports you place under it.',
      });
      panels = [plate];
      height = bt;
    } else {
      if (mat.transparent) warnings.push('Finger joints in acrylic are brittle — consider a different bed material.');
      const params = Object.assign({}, p, {
        length: bl, width: bw, height: bh, thickness: bt, kerf: mat.kerf,
        lidStyle: 'none', bottomStyle: 'flat', boxType: 'finger5open',
      });
      const res = BoxGenerator.BoxTypes.finger5open.build(params);
      res.warnings.forEach(w => warnings.push(`[bed] ${w}`));
      const flipped = !!p.bedFlipped;
      const frames = Assembly.boxFrames(bl, bw, bh, bt, flipped ? [0, 0, 0] : [x0, y0, z0]);
      const names = { left: 'Bed Left', right: 'Bed Right', front: 'Bed Front', back: 'Bed Back', bottom: flipped ? 'Bed Top' : 'Bed Bottom' };
      const plateKey = flipped ? 'top' : 'bottom';
      panels = res.panels.map(pn => {
        const key = pn.id;
        pn.id = key === 'bottom' ? 'bed-' + plateKey : 'bed-' + key; pn.name = names[key];
        Assembly.tagPanel(pn, {
          assemblyId: 'bed', componentType: key === 'bottom' ? 'bed-' + plateKey : 'bed-wall', material: mat,
          // upside down = the same panels rotated 180° about X, top face at z0 + height
          frame3d: flipped ? Assembly.rigidFrame(frames[key], 'flipX', [x0, y0 + bw, z0 + bh]) : frames[key],
          explodeDir: [0, 0, 0.5], joint: 'finger joint', notes: 'Loose insert; lift out by hand.',
        });
        return pn;
      });
      height = bh;
    }
    BoxGenerator.computeOutlines(panels);

    // ---- pocket layout (cutouts in the top plate, optional stacked grip plates) ----
    pk.errors.forEach(e => warnings.push(`[bed] ${e}`));
    if (pk.pockets.length) {
      const target = panels.find(pn => /^bed-(plate|top|bottom)$/.test(pn.id));
      const cx = target.W / 2, cy = target.H / 2;
      const PanelGeo = isNode ? require('./panel.js') : root.Panel;
      const cuts = pk.pockets.map(c => { const q = Object.assign({}, c, { x: cx + c.x, y: cy + c.y }); delete q._ext; delete q._idx; return q; });
      const dense = (poly) => { const o = []; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 1.5)); for (let k = 0; k < n; k++) o.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n }); } return o; };
      const inside = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i].y > pt.y) !== (poly[j].y > pt.y) && pt.x < (poly[j].x - poly[i].x) * (pt.y - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x) c = !c; return c; };
      const polys = cuts.map(c => PanelGeo.buildCutout(c));
      polys.forEach((poly, i) => { if (poly.some(q => q.x < 3 || q.x > target.W - 3 || q.y < 3 || q.y > target.H - 3)) warnings.push(`[bed] Item ${i + 1} is closer than 3mm to the bed edge or outside it — move it inward.`); });
      for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) {
        const A = dense(polys[i]), B = dense(polys[j]); let hit = A.some(q => inside(q, polys[j])) || B.some(q => inside(q, polys[i]));
        if (!hit) { outer: for (const q of A) for (const r of B) if (Math.hypot(q.x - r.x, q.y - r.y) < 2) { hit = true; break outer; } }
        if (hit) warnings.push(`[bed] Items ${i + 1} and ${j + 1} overlap or are closer than 2mm — the bridge between them will snap. Move one.`);
      }
      target.cutouts.push(...cuts);
      const layers = gripLayers;
      const canStack = p.bedStyle === 'plate' || !!p.bedFlipped;
      if (layers > 1 && !canStack) warnings.push('[bed] Stacked grip plates need the Flat plate style or an upside-down tray; extra layers were ignored.');
      if (layers > 1 && canStack) {
        const base = target.frame3d, o = base.origin;
        for (let k = 1; k < layers; k++) {
          const ex = BoxGenerator.makePanel('bed-grip-' + k, 'Bed Grip Plate ' + (k + 1), target.W, target.H, { bottom: { type: 'flat', outlineOffset: off }, top: { type: 'flat', outlineOffset: off }, left: { type: 'flat', outlineOffset: off }, right: { type: 'flat', outlineOffset: off } });
          ex.cutouts = cuts.map(c => Object.assign({}, c));
          const zTop = o[2] + k * bt;
          Assembly.tagPanel(ex, { assemblyId: 'bed', componentType: 'bed-plate', material: mat, frame3d: Object.assign({}, base, { origin: [o[0], o[1], zTop] }), explodeDir: [0, 0, 0.5], joint: 'glue to plate below', notes: 'Glue stack: deepens the grip on upright acrylic.' });
          panels.push(ex);
        }
        BoxGenerator.computeOutlines(panels);
        height = p.bedStyle === 'plate' ? bt * layers : height;
      }
    }

    // ---- double layer: a LOCAL backing patch under every pocket that needs support ----
    // The hole stays cut through the top plate; the patch below is solid and a bit bigger than the hole (glue ledge).
    let backInfo = { count: 0, margins: [] };
    const backIdx = pk.pockets.map((c, i) => i).filter(i => needBase[i]);
    if (bk > 0 && backIdx.length) {
      const target = panels.find(pn => /^bed-(plate|top|bottom)$/.test(pn.id));
      const PanelGeo = isNode ? require('./panel.js') : root.Panel;
      const holes = pk.pockets.map(c => PanelGeo.buildCutout(Object.assign({}, c, { x: target.W / 2 + c.x, y: target.H / 2 + c.y })));
      const reqM = isNum(p.bedBackingMargin) && p.bedBackingMargin >= 0 ? p.bedBackingMargin : 5;
      const minM = Math.min(reqM, 3);
      const grow = (i, m) => growOutline(holes[i], Math.max(0.5, m + off));
      const outside = (poly) => poly.some(q => q.x < 1 || q.x > target.W - 1 || q.y < 1 || q.y > target.H - 1);
      const hitsTall = (poly, i) => holes.some((h, j) => j !== i && !needBase[j] && polysOverlap(poly, h));
      const M = {}, PT = {};
      // 1) as wide as asked, but never over the plate edge or across a tall item's hole (that item must reach the floor)
      backIdx.forEach(i => { let m = reqM, poly = grow(i, m); while ((outside(poly) || hitsTall(poly, i)) && m > minM) { m = Math.max(minM, m - 0.5); poly = grow(i, m); } M[i] = m; PT[i] = poly; });
      // 2) two patches must not overlap (they are separate parts): narrow both until they clear
      for (let guard = 0, again = true; again && guard < 40; guard++) {
        again = false;
        for (let a = 0; a < backIdx.length; a++) for (let b = a + 1; b < backIdx.length; b++) {
          const i = backIdx[a], j = backIdx[b];
          if (!polysOverlap(PT[i], PT[j])) continue;
          [i, j].forEach(k => { if (M[k] > minM) { M[k] = Math.max(minM, M[k] - 0.5); PT[k] = grow(k, M[k]); again = true; } });
        }
      }
      const f3 = target.frame3d, o3 = f3.origin;
      const zUnder = f3.z[2] >= 0 ? o3[2] : o3[2] - bt;           // underside of the pocket plate
      const toWorld = (q) => ({ x: o3[0] + f3.x[0] * q.x + f3.y[0] * q.y, y: o3[1] + f3.x[1] * q.x + f3.y[1] * q.y });
      backIdx.forEach((i, n) => {
        let issue = null;
        if (outside(PT[i])) issue = 'runs past the edge of the bed';
        else if (hitsTall(PT[i], i)) issue = 'would block a tall item that has to reach the floor';
        else if (backIdx.some(j => j !== i && polysOverlap(PT[i], PT[j]))) issue = 'touches the backing of a neighbouring item';
        if (issue) warnings.push(`[bed] The backing under item ${i + 1} ${issue}. Move the items further apart.`);
        else if (M[i] < reqM - 1e-9) warnings.push(`[bed] Backing under item ${i + 1} is only ${M[i].toFixed(1)}mm wider than its pocket (asked ${reqM}mm) — neighbours or the bed edge are too close.`);
        let w = PT[i].map(toWorld);
        const ar = w.reduce((s2, q, k) => { const r = w[(k + 1) % w.length]; return s2 + (q.x * r.y - r.x * q.y); }, 0);
        if (ar < 0) w = w.reverse();                                // keep the outline counter-clockwise
        const mnx = Math.min(...w.map(q => q.x)), mny = Math.min(...w.map(q => q.y));
        const outline = w.map(q => ({ x: q.x - mnx, y: q.y - mny }));
        const bw2 = Math.max(...outline.map(q => q.x)), bh2 = Math.max(...outline.map(q => q.y));
        const bp = BoxGenerator.makePanel('bed-backing-' + (i + 1), 'Bed Backing (item ' + (i + 1) + ')', bw2, bh2, {});
        bp.fixedOutline = true; bp.outline = outline;
        Assembly.tagPanel(bp, {
          assemblyId: 'bed', componentType: 'bed-backing', material: mat,
          frame3d: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], origin: [mnx, mny, zUnder - bk] },
          explodeDir: [0, 0, -0.35], joint: 'glue flat against the underside of the pocket plate, centred under the hole',
          notes: `Solid patch (not cut out) so item ${i + 1} rests on it. ${M[i].toFixed(1)}mm larger than the pocket on every side for glue.`,
        });
        panels.push(bp);
        backInfo.margins.push(M[i]);
      });
      backInfo.count = backIdx.length;
    } else if (p.bedBacking === false && needBase.some(Boolean) && pk.pockets.length) {
      warnings.push(`[bed] Double layer is off: ${needBase.filter(Boolean).length} item(s) are not tall enough (need ≥ ${tallMin}mm above the bed top) and will fall through to the box floor.`);
    }

    const top = elev + shift + height;
    if (top > ctx.Hi + 1e-6) {
      warnings.push(`The bed reaches ${top.toFixed(1)}mm above the internal floor — ${(top - ctx.Hi).toFixed(1)}mm ABOVE the body rim. A lid cannot close over it unless the lid is deeper (see the lid skirt).`);
    }

    return {
      panels, errors, warnings,
      info: {
        style: p.bedStyle, flipped: p.bedStyle === 'tray' && !!p.bedFlipped, autoHeight: auto && p.bedStyle === 'tray', length: bl, width: bw, height, elevation: elev, thickness: bt,
        clearancePerSide: bc, topAboveFloor: top, headroomAbove: ctx.Hi - top, underBed: elev,
        doubleLayer: backInfo.count > 0, baseThickness: shift, backingThickness: bk, backingCount: backInfo.count, backingMargins: backInfo.margins, tallItems: needBase.filter(v => !v).length, supportedItems: needBase.filter(Boolean).length, tallItemMin: tallMin,
      },
    };
  }

  const InnerBed = { bedDefaults, buildBed, buildPockets, itemNeedsBase, filletPolygon, unionPolys, STYLES };
  if (isNode) module.exports = InnerBed;
  else root.InnerBed = InnerBed;
})(typeof window !== 'undefined' ? window : globalThis);
