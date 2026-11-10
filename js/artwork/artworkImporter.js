/**
 * artworkImporter.js — turns an uploaded SVG or DXF file into a flat list of
 * polyline "subpaths" in millimeters: `{ subpaths: [{points:[{x,y}], closed}],
 * bounds }`. This is the only place that has to deal with SVG path-data
 * grammar or DXF group codes — everything downstream (artworkMapper.js,
 * the exporters, the 3D preview) only ever sees plain polylines, exactly
 * like every other piece of geometry in this app.
 *
 * Deliberately dependency-free (no external SVG/DXF parsing library) so the
 * app keeps working fully offline with zero install.
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const V = isNode ? require('../geometry/vec2.js') : root.Vec2;

  // ------------------------------------------------------------------
  // SVG path `d` grammar -> polyline
  // ------------------------------------------------------------------

  const CURVE_STEPS = 16; // samples per bezier/arc segment — enough for laser-scale artwork

  function tokenizePathData(d) {
    const tokens = [];
    const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
    let m;
    while ((m = re.exec(d))) tokens.push(m[1] || m[2]);
    return tokens;
  }

  function cubicBezierPoint(p0, p1, p2, p3, t) {
    const mt = 1 - t;
    const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, e = t * t * t;
    return { x: a * p0.x + b * p1.x + c * p2.x + e * p3.x, y: a * p0.y + b * p1.y + c * p2.y + e * p3.y };
  }
  function quadBezierPoint(p0, p1, p2, t) {
    const mt = 1 - t;
    return { x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x, y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y };
  }

  /** SVG elliptical-arc-to-center conversion (spec-standard formula), returns sampled points. */
  function arcPoints(p0, rx, ry, xAxisRotDeg, largeArc, sweep, p1) {
    if (rx === 0 || ry === 0) return [p1];
    const phi = (xAxisRotDeg * Math.PI) / 180;
    const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
    const dx2 = (p0.x - p1.x) / 2, dy2 = (p0.y - p1.y) / 2;
    const x1p = cosPhi * dx2 + sinPhi * dy2;
    const y1p = -sinPhi * dx2 + cosPhi * dy2;
    rx = Math.abs(rx); ry = Math.abs(ry);
    let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }
    const sign = largeArc !== sweep ? 1 : -1;
    const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    const coef = sign * Math.sqrt(Math.max(num / den, 0));
    const cxp = coef * (rx * y1p) / ry;
    const cyp = coef * -(ry * x1p) / rx;
    const cx = cosPhi * cxp - sinPhi * cyp + (p0.x + p1.x) / 2;
    const cy = sinPhi * cxp + cosPhi * cyp + (p0.y + p1.y) / 2;
    const angle = (ux, uy, vx, vy) => {
      const sgn = ux * vy - uy * vx < 0 ? -1 : 1;
      const dot = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy))));
      return sgn * Math.acos(dot);
    };
    const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dTheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
    if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

    const pts = [];
    for (let i = 1; i <= CURVE_STEPS; i++) {
      const t = theta1 + (dTheta * i) / CURVE_STEPS;
      const x = cosPhi * rx * Math.cos(t) - sinPhi * ry * Math.sin(t) + cx;
      const y = sinPhi * rx * Math.cos(t) + cosPhi * ry * Math.sin(t) + cy;
      pts.push({ x, y });
    }
    return pts;
  }

  /** Parses an SVG path `d` attribute into one or more polyline subpaths. */
  function parsePathD(d) {
    const tokens = tokenizePathData(d);
    const subpaths = [];
    let current = null;
    let cur = { x: 0, y: 0 };
    let start = { x: 0, y: 0 };
    let lastCtrl = null; // for S/T reflection
    let i = 0;
    let cmd = null;

    const readNum = () => parseFloat(tokens[i++]);
    const pushPoint = (p) => { if (current) current.points.push(p); };

    while (i < tokens.length) {
      const tok = tokens[i];
      if (/^[a-zA-Z]$/.test(tok)) { cmd = tok; i++; } // else: repeated implicit command, reuse `cmd`
      const rel = cmd === cmd.toLowerCase();
      const C = cmd.toUpperCase();

      if (C === 'M') {
        const x = readNum() + (rel ? cur.x : 0), y = readNum() + (rel ? cur.y : 0);
        current = { points: [{ x, y }], closed: false };
        subpaths.push(current);
        cur = { x, y }; start = { x, y }; lastCtrl = null;
        cmd = rel ? 'l' : 'L'; // subsequent implicit pairs are lineto
      } else if (C === 'L') {
        const x = readNum() + (rel ? cur.x : 0), y = readNum() + (rel ? cur.y : 0);
        pushPoint({ x, y }); cur = { x, y }; lastCtrl = null;
      } else if (C === 'H') {
        const x = readNum() + (rel ? cur.x : 0);
        pushPoint({ x, y: cur.y }); cur = { x, y: cur.y }; lastCtrl = null;
      } else if (C === 'V') {
        const y = readNum() + (rel ? cur.y : 0);
        pushPoint({ x: cur.x, y }); cur = { x: cur.x, y }; lastCtrl = null;
      } else if (C === 'C') {
        const x1 = readNum() + (rel ? cur.x : 0), y1 = readNum() + (rel ? cur.y : 0);
        const x2 = readNum() + (rel ? cur.x : 0), y2 = readNum() + (rel ? cur.y : 0);
        const x = readNum() + (rel ? cur.x : 0), y = readNum() + (rel ? cur.y : 0);
        for (let s = 1; s <= CURVE_STEPS; s++) pushPoint(cubicBezierPoint(cur, { x: x1, y: y1 }, { x: x2, y: y2 }, { x, y }, s / CURVE_STEPS));
        lastCtrl = { x: x2, y: y2 }; cur = { x, y };
      } else if (C === 'S') {
        const x2 = readNum() + (rel ? cur.x : 0), y2 = readNum() + (rel ? cur.y : 0);
        const x = readNum() + (rel ? cur.x : 0), y = readNum() + (rel ? cur.y : 0);
        const x1 = lastCtrl ? 2 * cur.x - lastCtrl.x : cur.x, y1 = lastCtrl ? 2 * cur.y - lastCtrl.y : cur.y;
        for (let s = 1; s <= CURVE_STEPS; s++) pushPoint(cubicBezierPoint(cur, { x: x1, y: y1 }, { x: x2, y: y2 }, { x, y }, s / CURVE_STEPS));
        lastCtrl = { x: x2, y: y2 }; cur = { x, y };
      } else if (C === 'Q') {
        const x1 = readNum() + (rel ? cur.x : 0), y1 = readNum() + (rel ? cur.y : 0);
        const x = readNum() + (rel ? cur.x : 0), y = readNum() + (rel ? cur.y : 0);
        for (let s = 1; s <= CURVE_STEPS; s++) pushPoint(quadBezierPoint(cur, { x: x1, y: y1 }, { x, y }, s / CURVE_STEPS));
        lastCtrl = { x: x1, y: y1 }; cur = { x, y };
      } else if (C === 'T') {
        const x = readNum() + (rel ? cur.x : 0), y = readNum() + (rel ? cur.y : 0);
        const x1 = lastCtrl ? 2 * cur.x - lastCtrl.x : cur.x, y1 = lastCtrl ? 2 * cur.y - lastCtrl.y : cur.y;
        for (let s = 1; s <= CURVE_STEPS; s++) pushPoint(quadBezierPoint(cur, { x: x1, y: y1 }, { x, y }, s / CURVE_STEPS));
        lastCtrl = { x: x1, y: y1 }; cur = { x, y };
      } else if (C === 'A') {
        const rx = readNum(), ry = readNum(), rot = readNum();
        const largeArc = readNum() !== 0, sweep = readNum() !== 0;
        const x = readNum() + (rel ? cur.x : 0), y = readNum() + (rel ? cur.y : 0);
        const pts = arcPoints(cur, rx, ry, rot, largeArc, sweep, { x, y });
        for (const pt of pts) pushPoint(pt);
        cur = { x, y }; lastCtrl = null;
      } else if (C === 'Z') {
        if (current) { current.closed = true; pushPoint({ x: start.x, y: start.y }); }
        cur = { x: start.x, y: start.y }; lastCtrl = null;
      } else {
        i++; // unknown command — skip token defensively rather than infinite-loop
      }
    }
    return subpaths;
  }

  // ------------------------------------------------------------------
  // SVG shape elements -> polylines, with transform + viewBox handling
  // ------------------------------------------------------------------

  function matMul(a, b) {
    return [
      a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
    ];
  }
  function applyMat(m, p) { return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }; }
  const IDENTITY = [1, 0, 0, 1, 0, 0];

  function parseTransform(str) {
    if (!str) return IDENTITY;
    let m = IDENTITY;
    const re = /(translate|scale|rotate|matrix|skewX|skewY)\(([^)]*)\)/g;
    let match;
    while ((match = re.exec(str))) {
      const nums = match[2].trim().split(/[\s,]+/).map(Number);
      let mm = IDENTITY;
      if (match[1] === 'translate') mm = [1, 0, 0, 1, nums[0] || 0, nums[1] || 0];
      else if (match[1] === 'scale') mm = [nums[0], 0, 0, nums[1] === undefined ? nums[0] : nums[1], 0, 0];
      else if (match[1] === 'rotate') {
        const a = (nums[0] * Math.PI) / 180;
        mm = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
        if (nums.length >= 3) {
          mm = matMul(matMul([1, 0, 0, 1, nums[1], nums[2]], mm), [1, 0, 0, 1, -nums[1], -nums[2]]);
        }
      } else if (match[1] === 'matrix') mm = nums;
      m = matMul(m, mm);
    }
    return m;
  }

  function parseLengthToMm(val, fallbackUnit) {
    if (val == null) return null;
    const m = String(val).match(/([\d.eE+-]+)\s*(mm|cm|in|px)?/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    const unit = m[2] || fallbackUnit || 'px';
    const factor = { mm: 1, cm: 10, in: 25.4, px: 25.4 / 96 }[unit];
    return n * factor;
  }

  function svgElementToSubpaths(el, mat) {
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    const out = [];
    if (tag === 'path') {
      const d = el.getAttribute('d');
      if (d) for (const sp of parsePathD(d)) out.push({ points: sp.points.map(p => applyMat(mat, p)), closed: sp.closed });
    } else if (tag === 'rect') {
      const x = parseFloat(el.getAttribute('x') || 0), y = parseFloat(el.getAttribute('y') || 0);
      const w = parseFloat(el.getAttribute('width') || 0), h = parseFloat(el.getAttribute('height') || 0);
      const pts = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }].map(p => applyMat(mat, p));
      out.push({ points: pts, closed: true });
    } else if (tag === 'circle' || tag === 'ellipse') {
      const cx = parseFloat(el.getAttribute('cx') || 0), cy = parseFloat(el.getAttribute('cy') || 0);
      const rx = parseFloat(el.getAttribute('rx') || el.getAttribute('r') || 0);
      const ry = parseFloat(el.getAttribute('ry') || el.getAttribute('r') || 0);
      const pts = [];
      for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; pts.push(applyMat(mat, { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) })); }
      out.push({ points: pts, closed: true });
    } else if (tag === 'line') {
      const p1 = { x: parseFloat(el.getAttribute('x1') || 0), y: parseFloat(el.getAttribute('y1') || 0) };
      const p2 = { x: parseFloat(el.getAttribute('x2') || 0), y: parseFloat(el.getAttribute('y2') || 0) };
      out.push({ points: [applyMat(mat, p1), applyMat(mat, p2)], closed: false });
    } else if (tag === 'polyline' || tag === 'polygon') {
      const raw = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
      const pts = [];
      for (let i = 0; i + 1 < raw.length; i += 2) pts.push(applyMat(mat, { x: raw[i], y: raw[i + 1] }));
      out.push({ points: pts, closed: tag === 'polygon' });
    }
    return out;
  }

  function walkSvg(el, parentMat, subpaths) {
    const localMat = matMul(parentMat, parseTransform(el.getAttribute && el.getAttribute('transform')));
    if (el.tagName) {
      for (const sp of svgElementToSubpaths(el, localMat)) subpaths.push(sp);
    }
    for (const child of Array.from(el.children || [])) walkSvg(child, localMat, subpaths);
  }

  /**
   * @param {string} svgText
   * @returns {{subpaths, bounds}} all coordinates in millimeters, with Y
   *   still pointing DOWN (SVG convention) — artworkMapper.js flips it
   *   when placing onto a panel, matching how the rest of the app handles
   *   the SVG-vs-panel Y-axis difference.
   */
  function parseSVG(svgText) {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const svgEl = doc.documentElement;
    if (!svgEl || svgEl.tagName.toLowerCase() !== 'svg') throw new Error('Not a valid SVG file.');

    const widthAttr = svgEl.getAttribute('width');
    const viewBox = (svgEl.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    let scale = 1;
    if (widthAttr && viewBox.length === 4 && viewBox[2] > 0) {
      const widthMm = parseLengthToMm(widthAttr);
      if (widthMm) scale = widthMm / viewBox[2];
    } else if (widthAttr) {
      const wmm = parseLengthToMm(widthAttr);
      scale = wmm ? wmm / (parseFloat(widthAttr) || 1) : 25.4 / 96;
    } else {
      scale = 25.4 / 96; // assume 96dpi px if nothing else is specified
    }

    const rootMat = [scale, 0, 0, scale, 0, 0];
    const subpaths = [];
    walkSvg(svgEl, rootMat, subpaths);
    const allPoints = subpaths.flatMap(sp => sp.points);
    const bounds = allPoints.length ? V.bounds(allPoints) : { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    return { subpaths, bounds, sourceFormat: 'svg' };
  }

  // ------------------------------------------------------------------
  // DXF (ASCII) -> polylines
  // ------------------------------------------------------------------

  function readEntityFields(pairs, startIdx, codes) {
    const out = {};
    let j = startIdx + 1;
    while (j < pairs.length && pairs[j][0] !== 0) {
      if (codes.includes(String(pairs[j][0]))) out[pairs[j][0]] = parseFloat(pairs[j][1]);
      j++;
    }
    return out;
  }

  function parseDXF(dxfText) {
    const lines = dxfText.split(/\r\n|\r|\n/);
    const pairs = [];
    for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);

    let unitScale = 1; // default: assume mm already
    for (let i = 0; i < pairs.length - 1; i++) {
      if (pairs[i][1] === '$INSUNITS') {
        const v = parseInt(pairs[i + 1][1], 10);
        unitScale = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 }[v] || 1;
        break;
      }
    }

    const subpaths = [];
    let start = pairs.findIndex((p) => p[0] === 2 && p[1] === 'ENTITIES');
    if (start === -1) start = 0;

    for (let i = start; i < pairs.length; i++) {
      if (pairs[i][0] !== 0) continue;
      const type = pairs[i][1];
      if (type === 'LINE') {
        const e = readEntityFields(pairs, i, ['10', '20', '11', '21']);
        subpaths.push({ points: [{ x: e['10'] * unitScale, y: e['20'] * unitScale }, { x: e['11'] * unitScale, y: e['21'] * unitScale }], closed: false });
      } else if (type === 'CIRCLE') {
        const e = readEntityFields(pairs, i, ['10', '20', '40']);
        const pts = [];
        for (let k = 0; k < 48; k++) { const a = (k / 48) * Math.PI * 2; pts.push({ x: (e['10'] + e['40'] * Math.cos(a)) * unitScale, y: (e['20'] + e['40'] * Math.sin(a)) * unitScale }); }
        subpaths.push({ points: pts, closed: true });
      } else if (type === 'ARC') {
        const e = readEntityFields(pairs, i, ['10', '20', '40', '50', '51']);
        const pts = [];
        let a0 = (e['50'] * Math.PI) / 180, a1 = (e['51'] * Math.PI) / 180;
        if (a1 < a0) a1 += Math.PI * 2;
        for (let k = 0; k <= CURVE_STEPS; k++) { const a = a0 + ((a1 - a0) * k) / CURVE_STEPS; pts.push({ x: (e['10'] + e['40'] * Math.cos(a)) * unitScale, y: (e['20'] + e['40'] * Math.sin(a)) * unitScale }); }
        subpaths.push({ points: pts, closed: false });
      } else if (type === 'LWPOLYLINE') {
        const pts = [];
        let closed = false;
        let j = i + 1;
        let x = null;
        while (j < pairs.length && pairs[j][0] !== 0) {
          if (pairs[j][0] === 70) closed = (parseInt(pairs[j][1], 10) & 1) === 1;
          if (pairs[j][0] === 10) x = parseFloat(pairs[j][1]);
          if (pairs[j][0] === 20 && x !== null) { pts.push({ x: x * unitScale, y: parseFloat(pairs[j][1]) * unitScale }); x = null; }
          j++;
        }
        subpaths.push({ points: pts, closed });
      } else if (type === 'POLYLINE') {
        const pts = [];
        let closed = false;
        let j = i + 1;
        while (j < pairs.length && !(pairs[j][0] === 0 && pairs[j][1] === 'SEQEND')) {
          if (pairs[j][0] === 70 && j === i + 1) closed = (parseInt(pairs[j][1], 10) & 1) === 1;
          if (pairs[j][0] === 0 && pairs[j][1] === 'VERTEX') {
            const v = readEntityFields(pairs, j, ['10', '20']);
            pts.push({ x: v['10'] * unitScale, y: v['20'] * unitScale });
          }
          j++;
        }
        subpaths.push({ points: pts, closed });
      }
    }
    const allPoints = subpaths.flatMap(sp => sp.points);
    const bounds = allPoints.length ? V.bounds(allPoints) : { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    return { subpaths, bounds, sourceFormat: 'dxf' };
  }

  function parseFile(filename, text) {
    const ext = (filename.split('.').pop() || '').toLowerCase();
    if (ext === 'svg') return parseSVG(text);
    if (ext === 'dxf') return parseDXF(text);
    throw new Error(`Unsupported artwork format: .${ext} (only .svg and .dxf are supported)`);
  }

  const ArtworkImporter = { parseSVG, parseDXF, parseFile, parsePathD };
  if (typeof module !== 'undefined' && module.exports) module.exports = ArtworkImporter;
  else root.ArtworkImporter = ArtworkImporter;
})(typeof window !== 'undefined' ? window : globalThis);
