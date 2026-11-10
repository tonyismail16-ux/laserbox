/**
 * shapeBox.js — non-rectangular "layered" boxes (heart, star, arch, tree, ...).
 *
 * Built from flat layers, no joints needed:
 *   shape-base      solid floor in the chosen outline
 *   shape-ring-N    outline with an inner opening (wall width = shapeWall), glued up
 *                   in a stack; layers = round(height / thickness) - 1
 *   lid-top         full outline, rests on the top ring (so it is always supported)
 *   lid-plug        smaller copy of the opening (− 2·clearance) glued under lid-top
 * length × width = bounding box of the shape; height = base + wall layers.
 */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const BoxGenerator = isNode ? require('./boxGenerator.js') : root.BoxGenerator;
  const Assembly = isNode ? require('./assembly.js') : root.Assembly;
  const Kerf = isNode ? require('./kerf.js') : root.Kerf;

  const SHAPES = {
    heart: 'Heart', star5: 'Star (5 point)', star8: 'Star (8 point, Islamic)', hexagon: 'Hexagon', octagon: 'Octagon',
    circle: 'Circle / oval', flower: 'Flower (scalloped)', diamond: 'Diamond / gem', tree: 'Christmas tree', arch: 'Arch / mosque window',
  };

  function ngon(n, rot) { const a = []; for (let i = 0; i < n; i++) { const t = rot + (i / n) * 2 * Math.PI; a.push([Math.cos(t), Math.sin(t)]); } return a; }
  function star(n, ratio) { const a = []; for (let i = 0; i < n * 2; i++) { const t = Math.PI / 2 + (i / (n * 2)) * 2 * Math.PI, r = i % 2 ? ratio : 1; a.push([r * Math.cos(t), r * Math.sin(t)]); } return a; }
  function raw(type) {
    const N = 120, pts = [];
    switch (type) {
      case 'heart': for (let i = 0; i < N; i++) { const t = (i / N) * 2 * Math.PI; pts.push([16 * Math.pow(Math.sin(t), 3), 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)]); } return pts;
      case 'star5': return star(5, 0.46);
      case 'star8': return star(8, 0.72);
      case 'hexagon': return ngon(6, 0);
      case 'octagon': return ngon(8, Math.PI / 8);
      case 'circle': return ngon(N, 0);
      case 'flower': for (let i = 0; i < N * 2; i++) { const t = (i / (N * 2)) * 2 * Math.PI, r = 1 + 0.12 * Math.cos(8 * t); pts.push([r * Math.cos(t), r * Math.sin(t)]); } return pts;
      case 'diamond': return [[0, 1], [0.62, 0.35], [1, 0.35], [0.5, -1], [-0.5, -1], [-1, 0.35], [-0.62, 0.35]];
      case 'tree': return [[0, 1], [0.45, 0.45], [0.22, 0.45], [0.7, -0.05], [0.4, -0.05], [0.95, -0.6], [0.14, -0.6], [0.14, -1], [-0.14, -1], [-0.14, -0.6], [-0.95, -0.6], [-0.4, -0.05], [-0.7, -0.05], [-0.22, 0.45], [-0.45, 0.45]];
      case 'arch': { for (let i = 0; i <= 48; i++) { const t = (i / 48) * Math.PI; pts.push([Math.cos(t), 0.2 + 0.8 * Math.sin(t)]); } pts.push([-1, -1], [1, -1]); return pts; }
      default: return ngon(6, 0);
    }
  }
  function area(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i].x * q.y - q.x * p[i].y; } return a / 2; }
  function fit(type, W, H) {
    const r = raw(type); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    r.forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
    let pts = r.map(([x, y]) => ({ x: ((x - x0) / (x1 - x0)) * W, y: ((y - y0) / (y1 - y0)) * H }));
    if (area(pts) < 0) pts.reverse();
    return pts;
  }
  /** Miter offset; d > 0 shrinks (CCW polygon), d < 0 grows. */
  function offset(pts, d) {
    const n = pts.length, out = [];
    for (let i = 0; i < n; i++) {
      const a = pts[(i + n - 1) % n], b = pts[i], c = pts[(i + 1) % n];
      let e1 = { x: b.x - a.x, y: b.y - a.y }, e2 = { x: c.x - b.x, y: c.y - b.y };
      const l1 = Math.hypot(e1.x, e1.y) || 1, l2 = Math.hypot(e2.x, e2.y) || 1;
      const n1 = { x: -e1.y / l1, y: e1.x / l1 }, n2 = { x: -e2.y / l2, y: e2.x / l2 };
      let bx = n1.x + n2.x, by = n1.y + n2.y; const bl = Math.hypot(bx, by) || 1; bx /= bl; by /= bl;
      const k = Math.min(1 / Math.max(bx * n1.x + by * n1.y, 0.35), 2.8);
      out.push({ x: b.x + bx * d * k, y: b.y + by * d * k });
    }
    return cleanLoops(out);
  }
  function segHit(a, b, c, d) {
    const r = { x: b.x - a.x, y: b.y - a.y }, q = { x: d.x - c.x, y: d.y - c.y }, den = r.x * q.y - r.y * q.x;
    if (Math.abs(den) < 1e-9) return null;
    const t = ((c.x - a.x) * q.y - (c.y - a.y) * q.x) / den, u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
    return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6 ? { x: a.x + t * r.x, y: a.y + t * r.y } : null;
  }
  /** Remove the small folded-over loops a miter offset leaves at sharp tips. */
  function cleanLoops(pts) {
    let poly = pts.slice();
    for (let guard = 0; guard < 40; guard++) {
      let found = false;
      const n = poly.length;
      outer: for (let i = 0; i < n; i++) {
        for (let j = i + 2; j < n; j++) {
          if (i === 0 && j === n - 1) continue;
          const X = segHit(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n]);
          if (!X) continue;
          const A = [X].concat(poly.slice(i + 1, j + 1)), B = poly.slice(0, i + 1).concat([X], poly.slice(j + 1));
          poly = Math.abs(area(A)) > Math.abs(area(B)) ? A : B; found = true; break outer;
        }
      }
      if (!found) break;
    }
    if (area(poly) < 0) poly.reverse();
    return poly;
  }
  const shift = (pts, dx, dy) => pts.map(p => ({ x: p.x + dx, y: p.y + dy }));

  function build(raw0) {
    const p = raw0, errors = [], warnings = [];
    const body = Assembly.resolveMaterial(p, 'body'), lid = Assembly.resolveMaterial(p, 'lid');
    const t = body.thickness, lt = lid.thickness || t;
    const W = p.length, H = p.width, type = SHAPES[p.shapeType] ? p.shapeType : 'heart';
    const wall = p.shapeWall, cl = p.shapeLidClearance;
    const layers = Math.max(1, Math.round(p.height / t) - 1);
    if (!(W >= 30 && H >= 30)) errors.push({ code: 'shape-size', message: `Shape size must be at least 30 × 30mm (got ${W} × ${H}).` });
    if (!(typeof wall === 'number' && wall >= 3 * t * 0.5 && wall < Math.min(W, H) / 3)) errors.push({ code: 'shape-wall', message: `Wall width must be between ${(1.5 * t).toFixed(1)}mm and ${(Math.min(W, H) / 3).toFixed(1)}mm (got ${wall}).` });
    if (!(typeof cl === 'number' && cl >= 0 && cl <= 2)) errors.push({ code: 'shape-clearance', message: `Lid clearance must be 0–2mm (got ${cl}).` });
    if (errors.length) return { panels: [], warnings, errors, info: {} };

    const off = Kerf.resolveOutlineOffset(p.outlineCompensation, body.kerf);
    const outer = fit(type, W, H);
    const inner = offset(outer, wall);
    if (Math.abs(area(inner)) < 50 || area(inner) < 0) return { panels: [], warnings, errors: [{ code: 'shape-inner', message: `A ${wall}mm wall leaves no usable opening in this shape. Reduce the wall width.` }], info: {} };
    if (type === 'star5' || type === 'tree') warnings.push('Sharp points make fragile cuts and the inside offset is approximate in the tips — use a wider wall and handle gently.');
    const plugShape = offset(inner, cl);
    const outerC = offset(outer, -off), innerC = offset(inner, off), plugC = offset(plugShape, -off);
    // normalise so the cut outline's bounding box starts at (0,0)
    const mnx = Math.min(...outerC.map(q => q.x)), mny = Math.min(...outerC.map(q => q.y));
    const bw = Math.max(...outerC.map(q => q.x)) - mnx, bh = Math.max(...outerC.map(q => q.y)) - mny;
    const O = shift(outerC, -mnx, -mny), I = shift(innerC, -mnx, -mny), PL = shift(plugC, -mnx, -mny);
    const bb = (pts) => ({ w: Math.max(...pts.map(q => q.x)), h: Math.max(...pts.map(q => q.y)) });

    const panels = [];
    const mk = (id, name, outline, comp, mat, asm, z, ex, cut, th, ox, oy) => {
      const b = bb(outline), pn = BoxGenerator.makePanel(id, name, b.w, b.h, {});
      pn.fixedOutline = true; pn.outline = outline;
      if (cut) pn.cutouts.push({ type: 'path', x: 0, y: 0, points: cut, layer: 'cut' });
      Assembly.tagPanel(pn, { assemblyId: asm, componentType: comp, material: mat, frame3d: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], origin: [ox || 0, oy || 0, z] }, explodeDir: [0, 0, ex], joint: 'glued stack', notes: 'Glue flat layers with edges aligned.' });
      pn.thickness = th; panels.push(pn);
    };
    mk('shape-base', 'Base', O, 'shape-base', body, 'body', 0, 0, null, t);
    for (let i = 1; i <= layers; i++) mk('shape-ring-' + i, 'Wall layer ' + i, O, 'shape-wall', body, 'body', t * i, i * 0.35, I, t);
    const zTop = t * (layers + 1);
    const pmx = Math.min(...PL.map(q => q.x)), pmy = Math.min(...PL.map(q => q.y));
    mk('lid-top', 'Lid Top', O, 'lid-top', lid, 'lid', zTop, (layers + 1) * 0.35 + 0.6, null, lt);
    const top = panels[panels.length - 1];
    if ((p.shapeEngraveText || '').trim()) top.engravings.push({ type: 'text', x: bw / 2, y: bh / 2, size: Math.max(6, Math.min(bw, bh) / 9), anchor: 'middle', text: p.shapeEngraveText.trim(), layer: 'engrave' });
    mk('lid-plug', 'Lid Plug', shift(PL, -pmx, -pmy), 'lid-plug', lid, 'lid', zTop - lt, (layers + 1) * 0.35 + 0.3, null, lt, pmx, pmy);
    if (lt > t) warnings.push('Lid is thicker than the wall layer — the plug sits deeper than the rim.');

    const total = t * (layers + 1) + lt;
    return {
      panels, warnings, errors,
      info: {
        shapeBox: true, shape: type, layers, wallWidth: wall, bounds: { length: bw, width: bh }, innerDepth: layers * t, totalHeight: total,
        assembledBounds: { min: [0, 0, 0], max: [bw, bh, total], size: [bw, bh, total] },
      },
    };
  }

  function register() { BoxGenerator.BoxTypes.shapeBox = { label: 'Shaped Box (heart, star, ornament…)', build, defaults: {} }; }
  register();
  const ShapeBox = { build, SHAPES, fit, offset };
  if (isNode) module.exports = ShapeBox; else root.ShapeBox = ShapeBox;
})(typeof window !== 'undefined' ? window : globalThis);
