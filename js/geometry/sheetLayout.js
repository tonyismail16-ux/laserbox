/**
 * sheetLayout.js — arranges panels onto one or more sheets.
 *
 * Uses a MaxRects bin packer (tracks every free rectangle left on a sheet, so
 * small parts fill the gaps beside and under big ones instead of being
 * wasted like in a row/"shelf" packer). Because no single heuristic is best
 * for every part set, pack() runs many candidate strategies — several sort
 * orders x several placement rules x two sheet-selection modes, followed by a
 * deterministic (seeded) randomized search — and keeps the best result:
 *   1. fewest sheets,
 *   2. then the emptiest last sheet (waste is concentrated into one reusable
 *      offcut instead of being spread over every sheet),
 *   3. then the smallest bounding area on that last sheet.
 * Results are fully deterministic for the same input.
 *
 * Entry point is unchanged: pack(items, sheet) / packGroups(items, sheet).
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const V = isNode ? require('./vec2.js') : root.Vec2; // eslint-disable-line no-unused-vars
  const EPS = 1e-6;

  // ---------------------------------------------------------------- MaxRects
  function Bin(w, h) {
    this.w = w; this.h = h;
    this.free = [{ x: 0, y: 0, w, h }];
    this.placed = [];   // {x,y,w,h} in inflated (spacing-included) units
    this.used = 0;      // sum of true part areas
    this.maxX = 0; this.maxY = 0;
  }

  function contactScore(bin, x, y, w, h) {
    let score = 0;
    if (x < EPS || Math.abs(x + w - bin.w) < EPS) score += h;
    if (y < EPS || Math.abs(y + h - bin.h) < EPS) score += w;
    for (const r of bin.placed) {
      if (Math.abs(r.x + r.w - x) < EPS || Math.abs(x + w - r.x) < EPS) {
        const o = Math.min(y + h, r.y + r.h) - Math.max(y, r.y);
        if (o > 0) score += o;
      }
      if (Math.abs(r.y + r.h - y) < EPS || Math.abs(y + h - r.y) < EPS) {
        const o = Math.min(x + w, r.x + r.w) - Math.max(x, r.x);
        if (o > 0) score += o;
      }
    }
    return score;
  }

  // Lower score = better. Returns [primary, secondary] for the free rect `f`.
  function scoreFor(rule, bin, f, x, y, w, h) {
    const lw = f.w - w, lh = f.h - h;
    switch (rule) {
      case 'BSSF': return [Math.min(lw, lh), Math.max(lw, lh)];
      case 'BLSF': return [-Math.max(lw, lh), -Math.min(lw, lh)];
      case 'BAF': return [f.w * f.h - w * h, Math.min(lw, lh)];
      case 'BL': return [y + h, x];
      case 'CP': return [-contactScore(bin, x, y, w, h), Math.min(lw, lh)];
      default: return [0, 0];
    }
  }

  function findBest(bin, rule, w, h) {
    let best = null;
    for (const f of bin.free) {
      if (w <= f.w + EPS && h <= f.h + EPS) {
        const sc = scoreFor(rule, bin, f, f.x, f.y, w, h);
        if (!best || sc[0] < best.s1 - EPS || (Math.abs(sc[0] - best.s1) <= EPS && sc[1] < best.s2 - EPS)) {
          best = { x: f.x, y: f.y, s1: sc[0], s2: sc[1] };
        }
      }
    }
    return best;
  }

  function placeInBin(bin, x, y, w, h, trueArea) {
    const out = [];
    for (const f of bin.free) {
      if (x >= f.x + f.w - EPS || x + w <= f.x + EPS || y >= f.y + f.h - EPS || y + h <= f.y + EPS) { out.push(f); continue; }
      if (x > f.x + EPS) out.push({ x: f.x, y: f.y, w: x - f.x, h: f.h });
      if (x + w < f.x + f.w - EPS) out.push({ x: x + w, y: f.y, w: f.x + f.w - (x + w), h: f.h });
      if (y > f.y + EPS) out.push({ x: f.x, y: f.y, w: f.w, h: y - f.y });
      if (y + h < f.y + f.h - EPS) out.push({ x: f.x, y: y + h, w: f.w, h: f.y + f.h - (y + h) });
    }
    // prune free rects fully contained in another
    const keep = [];
    for (let i = 0; i < out.length; i++) {
      let contained = false;
      const a = out[i];
      for (let j = 0; j < out.length && !contained; j++) {
        if (i === j) continue;
        const b = out[j];
        if (a.x >= b.x - EPS && a.y >= b.y - EPS && a.x + a.w <= b.x + b.w + EPS && a.y + a.h <= b.y + b.h + EPS) {
          // identical rects: keep the first only
          if (Math.abs(a.w - b.w) < EPS && Math.abs(a.h - b.h) < EPS && Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS) { if (j < i) contained = true; }
          else contained = true;
        }
      }
      if (!contained) keep.push(a);
    }
    bin.free = keep;
    bin.placed.push({ x, y, w, h });
    bin.used += trueArea;
    bin.maxX = Math.max(bin.maxX, x + w); bin.maxY = Math.max(bin.maxY, y + h);
  }

  /**
   * Run one packing pass over `order` (array of piece records).
   * @returns {{bins: Bin[], placements: Array<Array>}}
   */
  function runPass(order, binW, binH, rule, mode) {
    const bins = [];
    const placementsPerBin = [];
    for (const pc of order) {
      let choice = null; // {bi, o, pos}
      const consider = (bi) => {
        for (const o of pc.orients) {
          const pos = findBest(bins[bi], rule, o.w, o.h);
          if (!pos) continue;
          if (!choice || pos.s1 < choice.pos.s1 - EPS || (Math.abs(pos.s1 - choice.pos.s1) <= EPS && pos.s2 < choice.pos.s2 - EPS)) {
            choice = { bi, o, pos };
          }
        }
      };
      if (mode === 'first') {
        for (let bi = 0; bi < bins.length && !choice; bi++) consider(bi);
      } else {
        for (let bi = 0; bi < bins.length; bi++) consider(bi);
      }
      if (!choice) {
        bins.push(new Bin(binW, binH)); placementsPerBin.push([]);
        consider(bins.length - 1);
      }
      placeInBin(bins[choice.bi], choice.pos.x, choice.pos.y, choice.o.w, choice.o.h, pc.area);
      placementsPerBin[choice.bi].push({ pc, o: choice.o, x: choice.pos.x, y: choice.pos.y });
    }
    return { bins, placementsPerBin };
  }

  // Lower is better.
  function quality(run) {
    const n = run.bins.length;
    const last = run.bins.reduce((a, b) => (b.used < a.used ? b : a), run.bins[0]); // emptiest sheet
    return [n, last ? last.used : 0, last ? last.maxX * last.maxY : 0];
  }
  function better(a, b) {
    for (let i = 0; i < a.length; i++) {
      if (a[i] < b[i] - EPS) return true;
      if (a[i] > b[i] + EPS) return false;
    }
    return false;
  }

  // deterministic PRNG (mulberry32)
  function rng(seed) {
    let t = seed >>> 0;
    return function () {
      t += 0x6D2B79F5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  const SORTS = {
    area: p => p.area,
    longSide: p => Math.max(p.w, p.h) * 1e4 + Math.min(p.w, p.h),
    shortSide: p => Math.min(p.w, p.h) * 1e4 + Math.max(p.w, p.h),
    perimeter: p => p.w + p.h,
    width: p => p.w * 1e4 + p.h,
    height: p => p.h * 1e4 + p.w,
  };
  const RULES = ['BSSF', 'BAF', 'CP', 'BLSF', 'BL'];

  /**
   * @param {Array} items  [{id, name, width, height, allowRotate, qty}]
   * @param {object} sheet {width, height, margin, spacing}
   * @returns {{sheets: Array<{index:number, placements:Array, usedArea:number, utilization:number}>,
   *            utilization: number, totalSheets: number, unplaced: Array}}
   */
  function pack(items, sheet) {
    const margin = sheet.margin || 0;
    const spacing = sheet.spacing || 0;
    const usableW = sheet.width - 2 * margin;
    const usableH = sheet.height - 2 * margin;
    // Inflating every part by `spacing` and the bin by `spacing` guarantees
    // exactly `spacing` between neighbours and none against the margin.
    const binW = usableW + spacing, binH = usableH + spacing;

    const records = [];
    const unplaced = [];
    for (const it of items) {
      const qty = it.qty || 1;
      for (let i = 0; i < qty; i++) {
        const piece = Object.assign({}, it, { instance: i });
        const orients = [{ w: piece.width + spacing, h: piece.height + spacing, rotated: false, pw: piece.width, ph: piece.height }];
        if (piece.allowRotate !== false && Math.abs(piece.width - piece.height) > EPS) {
          orients.push({ w: piece.height + spacing, h: piece.width + spacing, rotated: true, pw: piece.height, ph: piece.width });
        }
        const fitting = orients.filter(o => o.w <= binW + EPS && o.h <= binH + EPS);
        if (!fitting.length) { unplaced.push(piece); continue; }
        records.push({ piece, orients: fitting, w: piece.width + spacing, h: piece.height + spacing, area: piece.width * piece.height });
      }
    }

    let bestRun = null, bestQ = null;
    const consider = (order, rule, mode) => {
      const run = runPass(order, binW, binH, rule, mode);
      const q = quality(run);
      if (!bestRun || better(q, bestQ)) { bestRun = run; bestQ = q; }
    };

    if (records.length) {
      // Phase 1: systematic sweep
      const sortedCache = {};
      for (const name of Object.keys(SORTS)) {
        const key = SORTS[name];
        sortedCache[name] = records.slice().sort((a, b) => key(b) - key(a));
      }
      for (const name of Object.keys(SORTS)) {
        for (const rule of RULES) {
          consider(sortedCache[name], rule, 'global');
          consider(sortedCache[name], rule, 'first');
        }
      }

      // Phase 2: seeded randomized search around the good orderings.
      const n = records.length;
      const totalArea = records.reduce((s, r) => s + r.area, 0);
      const lowerBound = Math.max(1, Math.ceil(totalArea / (usableW * usableH) - 1e-9));
      const iters = Math.max(20, Math.min(400, Math.round(30000 / Math.max(n, 1))));
      const rand = rng(1234567 + n * 7919);
      const sortNames = Object.keys(SORTS);
      const ruleNames = ['BSSF', 'BAF', 'CP', 'BLSF'];
      for (let it = 0; it < iters; it++) {
        const key = SORTS[sortNames[Math.floor(rand() * sortNames.length)]];
        const noise = 0.05 + rand() * 0.5;
        const keyed = records.map(r => ({ r, k: key(r) * (1 + (rand() - 0.5) * noise) }));
        keyed.sort((a, b) => b.k - a.k);
        const order = keyed.map(x => x.r);
        const rule = ruleNames[Math.floor(rand() * ruleNames.length)];
        consider(order, rule, rand() < 0.5 ? 'global' : 'first');
        // stop once we're at the sheet-count lower bound and the last sheet is nearly empty
        if (bestQ[0] === lowerBound && bestQ[1] <= totalArea - (lowerBound - 1) * usableW * usableH * 0.999) break;
      }
    }

    const sheets = [];
    if (bestRun) {
      bestRun.bins.forEach((bin, bi) => {
        const placements = bestRun.placementsPerBin[bi].map(p => ({
          id: p.pc.piece.id, name: p.pc.piece.name,
          x: margin + p.x, y: margin + p.y,
          width: p.o.pw, height: p.o.ph, rotated: p.o.rotated, group: p.pc.piece.group,
        }));
        sheets.push({ index: bi, placements, usedArea: bin.used, utilization: bin.used / (sheet.width * sheet.height) });
      });
      // Put the emptiest sheet last so offcut sheets are predictable.
      sheets.sort((a, b) => b.usedArea - a.usedArea);
      sheets.forEach((s, i) => { s.index = i; });
    }
    if (!sheets.length) sheets.push({ index: 0, placements: [], usedArea: 0, utilization: 0 });

    const sheetArea = sheet.width * sheet.height;
    const totalUsed = sheets.reduce((s, sh) => s + sh.usedArea, 0);
    const totalAvailable = sheetArea * sheets.length;
    const utilization = totalAvailable > 0 ? totalUsed / totalAvailable : 0;

    return {
      sheets, utilization, totalSheets: sheets.length, unplaced, sheetArea, wasteArea: totalAvailable - totalUsed,
    };
  }

  /**
   * Nests all parts. By default every part — whatever its material or
   * thickness — shares sheets so nothing is wasted. With
   * `sheet.groupByMaterial === true`, parts are instead grouped by
   * `item.group` (material + thickness) and each group gets its own sheets,
   * as needed when each material is cut from its own physical stock.
   * Each placement carries its `group`, and each sheet lists the materials
   * on it in `groupLabel` (joined with " + " when mixed).
   *
   * @param {Array} items  as pack(), plus { group, groupLabel }
   */
  function packGroups(items, sheet) {
    const order = [];
    const byGroup = {};
    const labelOf = {};
    for (const it of items) {
      const g = it.group === undefined ? 'default' : it.group;
      if (!byGroup[g]) { byGroup[g] = []; order.push(g); }
      byGroup[g].push(it);
      if (labelOf[g] === undefined) labelOf[g] = it.groupLabel || null;
    }
    const sheetArea = sheet.width * sheet.height;
    const labelFor = (placements, fallback) => {
      const seen = [];
      for (const pl of placements) { const l = labelOf[pl.group]; if (l && seen.indexOf(l) < 0) seen.push(l); }
      return seen.length ? seen.join(' + ') : fallback;
    };

    if (sheet.groupByMaterial !== true) {
      const res = pack(items, sheet);
      const sheets = res.sheets.map(s => ({
        index: s.index, placements: s.placements, usedArea: s.usedArea, utilization: s.utilization,
        group: 'all', groupLabel: labelFor(s.placements, null),
      }));
      return {
        sheets, utilization: res.utilization, totalSheets: res.totalSheets, unplaced: res.unplaced,
        sheetArea, wasteArea: res.wasteArea, groups: ['all'], materialKeys: order, groupByMaterial: false,
      };
    }

    const sheets = [], unplaced = [];
    let totalUsed = 0;
    for (const g of order) {
      const res = pack(byGroup[g], sheet);
      const label = labelOf[g];
      for (const s of res.sheets) {
        if (!s.placements.length && order.length > 1) continue;
        sheets.push({ index: sheets.length, placements: s.placements, usedArea: s.usedArea, utilization: s.utilization, group: g, groupLabel: label });
        totalUsed += s.usedArea;
      }
      res.unplaced.forEach(u => unplaced.push(u));
    }
    const totalAvailable = sheetArea * sheets.length;
    return {
      sheets, utilization: totalAvailable > 0 ? totalUsed / totalAvailable : 0,
      totalSheets: sheets.length, unplaced, sheetArea, wasteArea: totalAvailable - totalUsed,
      groups: order, materialKeys: order, groupByMaterial: true,
    };
  }

  /**
   * Detect placements that overlap each other or leave the usable sheet area.
   * Placements are bounding rectangles (width/height already reflect rotation).
   * @returns {Array<{sheet:number, a:string, b:string|null, kind:'overlap'|'outside'}>}
   */
  function findOverlaps(layout, sheet) {
    const out = [];
    const margin = (sheet && sheet.margin) || 0;
    const eps = 1e-6;
    for (const s of layout.sheets) {
      const pl = s.placements;
      for (let i = 0; i < pl.length; i++) {
        const a = pl[i];
        if (sheet && (a.x < margin - eps || a.y < margin - eps || a.x + a.width > sheet.width - margin + eps || a.y + a.height > sheet.height - margin + eps)) {
          out.push({ sheet: s.index, a: a.id, b: null, kind: 'outside' });
        }
        for (let j = i + 1; j < pl.length; j++) {
          const b = pl[j];
          if (a.x < b.x + b.width - eps && b.x < a.x + a.width - eps && a.y < b.y + b.height - eps && b.y < a.y + a.height - eps) {
            out.push({ sheet: s.index, a: a.id, b: b.id, kind: 'overlap' });
          }
        }
      }
    }
    return out;
  }

  const SheetLayout = { pack, packGroups, findOverlaps };

  if (typeof module !== 'undefined' && module.exports) module.exports = SheetLayout;
  else root.SheetLayout = SheetLayout;
})(typeof window !== 'undefined' ? window : globalThis);
