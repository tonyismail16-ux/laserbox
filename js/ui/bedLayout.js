/* bedLayout.js — visual, foam-insert style layout editor for the inner bed.
   Edits params.bedItems only; geometry lives in innerBed.js, align maths in itemAlign.js.
   Multi-select: click, Shift/Ctrl/Cmd-click to add/remove, drag a box on empty space, Ctrl/Cmd+A for all. */
(function () {
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  let sel = -1, selSet = [], drag = null, marq = null;   // sel = primary item (shown in the form), selSet = every selected item
  const items = () => (window.State.current.params.bedItems || []);
  const setItems = (a) => window.State.updateParams({ bedItems: a });
  const bedSize = () => { const b = window.State.derived.result.info && window.State.derived.result.info.bed; return b ? { L: b.length, W: b.width } : { L: 200, W: 150 }; };
  const num = (v, d) => (isFinite(parseFloat(v)) ? parseFloat(v) : d);

  const ITEMS = [
    ['Lamp base + cable slot', { type: 'lamp', w: 80, itemHeight: 150, cableAngle: 270, cableWidth: 48, cableLen: 20 }],
    ['Lamp base + cable keyhole (narrow channel + coil)', { type: 'round', w: 80, itemHeight: 150, cable: true, cableAngle: 270, cableWidth: 8, cableLen: 20, cableCoil: 45 }],
    ['Round (jar / candle / ornament)', { type: 'round', w: 70 }],
    ['Acrylic 2 mm', { type: 'acrylic', w: 2, h: 60 }], ['Acrylic 3 mm', { type: 'acrylic', w: 3, h: 60 }],
    ['Acrylic 5 mm', { type: 'acrylic', w: 5, h: 60 }], ['Acrylic 8 mm', { type: 'acrylic', w: 8, h: 60 }], ['Acrylic 10 mm', { type: 'acrylic', w: 10, h: 60 }],
    ['Box / book (rectangle)', { type: 'rect', w: 80, h: 50 }],
    ['Square (double layer backing)', { type: 'square', w: 60 }],
    ['Square, rounded corners (R6)', { type: 'square', w: 60, radius: 6 }],
    ['Rectangle, rounded corners + finger slot', { type: 'rect', w: 80, h: 50, radius: 5, finger: true, fingerAngle: 90, fingerWidth: 20, fingerDepth: 10 }],
    ['Card / pen slot', { type: 'slot', w: 90, h: 14 }],
    ['Bottle', { type: 'bottle', w: 65, h: 200, neckW: 28, neckLen: 60 }],
  ];
  const LAYOUTS = [
    ['Lamp + acrylic sheet', (L, W) => [Object.assign({}, ITEMS[0][1], { x: -L * 0.2, y: 0 }), { type: 'acrylic', w: 3, h: Math.min(60, W * 0.6), x: L * 0.3, y: 0, rot: 90 }]],
    ['Lamp + 3 acrylic (3 / 5 / 10 mm)', (L, W) => [Object.assign({}, ITEMS[0][1], { x: -L * 0.22, y: 0 }), { type: 'acrylic', w: 3, h: 50, x: L * 0.18, y: W * 0.25 }, { type: 'acrylic', w: 5, h: 50, x: L * 0.3, y: 0 }, { type: 'acrylic', w: 10, h: 50, x: L * 0.42, y: -W * 0.25 }]],
    ['Hamper: 4 round jars', (L, W) => [[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([a, b]) => ({ type: 'round', w: Math.min(L, W) * 0.38, x: a * L * 0.23, y: b * W * 0.23 }))],
    ['Hamper: 2 bottles + box', (L, W) => [{ type: 'bottle', w: 60, h: Math.min(200, W * 0.85), neckW: 26, neckLen: 55, x: -L * 0.3, y: 0 }, { type: 'bottle', w: 60, h: Math.min(200, W * 0.85), neckW: 26, neckLen: 55, x: -L * 0.05, y: 0 }, { type: 'rect', w: L * 0.25, h: W * 0.5, x: L * 0.3, y: 0 }]],
  ];

  function polys() {
    const { pockets } = window.InnerBed.buildPockets(items(), 0, 0);
    return pockets.map((c) => ({ poly: window.Panel.buildCutout(c), idx: c._idx }));
  }
  const r2 = (v) => Math.round(v * 100) / 100;
  const boxesAll = () => { const B = {}; polys().forEach(({ poly, idx }) => { B[idx] = window.ItemAlign.boxOf(idx, poly); }); return B; };
  const selBoxes = () => { const B = boxesAll(); return selSet.filter((i) => B[i]).map((i) => B[i]); };
  function setSel(a) { const n = items().length; selSet = Array.from(new Set(a)).filter((i) => i >= 0 && i < n); sel = selSet.length ? selSet[selSet.length - 1] : -1; }
  function patchMany(map) { setItems(items().map((x, i) => (map.has(i) ? Object.assign({}, x, map.get(i)) : x))); }
  function applyMoves(moves) {
    if (!moves.length) return; const m = new Map(), a = items();
    moves.forEach(({ id, dx, dy }) => { const it = a[id]; if (it) m.set(id, { x: r2((it.x || 0) + dx), y: r2((it.y || 0) + dy) }); });
    patchMany(m);
  }
  // does item i rest on the solid base layer, or is it tall enough to stand on the box floor?
  function needsBase(i) {
    const b = window.State.derived.result.info && window.State.derived.result.info.bed, p = window.State.current.params;
    const top = b ? b.topAboveFloor - (b.baseThickness || 0) : 0, min = isFinite(parseFloat(p.bedTallItemMin)) ? parseFloat(p.bedTallItemMin) : 50;
    return window.InnerBed.itemNeedsBase(items()[i], top, min);
  }

  function draw() {
    const svg = $('blCanvas'); if (!svg) return;
    const { L, W } = bedSize(), m = 6;
    svg.setAttribute('viewBox', `${-L / 2 - m} ${-W / 2 - m} ${L + 2 * m} ${W + 2 * m}`);
    let h = `<g transform="scale(1,-1)"><rect x="${-L / 2}" y="${-W / 2}" width="${L}" height="${W}" fill="#2d333d" stroke="#8a93a3" stroke-width="0.8"/>`;
    h += `<line x1="${-L / 2}" y1="0" x2="${L / 2}" y2="0" stroke="#3a4250" stroke-width="0.4"/><line y1="${-W / 2}" x1="0" y2="${W / 2}" x2="0" stroke="#3a4250" stroke-width="0.4"/>`;
    const P = polys(), inSel = (i) => selSet.indexOf(i) >= 0;
    P.forEach(({ poly, idx }) => {
      const tall = !needsBase(idx), on = inSel(idx), prim = idx === sel;
      const d = poly.map((p, k) => (k ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join('') + 'Z';
      h += `<path data-i="${idx}" d="${d}" fill="${on ? 'rgba(80,160,255,.45)' : tall ? 'rgba(0,0,0,.55)' : 'rgba(214,160,60,.38)'}" stroke="${on ? '#5aa9ff' : tall ? '#d0d6e0' : '#e0b050'}" stroke-width="${prim ? 1.4 : on ? 1 : 0.7}" style="cursor:move"/>`;
    });
    if (selSet.length > 1) {
      const u = window.ItemAlign.union(selBoxes());
      if (isFinite(u.minx)) h += `<rect x="${u.minx}" y="${u.miny}" width="${u.maxx - u.minx}" height="${u.maxy - u.miny}" fill="none" stroke="#5aa9ff" stroke-width="0.5" stroke-dasharray="3 2" pointer-events="none"/>`;
    }
    if (marq) {
      const x = Math.min(marq.x0, marq.x1), y = Math.min(marq.y0, marq.y1);
      h += `<rect x="${x}" y="${y}" width="${Math.abs(marq.x1 - marq.x0)}" height="${Math.abs(marq.y1 - marq.y0)}" fill="rgba(90,169,255,.12)" stroke="#5aa9ff" stroke-width="0.5" stroke-dasharray="2 2" pointer-events="none"/>`;
    }
    svg.innerHTML = h + '</g>';
  }

  function syncForm() {
    const it = items()[sel], f = $('blForm'), n = selSet.length;
    $('blSelInfo').textContent = n === 0 ? 'Nothing selected: click an item, Shift-click for more, or drag a box' : n === 1 ? '1 item selected' : n + ' items selected (the form edits the last one clicked)';
    document.querySelectorAll('#blAlign [data-act]').forEach((b) => { const need = { distx: 3, disty: 3, row: 2, col: 2, grid: 2 }[b.dataset.act] || 1; b.disabled = n < need; });
    $('blRel').disabled = n < 2; $('blCenter').disabled = n < 1; $('blDup').disabled = n < 1; $('blDel').disabled = n < 1;
    f.hidden = !it; if (!it) return;
    const set = (id, v) => { const e = $(id); if (e && document.activeElement !== e) e.value = v === undefined || v === null ? '' : v; };
    const t = it.type;
    set('blItemH', it.itemHeight);
    $('blSupport').textContent = needsBase(sel) ? 'Double layer: backing patch glued under this pocket' : 'Tall: stands on box floor';
    set('blType', t); set('blRot', it.rot || 0); set('blW', it.w); set('blH', it.h); set('blX', it.x || 0); set('blY', it.y || 0);
    $('blWLabel').textContent = t === 'round' || t === 'lamp' ? 'Diameter' : t === 'square' ? 'Side length' : t === 'acrylic' ? 'Sheet thickness' : t === 'bottle' ? 'Body width' : 'Width';
    $('blHLabel').textContent = t === 'acrylic' ? 'Sheet width' : t === 'bottle' ? 'Total length' : 'Height';
    $('blHField').hidden = t === 'round' || t === 'lamp' || t === 'square';
    $('blCornerField').hidden = !(t === 'rect' || t === 'square' || t === 'acrylic' || t === 'bottle'); set('blRadius', it.radius || 0);
    $('blFinger').checked = !!it.finger; $('blFingerFields').hidden = !it.finger;
    set('blFingerAngle', it.fingerAngle === undefined ? 90 : it.fingerAngle); set('blFingerW', it.fingerWidth || 20); set('blFingerDepth', it.fingerDepth === undefined ? Math.round((it.fingerWidth || 20) / 2) : it.fingerDepth);
    $('blSupportSel').value = it.support || '';
    $('blBottleFields').hidden = t !== 'bottle'; set('blNeckW', it.neckW); set('blNeckLen', it.neckLen);
    const lamp = t === 'lamp';
    $('blCableBox').hidden = t !== 'round' && !lamp; $('blCable').checked = !!it.cable || lamp; $('blCable').closest('label').hidden = lamp;
    $('blCableFields').hidden = !lamp && !it.cable; $('blCableCoil').closest('label').hidden = lamp;
    $('blCableWidthLabel').textContent = lamp ? 'Cable slot width' : 'Channel width'; $('blCableLenLabel').textContent = lamp ? 'Slot reaches past circle' : 'Channel length';
    set('blCableAngle', it.cableAngle === undefined ? 270 : it.cableAngle); set('blCableWidth', it.cableWidth || (lamp ? Math.round(num(it.w, 80) * 0.6) : 8)); set('blCableLen', it.cableLen === undefined ? 20 : it.cableLen); set('blCableCoil', it.cableCoil || 0);
  }

  function refresh() { setSel(selSet); draw(); syncForm(); }
  function patch(p) { const a = items().map((x, i) => (i === sel ? Object.assign({}, x, p) : x)); setItems(a); }

  function svgPoint(e) {
    const svg = $('blCanvas'), pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const q = pt.matrixTransform(svg.getScreenCTM().inverse()); return { x: q.x, y: -q.y };
  }

  function duplicateSel() {
    if (!selSet.length) return; const a = items().slice(), add = [];
    selSet.slice().sort((x, y) => x - y).forEach((i) => { a.push(Object.assign({}, a[i], { x: (a[i].x || 0) + 15, y: (a[i].y || 0) - 15 })); add.push(a.length - 1); });
    setItems(a); setSel(add); refresh();
  }
  function deleteSel() { if (!selSet.length) return; const a = items().filter((_, i) => selSet.indexOf(i) < 0); selSet = []; sel = -1; setItems(a); refresh(); }
  function runAct(act) {
    const A = window.ItemAlign, B = selBoxes(), { L, W } = bedSize();
    const ctx = { rel: $('blRel').value, L, W, margin: num($('blMargin').value, 5) };
    const gap = num($('blGap').value, 10), cols = num($('blCols').value, 2);
    let mv = [];
    if (A.ALIGN_MODES.indexOf(act) >= 0) mv = A.align(B, act, ctx);
    else if (act === 'ctrx') mv = A.centerGroup(B, 'x');
    else if (act === 'ctry') mv = A.centerGroup(B, 'y');
    else if (act === 'ctrxy') mv = A.centerGroup(B, 'xy');
    else if (act === 'distx') mv = A.distribute(B, 'x');
    else if (act === 'disty') mv = A.distribute(B, 'y');
    else if (act === 'spreadx') mv = A.spread(B, 'x', ctx);
    else if (act === 'spready') mv = A.spread(B, 'y', ctx);
    else if (act === 'row') mv = A.arrange(B, { mode: 'row', gap });
    else if (act === 'col') mv = A.arrange(B, { mode: 'column', gap });
    else if (act === 'grid') mv = A.arrange(B, { mode: 'grid', gap, cols });
    applyMoves(mv);
  }

  function init() {
    if (!$('blEditor') || !window.State) return;
    $('blAddSel').innerHTML = '<option value="">+ choose item…</option>' + ITEMS.map((x, i) => `<option value="${i}">${x[0]}</option>`).join('');
    $('blLayoutSel').innerHTML = '<option value="">choose layout…</option>' + LAYOUTS.map((x, i) => `<option value="${i}">${x[0]}</option>`).join('');
    $('blAddSel').addEventListener('change', (e) => {
      if (e.target.value === '') return;
      const a = items().slice(), n = a.length;
      a.push(Object.assign({ x: 0, y: 0, rot: 0 }, ITEMS[+e.target.value][1], { x: Math.round((n % 3 - 1) * 20), y: -Math.round((Math.floor(n / 3) % 3 - 1) * 20) }));
      setItems(a); setSel([a.length - 1]); refresh(); e.target.value = '';
    });
    $('blLayoutSel').addEventListener('change', (e) => {
      if (e.target.value === '') return;
      const { L, W } = bedSize(); setSel([]);
      setItems(LAYOUTS[+e.target.value][1](L, W).map((x) => Object.assign({ rot: 0 }, x, { x: Math.round(x.x || 0), y: Math.round(x.y || 0) })));
      e.target.value = '';
    });
    const bindNum = (id, key, d) => $(id).addEventListener('input', (e) => { const v = parseFloat(e.target.value); if (isFinite(v)) patch({ [key]: v }); });
    [['blW', 'w'], ['blH', 'h'], ['blX', 'x'], ['blY', 'y'], ['blRot', 'rot'], ['blNeckW', 'neckW'], ['blNeckLen', 'neckLen'], ['blCableAngle', 'cableAngle'], ['blCableWidth', 'cableWidth'], ['blCableLen', 'cableLen'], ['blCableCoil', 'cableCoil'], ['blFingerAngle', 'fingerAngle'], ['blFingerW', 'fingerWidth'], ['blFingerDepth', 'fingerDepth']].forEach(([id, k]) => bindNum(id, k));
    $('blItemH').addEventListener('input', (e) => { const v = parseFloat(e.target.value); patch({ itemHeight: isFinite(v) && v > 0 ? v : undefined }); });
    $('blRadius').addEventListener('input', (e) => { const v = parseFloat(e.target.value); patch({ radius: isFinite(v) && v > 0 ? v : 0 }); });
    $('blType').addEventListener('change', (e) => { const it = items()[sel] || {}, p = { type: e.target.value }; if (!(parseFloat(it.h) > 0) && e.target.value !== 'round' && e.target.value !== 'lamp') p.h = it.w || 50; patch(p); });
    $('blFinger').addEventListener('change', (e) => { const it = items()[sel] || {}; patch(e.target.checked ? { finger: true, fingerAngle: it.fingerAngle === undefined ? 90 : it.fingerAngle, fingerWidth: it.fingerWidth || 20, fingerDepth: it.fingerDepth === undefined ? 10 : it.fingerDepth } : { finger: false }); });
    document.querySelectorAll('#blFingerFields [data-fdir]').forEach((b) => b.addEventListener('click', () => patch({ fingerAngle: +b.dataset.fdir })));
    $('blSupportSel').addEventListener('change', (e) => patch({ support: e.target.value || undefined }));
    $('blCable').addEventListener('change', (e) => patch(e.target.checked ? { cable: true, cableAngle: items()[sel].cableAngle === undefined ? 270 : items()[sel].cableAngle, cableWidth: items()[sel].cableWidth || 8, cableLen: items()[sel].cableLen === undefined ? 20 : items()[sel].cableLen, cableCoil: items()[sel].cableCoil || 0 } : { cable: false }));
    document.querySelectorAll('#blCableFields [data-dir]').forEach((b) => b.addEventListener('click', () => patch({ cableAngle: +b.dataset.dir })));
    $('blCenter').addEventListener('click', () => applyMoves(window.ItemAlign.centerGroup(selBoxes(), 'xy')));
    $('blDup').addEventListener('click', () => duplicateSel());
    $('blDel').addEventListener('click', () => deleteSel());
    $('blSelAll').addEventListener('click', () => { setSel(items().map((_, i) => i)); refresh(); $('blCanvas').focus(); });
    $('blAlign').addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b && !b.disabled) runAct(b.dataset.act); });

    const svg = $('blCanvas');
    svg.addEventListener('pointerdown', (e) => {
      svg.focus(); const t = e.target.closest('[data-i]'), p = svgPoint(e), add = e.shiftKey || e.ctrlKey || e.metaKey;
      if (t) {
        const i = +t.dataset.i;
        if (add) { setSel(selSet.indexOf(i) >= 0 ? selSet.filter((k) => k !== i) : selSet.concat(i)); refresh(); return; }
        if (selSet.indexOf(i) < 0) setSel([i]); else setSel(selSet.filter((k) => k !== i).concat(i));
        const a = items(), orig = new Map(selSet.map((k) => [k, { x: a[k].x || 0, y: a[k].y || 0 }]));
        drag = { start: p, orig }; svg.setPointerCapture(e.pointerId); refresh();
      } else {
        marq = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, add, base: selSet.slice() }; if (!add) setSel([]);
        svg.setPointerCapture(e.pointerId); refresh();
      }
    });
    svg.addEventListener('pointermove', (e) => {
      const p = svgPoint(e);
      if (drag) { const m = new Map(); drag.orig.forEach((o, k) => m.set(k, { x: Math.round(o.x + p.x - drag.start.x), y: Math.round(o.y + p.y - drag.start.y) })); patchMany(m); }
      else if (marq) {
        marq.x1 = p.x; marq.y1 = p.y;
        const x0 = Math.min(marq.x0, marq.x1), x1 = Math.max(marq.x0, marq.x1), y0 = Math.min(marq.y0, marq.y1), y1 = Math.max(marq.y0, marq.y1), B = boxesAll();
        const hit = Object.keys(B).map(Number).filter((i) => B[i].maxx >= x0 && B[i].minx <= x1 && B[i].maxy >= y0 && B[i].miny <= y1);
        setSel((marq.add ? marq.base : []).concat(hit)); refresh();
      }
    });
    const endPointer = () => { drag = null; if (marq) { marq = null; refresh(); } };
    svg.addEventListener('pointerup', endPointer); svg.addEventListener('pointercancel', endPointer);
    svg.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); setSel(items().map((_, i) => i)); refresh(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); duplicateSel(); return; }
      if (e.key === 'Escape') { setSel([]); refresh(); return; }
      if (!selSet.length) return; const s = e.shiftKey ? 5 : 1;
      const m = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, s], ArrowDown: [0, -s] }[e.key];
      if (m) { e.preventDefault(); const a = items(), mm = new Map(); selSet.forEach((k) => mm.set(k, { x: (a[k].x || 0) + m[0], y: (a[k].y || 0) + m[1] })); patchMany(mm); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); }
    });
    window.State.subscribe(refresh);
    refresh();
  }

  document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0));
})();
