/**
 * itemAlign.js — align / centre / distribute / arrange maths for the inner-bed item layout.
 * Pure functions, no DOM: unit-testable under Node.
 *
 * Coordinates are bed coordinates: origin at the bed centre, +x right, +y UP.
 * The bed spans x in [-L/2, L/2] and y in [-W/2, W/2].
 *
 * A "box" is the visual bounding box of one item's pocket outline:
 *     { id, minx, maxx, miny, maxy }
 * Every function returns MOVES:  [{ id, dx, dy }]  — how far to shift each item (the caller adds that to the item's x / y).
 * Moves only ever change the axis the operation is about; the other axis is left alone.
 */
(function (root) {
  'use strict';

  const cx = (b) => (b.minx + b.maxx) / 2, cy = (b) => (b.miny + b.maxy) / 2;
  const sw = (b) => b.maxx - b.minx, sh = (b) => b.maxy - b.miny;
  const union = (B) => ({ minx: Math.min(...B.map(b => b.minx)), maxx: Math.max(...B.map(b => b.maxx)), miny: Math.min(...B.map(b => b.miny)), maxy: Math.max(...B.map(b => b.maxy)) });
  const mv = (id, dx, dy) => ({ id, dx: dx || 0, dy: dy || 0 });
  const num = (v, d) => (isFinite(parseFloat(v)) ? parseFloat(v) : d);

  const ALIGN_MODES = ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'];

  /**
   * Align edges / centres.
   *   mode: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' (= middle) | 'bottom'
   *   ctx : { rel: 'selection' | 'bed', L, W, margin }
   *   rel 'selection' lines the items up with each other (e.g. all the same height / same top edge).
   *   rel 'bed' lines them up with the bed: left/right/top/bottom keep `margin` mm clear of the edge, centres use the bed centre.
   *   A single item has nothing to line up with, so it always uses the bed.
   */
  function align(boxes, mode, ctx) {
    if (!boxes.length || ALIGN_MODES.indexOf(mode) < 0) return [];
    ctx = ctx || {};
    const L = num(ctx.L, 0), W = num(ctx.W, 0), m = Math.max(0, num(ctx.margin, 0));
    const bed = ctx.rel === 'bed' || boxes.length < 2, u = union(boxes);
    const T = {
      left: bed ? -L / 2 + m : u.minx, right: bed ? L / 2 - m : u.maxx, hcenter: bed ? 0 : (u.minx + u.maxx) / 2,
      bottom: bed ? -W / 2 + m : u.miny, top: bed ? W / 2 - m : u.maxy, vcenter: bed ? 0 : (u.miny + u.maxy) / 2,
    }[mode];
    return boxes.map((b) => {
      switch (mode) {
        case 'left': return mv(b.id, T - b.minx, 0);
        case 'right': return mv(b.id, T - b.maxx, 0);
        case 'hcenter': return mv(b.id, T - cx(b), 0);
        case 'bottom': return mv(b.id, 0, T - b.miny);
        case 'top': return mv(b.id, 0, T - b.maxy);
        default: return mv(b.id, 0, T - cy(b));
      }
    });
  }

  /** Centre the whole selection (as ONE group, spacing kept) on the bed. axis: 'x' | 'y' | 'xy'. */
  function centerGroup(boxes, axis) {
    if (!boxes.length) return [];
    const u = union(boxes), dx = axis === 'y' ? 0 : -(u.minx + u.maxx) / 2, dy = axis === 'x' ? 0 : -(u.miny + u.maxy) / 2;
    return boxes.map(b => mv(b.id, dx, dy));
  }

  /**
   * Equal gaps BETWEEN items, the two outermost items stay where they are (needs 3+). axis: 'x' | 'y'.
   */
  function distribute(boxes, axis) {
    if (boxes.length < 3) return [];
    const x = axis !== 'y', lo = (b) => (x ? b.minx : b.miny), size = (b) => (x ? sw(b) : sh(b));
    const S = boxes.slice().sort((a, b) => (lo(a) + size(a) / 2) - (lo(b) + size(b) / 2));
    const first = S[0], last = S[S.length - 1], span = lo(last) + size(last) - lo(first);
    const gap = (span - S.reduce((s, b) => s + size(b), 0)) / (S.length - 1);
    let pos = lo(first);
    return S.map((b) => { const d = pos - lo(b); pos += size(b) + gap; return x ? mv(b.id, d, 0) : mv(b.id, 0, d); });
  }

  /**
   * SPREAD IN THE BED: equal gaps between the items AND between the items and the bed edges, so the row is centred
   * on the bed and fills it evenly — "distribute them based on the box size". axis: 'x' | 'y'.  Works for 1+ items.
   */
  function spread(boxes, axis, ctx) {
    if (!boxes.length) return [];
    ctx = ctx || {};
    const x = axis !== 'y', total = x ? num(ctx.L, 0) : num(ctx.W, 0), lo = (b) => (x ? b.minx : b.miny), size = (b) => (x ? sw(b) : sh(b));
    const S = boxes.slice().sort((a, b) => (lo(a) + size(a) / 2) - (lo(b) + size(b) / 2));
    const gap = (total - S.reduce((s, b) => s + size(b), 0)) / (S.length + 1);
    let pos = -total / 2 + gap;
    return S.map((b) => { const d = pos - lo(b); pos += size(b) + gap; return x ? mv(b.id, d, 0) : mv(b.id, 0, d); });
  }

  /**
   * Arrange the selection with an EXACT gap and centre the result on the bed.
   *   opts.mode 'row' (left→right, middles on the bed centre line), 'column' (top→bottom), 'grid' (opts.cols columns, in selection order)
   *   opts.gap  mm between neighbouring items
   */
  function arrange(boxes, opts) {
    if (boxes.length < 2) return [];
    opts = opts || {};
    const gap = Math.max(0, num(opts.gap, 10)), mode = opts.mode || 'row';
    if (mode === 'row') {
      const S = boxes.slice().sort((a, b) => cx(a) - cx(b)), tot = S.reduce((s, b) => s + sw(b), 0) + gap * (S.length - 1);
      let pos = -tot / 2;
      return S.map((b) => { const d = pos - b.minx; pos += sw(b) + gap; return mv(b.id, d, -cy(b)); });
    }
    if (mode === 'column') {
      const S = boxes.slice().sort((a, b) => cy(b) - cy(a)), tot = S.reduce((s, b) => s + sh(b), 0) + gap * (S.length - 1);
      let pos = tot / 2;                                                    // y goes UP, so walk downwards from the top
      return S.map((b) => { const d = pos - b.maxy; pos -= sh(b) + gap; return mv(b.id, -cx(b), d); });
    }
    const cols = Math.max(1, Math.min(boxes.length, Math.round(num(opts.cols, Math.ceil(Math.sqrt(boxes.length)))))), rows = Math.ceil(boxes.length / cols);
    const cw = new Array(cols).fill(0), rh = new Array(rows).fill(0);
    boxes.forEach((b, i) => { const c = i % cols, r = Math.floor(i / cols); cw[c] = Math.max(cw[c], sw(b)); rh[r] = Math.max(rh[r], sh(b)); });
    const totW = cw.reduce((s, v) => s + v, 0) + gap * (cols - 1), totH = rh.reduce((s, v) => s + v, 0) + gap * (rows - 1);
    const colX = [], rowY = []; let px = -totW / 2, py = totH / 2;
    cw.forEach((w) => { colX.push(px + w / 2); px += w + gap; });
    rh.forEach((h) => { rowY.push(py - h / 2); py -= h + gap; });
    return boxes.map((b, i) => mv(b.id, colX[i % cols] - cx(b), rowY[Math.floor(i / cols)] - cy(b)));
  }

  /** Visual bounding box of a polygon, tagged with an id. */
  function boxOf(id, poly) {
    return { id, minx: Math.min(...poly.map(q => q.x)), maxx: Math.max(...poly.map(q => q.x)), miny: Math.min(...poly.map(q => q.y)), maxy: Math.max(...poly.map(q => q.y)) };
  }

  const ItemAlign = { align, centerGroup, distribute, spread, arrange, boxOf, union, ALIGN_MODES };
  if (typeof module !== 'undefined' && module.exports) module.exports = ItemAlign;
  else root.ItemAlign = ItemAlign;
})(typeof window !== 'undefined' ? window : globalThis);
