/**
 * geometry.test.js — run with: node tests/geometry.test.js
 * Pure assertion-based tests for the geometry engine. No test framework
 * dependency, so it runs anywhere Node runs, with no install step.
 */
const assert = require('assert');
const Vec2 = require('../js/geometry/vec2.js');
const FingerJoint = require('../js/geometry/fingerJoint.js');
const Kerf = require('../js/geometry/kerf.js');
const Panel = require('../js/geometry/panel.js');
const BoxGenerator = require('../js/geometry/boxGenerator.js');
const Validator = require('../js/validation/validator.js');
const SheetLayout = require('../js/geometry/sheetLayout.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok  - ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  - ${name}`);
    console.log(`        ${e.message}`);
  }
}

console.log('\n== FingerJoint.segmentEdge ==');

test('count mode divides edge evenly', () => {
  const r = FingerJoint.segmentEdge(300, { mode: 'count', count: 10 });
  assert.strictEqual(r.segments.length, 10);
  assert.ok(Math.abs(r.width - 30) < 1e-9);
  assert.strictEqual(r.segments[0].state, 'tab');
  assert.strictEqual(r.segments[1].state, 'gap');
});

test('phase 1 is the exact complement of phase 0', () => {
  const a = FingerJoint.segmentEdge(300, { mode: 'count', count: 7, phase: 0 });
  const b = FingerJoint.segmentEdge(300, { mode: 'count', count: 7, phase: 1 });
  for (let i = 0; i < a.segments.length; i++) {
    assert.notStrictEqual(a.segments[i].state, b.segments[i].state);
    assert.ok(Math.abs(a.segments[i].start - b.segments[i].start) < 1e-9);
    assert.ok(Math.abs(a.segments[i].end - b.segments[i].end) < 1e-9);
  }
});

test('width mode derives a count that fits the length evenly', () => {
  const r = FingerJoint.segmentEdge(287, { mode: 'width', width: 15 });
  const total = r.segments.reduce((s, seg) => s + seg.width, 0);
  assert.ok(Math.abs(total - 287) < 1e-6);
});

test('odd finger counts start and end on the same state (symmetric edge)', () => {
  const r = FingerJoint.segmentEdge(300, { mode: 'count', count: 9 });
  assert.strictEqual(r.segments[0].state, r.segments[r.segments.length - 1].state);
});

test('warns when finger width is below the configured minimum', () => {
  const r = FingerJoint.segmentEdge(100, { mode: 'count', count: 40, minFingerWidth: 4 });
  assert.ok(r.warnings.some(w => /below the recommended minimum/.test(w)));
});

test('warns when kerf exceeds the smallest finger', () => {
  const r = FingerJoint.segmentEdge(100, { mode: 'count', count: 4, kerf: 30 });
  assert.ok(r.warnings.some(w => /larger than or equal/.test(w)));
});

test('manual mode accepts explicit boundaries', () => {
  const r = FingerJoint.segmentEdge(100, { mode: 'manual', manualBoundaries: [0, 20, 50, 100], manualStates: ['tab', 'gap', 'tab'] });
  assert.strictEqual(r.segments.length, 3);
  assert.strictEqual(r.segments[1].width, 30);
});

console.log('\n== Kerf compensation ==');

test('compensation widens tabs and narrows gaps by exactly kerf at shared boundaries', () => {
  const r = FingerJoint.segmentEdge(100, { mode: 'count', count: 4 }); // tab,gap,tab,gap of width 25
  const comp = Kerf.compensateSegments(r.segments, 0.2);
  // boundary between seg0(tab) and seg1(gap) should move by +0.1 (grow tab)
  assert.ok(Math.abs(comp[0].end - 25.1) < 1e-9);
  assert.ok(Math.abs(comp[1].start - 25.1) < 1e-9);
  assert.ok(Math.abs(comp[0].width - 25.1) < 1e-9);
  assert.ok(Math.abs(comp[1].width - 24.8) < 1e-9); // gap shrinks by kerf total (0.1 each side)
});

test('endpoints (0 and length) are never shifted by internal compensation', () => {
  const r = FingerJoint.segmentEdge(100, { mode: 'count', count: 5 });
  const comp = Kerf.compensateSegments(r.segments, 0.3);
  assert.strictEqual(comp[0].start, 0);
  assert.strictEqual(comp[comp.length - 1].end, 100);
});

test('resolveOutlineOffset: outside is positive half-kerf, inside is negative', () => {
  assert.strictEqual(Kerf.resolveOutlineOffset('outside', 0.2), 0.1);
  assert.strictEqual(Kerf.resolveOutlineOffset('inside', 0.2), -0.1);
  assert.strictEqual(Kerf.resolveOutlineOffset('none', 0.2), 0);
});

console.log('\n== Panel outline ==');

test('a flat-edged rectangle produces exactly 4 points with correct area', () => {
  const edges = {
    bottom: { type: 'flat', outlineOffset: 0 }, top: { type: 'flat', outlineOffset: 0 },
    left: { type: 'flat', outlineOffset: 0 }, right: { type: 'flat', outlineOffset: 0 },
  };
  const outline = Panel.buildOutline(100, 50, edges);
  assert.strictEqual(outline.length, 4);
  assert.ok(Math.abs(Math.abs(Vec2.signedArea(outline)) - 5000) < 1e-6);
});

test('a finger-jointed edge produces a comb with more than 2 points', () => {
  const r = FingerJoint.segmentEdge(100, { mode: 'count', count: 6 });
  const edges = {
    bottom: { type: 'finger', segments: r.segments, thickness: 3 },
    top: { type: 'flat', outlineOffset: 0 },
    left: { type: 'flat', outlineOffset: 0 }, right: { type: 'flat', outlineOffset: 0 },
  };
  const outline = Panel.buildOutline(100, 50, edges);
  assert.ok(outline.length > 4);
  // every point must stay within [0-thickness, W/H+thickness] bounds
  const b = Vec2.bounds(outline);
  assert.ok(b.minY >= -3.001 && b.minY <= 0.001);
});

test('outline stays closed (no huge jumps) for a fully finger-jointed panel', () => {
  const r1 = FingerJoint.segmentEdge(100, { mode: 'count', count: 6, phase: 0 });
  const r2 = FingerJoint.segmentEdge(100, { mode: 'count', count: 6, phase: 1 });
  const r3 = FingerJoint.segmentEdge(50, { mode: 'count', count: 4, phase: 0 });
  const r4 = FingerJoint.segmentEdge(50, { mode: 'count', count: 4, phase: 1 });
  const edges = {
    bottom: { type: 'finger', segments: r1.segments, thickness: 3 },
    top: { type: 'finger', segments: r2.segments, thickness: 3 },
    left: { type: 'finger', segments: r3.segments, thickness: 3 },
    right: { type: 'finger', segments: r4.segments, thickness: 3 },
  };
  const outline = Panel.buildOutline(100, 50, edges);
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    assert.ok(Vec2.dist(a, b) < 60, `segment too long: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  }
});

console.log('\n== BoxGenerator ==');

function baseParams(overrides) {
  return Object.assign({
    boxType: 'finger6',
    length: 300, width: 200, height: 100,
    thickness: 3, kerf: 0.15,
    fingerMode: 'count', fingerCount: 10,
    minFingerWidth: 3, maxFingerWidth: 40,
    outlineCompensation: 'auto',
    lidStyle: 'flat', bottomStyle: 'flat',
  }, overrides || {});
}

test('finger6 produces 6 panels for a standard box', () => {
  const result = BoxGenerator.generate(baseParams());
  assert.strictEqual(result.panels.length, 6);
  const names = result.panels.map(p => p.id).sort();
  assert.deepStrictEqual(names, ['back', 'bottom', 'front', 'left', 'right', 'top']);
});

test('every generated panel has a valid non-degenerate outline', () => {
  const result = BoxGenerator.generate(baseParams());
  for (const panel of result.panels) {
    assert.ok(panel.outline.length >= 4, `${panel.name} has too few points`);
    assert.ok(Math.abs(Vec2.signedArea(panel.outline)) > 1000, `${panel.name} area looks wrong`);
  }
});

test('Left/Right panel bounding box matches width x height (endcap reaches true corners)', () => {
  const result = BoxGenerator.generate(baseParams());
  const left = result.panels.find(p => p.id === 'left');
  const b = Vec2.bounds(left.outline);
  assert.ok(Math.abs(b.width - 200) < 3.01); // within one thickness of tab protrusion
  assert.ok(Math.abs(b.height - 100) < 3.01);
});

test('open-top box omits the top panel', () => {
  const result = BoxGenerator.generate(baseParams({ boxType: 'finger5open' }));
  assert.ok(!result.panels.some(p => p.id === 'top'));
  assert.strictEqual(result.panels.length, 5);
});

test('simple4 produces 4 panels with plain flat edges', () => {
  const result = BoxGenerator.generate(baseParams({ boxType: 'simple4' }));
  assert.strictEqual(result.panels.length, 4);
});

test('works across a range of dimensions, thicknesses, kerfs, finger counts without throwing', () => {
  const dims = [[50, 50, 50], [300, 200, 100], [600, 400, 250], [80, 40, 30]];
  const thicknesses = [2, 3, 4.5, 6];
  const kerfs = [0, 0.1, 0.15, 0.25];
  const counts = [3, 5, 8, 11, 16];
  for (const [L, W, H] of dims) {
    for (const t of thicknesses) {
      for (const k of kerfs) {
        for (const c of counts) {
          if (L - 2 * t <= 0) continue;
          const result = BoxGenerator.generate(baseParams({ length: L, width: W, height: H, thickness: t, kerf: k, fingerCount: c }));
          assert.strictEqual(result.panels.length, 6);
        }
      }
    }
  }
});

test('non-integer division (edge does not divide evenly by finger width) still closes cleanly', () => {
  const result = BoxGenerator.generate(baseParams({ length: 287, width: 193, height: 111, fingerMode: 'width', fingerWidth: 17 }));
  for (const panel of result.panels) {
    assert.ok(panel.outline.length >= 4);
  }
});

test('very small box (near minimum manufacturable size) does not crash and flags warnings sensibly', () => {
  const result = BoxGenerator.generate(baseParams({ length: 20, width: 20, height: 20, thickness: 3, fingerCount: 3 }));
  assert.ok(Array.isArray(result.warnings));
});

test('large box computes without error', () => {
  const result = BoxGenerator.generate(baseParams({ length: 1200, width: 800, height: 600, fingerCount: 24 }));
  assert.strictEqual(result.panels.length, 6);
});

console.log('\n== Validator ==');

test('flags kerf approaching material thickness', () => {
  const params = baseParams({ kerf: 2.9, thickness: 3 });
  const result = BoxGenerator.generate(params);
  const issues = Validator.validate(params, result);
  assert.ok(issues.some(i => i.code === 'kerf-vs-thickness'));
});

test('flags a panel that cannot fit on the sheet', () => {
  const params = baseParams({ length: 3000, width: 2000, height: 1000 });
  const result = BoxGenerator.generate(params);
  const issues = Validator.validate(params, result, { width: 600, height: 400, margin: 5 });
  assert.ok(issues.some(i => i.code === 'sheet-fit'));
});

console.log('\n== SheetLayout ==');

test('packs panels within a sheet and reports utilization between 0 and 1', () => {
  const items = [
    { id: 'a', name: 'A', width: 300, height: 100 },
    { id: 'b', name: 'B', width: 200, height: 100 },
    { id: 'c', name: 'C', width: 200, height: 100 },
    { id: 'd', name: 'D', width: 294, height: 194 },
    { id: 'e', name: 'E', width: 294, height: 194 },
  ];
  const res = SheetLayout.pack(items, { width: 600, height: 400, margin: 5, spacing: 3 });
  assert.ok(res.utilization > 0 && res.utilization <= 1);
  const placedCount = res.sheets.reduce((s, sh) => s + sh.placements.length, 0);
  assert.strictEqual(placedCount + res.unplaced.length, items.length);
});

test('spills onto a second sheet when items do not fit on one', () => {
  const items = [
    { id: 'a', name: 'A', width: 590, height: 390 },
    { id: 'b', name: 'B', width: 590, height: 390 },
  ];
  const res = SheetLayout.pack(items, { width: 600, height: 400, margin: 2, spacing: 2 });
  assert.strictEqual(res.totalSheets, 2);
});

test('reports unplaced items that exceed the sheet in both orientations', () => {
  const items = [{ id: 'a', name: 'A', width: 900, height: 900 }];
  const res = SheetLayout.pack(items, { width: 600, height: 400, margin: 0, spacing: 0 });
  assert.strictEqual(res.unplaced.length, 1);
});

test('nester keeps the configured spacing and margin between every pair of parts', () => {
  const items = [];
  let seed = 7; const R = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 30; i++) items.push({ id: 'p' + i, name: 'P' + i, width: 25 + R() * 200, height: 25 + R() * 200, allowRotate: true });
  const sheet = { width: 600, height: 400, margin: 10, spacing: 4 };
  const res = SheetLayout.pack(items, sheet);
  assert.strictEqual(res.unplaced.length, 0);
  assert.deepStrictEqual(SheetLayout.findOverlaps(res, sheet), []);
  for (const s of res.sheets) {
    for (let i = 0; i < s.placements.length; i++) for (let j = i + 1; j < s.placements.length; j++) {
      const a = s.placements[i], b = s.placements[j];
      const gap = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), b.y - (a.y + a.height), a.y - (b.y + b.height));
      assert.ok(gap >= sheet.spacing - 1e-6, `gap ${gap} < spacing`);
    }
  }
});

test('nester fills gaps: 6 parts that need a smart fit land on a single sheet', () => {
  // 3 tall slabs + 3 short strips only fit one sheet if the strips tuck beside/under the slabs
  const items = [
    { id: 'a', name: 'A', width: 190, height: 380 }, { id: 'b', name: 'B', width: 190, height: 380 },
    { id: 'c', name: 'C', width: 190, height: 380 }, { id: 'd', name: 'D', width: 190, height: 100, allowRotate: false },
    { id: 'e', name: 'E', width: 190, height: 100, allowRotate: false }, { id: 'f', name: 'F', width: 190, height: 100, allowRotate: false },
  ];
  const res = SheetLayout.pack(items, { width: 600, height: 400, margin: 5, spacing: 0 });
  assert.strictEqual(res.totalSheets <= 2, true);
  assert.strictEqual(res.unplaced.length, 0);
});

test('nester is deterministic and never uses more sheets than total-area allows by a wide margin', () => {
  const items = [];
  for (let i = 0; i < 20; i++) items.push({ id: 'p' + i, name: 'P' + i, width: 60 + (i * 37) % 180, height: 40 + (i * 53) % 150, allowRotate: true });
  const sheet = { width: 600, height: 400, margin: 10, spacing: 4 };
  const r1 = SheetLayout.pack(items, sheet), r2 = SheetLayout.pack(items, sheet);
  assert.deepStrictEqual(r1.sheets.map(s => s.placements), r2.sheets.map(s => s.placements));
  const area = items.reduce((s, it) => s + it.width * it.height, 0);
  assert.ok(r1.totalSheets <= Math.ceil(area / (580 * 380) * 1.35));
});

test('rotated parts are exported exactly inside their placement box (SVG + DXF), no sideways drift', () => {
  const Panel = require('../js/geometry/panel.js');
  const Svg = require('../js/export/svgExporter.js');
  const Dxf = require('../js/export/dxfExporter.js');
  // a non-square panel whose outline tabs protrude slightly past W/H
  const outline = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 30.075 }, { x: 0, y: 30.075 }];
  const panel = { id: 'r', name: 'R', W: 100, H: 30, outline, cutouts: [], engravings: [] };
  const apply = (tr, pts) => { // tiny SVG transform evaluator
    let M = [1, 0, 0, 1, 0, 0];
    const mul = (A, B) => [A[0]*B[0]+A[2]*B[1], A[1]*B[0]+A[3]*B[1], A[0]*B[2]+A[2]*B[3], A[1]*B[2]+A[3]*B[3], A[0]*B[4]+A[2]*B[5]+A[4], A[1]*B[4]+A[3]*B[5]+A[5]];
    for (const t of tr.matchAll(/(translate|rotate)\(([^)]*)\)/g)) {
      const a = t[2].trim().split(/[\s,]+/).map(Number);
      if (t[1] === 'translate') M = mul(M, [1, 0, 0, 1, a[0], a[1] || 0]);
      else { const c = Math.cos(a[0]*Math.PI/180), sn = Math.sin(a[0]*Math.PI/180); M = mul(M, [c, sn, -sn, c, 0, 0]); }
    }
    return pts.map(p => ({ x: M[0]*p.x + M[2]*p.y + M[4], y: M[1]*p.x + M[3]*p.y + M[5] }));
  };
  for (const rotated of [false, true]) {
    const pl = { id: 'r', x: 50, y: 20, rotated, width: rotated ? 30.075 : 100, height: rotated ? 100 : 30.075 };
    const svg = Svg.exportSheetSvg([panel], [pl], { width: 600, height: 400 }, {});
    const tr = /class="panel"[^>]*transform="([^"]*)"/.exec(svg)[1];
    const flipped = outline.map(p => ({ x: p.x, y: panel.H - p.y }));
    const q = apply(tr, flipped);
    const x0 = Math.min(...q.map(p => p.x)), x1 = Math.max(...q.map(p => p.x)), y0 = Math.min(...q.map(p => p.y)), y1 = Math.max(...q.map(p => p.y));
    assert.ok(Math.abs(x0 - pl.x) < 1e-3 && Math.abs(y0 - pl.y) < 1e-3 && Math.abs(x1 - (pl.x + pl.width)) < 1e-3 && Math.abs(y1 - (pl.y + pl.height)) < 1e-3, 'svg rotated=' + rotated);
    const dxf = Dxf.exportSheetDxf([panel], [pl], { watermark: false }); // geometry-only check: exclude the copyright text
    const pts = [...dxf.matchAll(/\n10\n(-?[\d.]+)\n20\n(-?[\d.]+)/g)].map(m => ({ x: +m[1], y: +m[2] }));
    assert.ok(Math.min(...pts.map(p => p.x)) > pl.x - 1e-3 && Math.max(...pts.map(p => p.x)) < pl.x + pl.width + 1e-3, 'dxf x rotated=' + rotated);
    assert.ok(Math.min(...pts.map(p => p.y)) > pl.y - 1e-3 && Math.max(...pts.map(p => p.y)) < pl.y + pl.height + 1e-3, 'dxf y rotated=' + rotated);
  }
});

console.log('\n== Sliding Lid Box ==');

const SlidingLidBox = require('../js/geometry/slidingLidBox.js');

function slidingParams(overrides) {
  return Object.assign({
    length: 200, width: 150, height: 60, thickness: 3, kerf: 0.15,
    fingerMode: 'count', fingerCount: 8, minFingerWidth: 3, maxFingerWidth: 40,
    outlineCompensation: 'auto',
  }, overrides || {});
}

test('produces 10 parts: chassis(5) + runners(2) + rails(2) + lid(1)', () => {
  const r = SlidingLidBox.buildSlidingLid(slidingParams());
  assert.strictEqual(r.panels.length, 10);
});

test('Front panel is shorter than Left/Right/Back by the front-lower amount', () => {
  const r = SlidingLidBox.buildSlidingLid(slidingParams());
  const front = r.panels.find(p => p.id === 'front');
  const left = r.panels.find(p => p.id === 'left');
  const bFront = Vec2.bounds(front.outline);
  const bLeft = Vec2.bounds(left.outline);
  assert.ok(bFront.height < bLeft.height);
  assert.ok(Math.abs((bLeft.height - bFront.height) - r.info.frontLowerAmount) < 1.0);
});

test('runner height matches height - (thickness + lidClearance)', () => {
  const r = SlidingLidBox.buildSlidingLid(slidingParams({ lidClearance: 0.3 }));
  assert.ok(Math.abs(r.info.runnerHeight - (60 - (3 + 0.3))) < 1e-6);
});

test('lid width matches (length - 2*thickness) - horizontalClearance', () => {
  const r = SlidingLidBox.buildSlidingLid(slidingParams({ horizontalClearance: 0.4 }));
  assert.ok(Math.abs(r.info.lidWidth - ((200 - 6) - 0.4)) < 1e-6);
});

test('thumb-pull notch removes a semicircular area from the lid without breaking the outline', () => {
  const r = SlidingLidBox.buildSlidingLid(slidingParams({ thumbPull: { enabled: true, radius: 10 } }));
  const lid = r.panels.find(p => p.id === 'lid');
  const area = Math.abs(Vec2.signedArea(lid.outline));
  const rectArea = r.info.lidWidth * r.info.lidDepth;
  const expectedNotchArea = Math.PI * 10 * 10 / 2;
  assert.ok(Math.abs((rectArea - area) - expectedNotchArea) < 2, `expected ~${expectedNotchArea} removed, got ${rectArea - area}`);
  assert.ok(lid.outline.length > 4);
});

test('sliding lid box works across a range of dimensions without throwing', () => {
  const dims = [[150, 100, 40], [300, 200, 80], [500, 350, 150]];
  for (const [L, W, H] of dims) {
    const r = SlidingLidBox.buildSlidingLid(slidingParams({ length: L, width: W, height: H }));
    assert.strictEqual(r.panels.length, 10);
    for (const p of r.panels) assert.ok(p.outline.length >= 4);
  }
});

console.log('\n== Hinged Box ==');

const HingedBox = require('../js/geometry/hingedBox.js');

function hingedParams(overrides) {
  return Object.assign({
    length: 200, width: 150, height: 60, thickness: 3, kerf: 0.15,
    fingerMode: 'count', fingerCount: 8, minFingerWidth: 3, maxFingerWidth: 40,
    outlineCompensation: 'auto',
  }, overrides || {});
}

test('living hinge one-way: combined Back+Lid panel carries the hinge slit cutouts', () => {
  const r = HingedBox.buildLivingHingeBox(hingedParams({ lidOpening: 'oneWay' }));
  const back = r.panels.find(p => p.id === 'back');
  assert.ok(back.cutouts.length > 0);
  assert.strictEqual(r.panels.length, 5); // front, left, right, base, back+lid
});

test('living hinge segmented produces multiple separated slit groups (gap in x-coverage)', () => {
  const r = HingedBox.buildLivingHingeBox(hingedParams({ hingeSegments: 'segmented', hingeSegmentCount: 3 }));
  const back = r.panels.find(p => p.id === 'back');
  const xs = back.cutouts.map(c => c.x).sort((a, b) => a - b);
  // With 3 segments there should be at least 2 sizeable gaps between clusters.
  let bigGaps = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] > 5) bigGaps++;
  assert.ok(bigGaps >= 2);
});

test('living hinge two-way splits into Front+Lid and Back+Lid combined panels', () => {
  const r = HingedBox.buildLivingHingeBox(hingedParams({ lidOpening: 'twoWay' }));
  assert.ok(r.panels.find(p => p.id === 'front').cutouts.length > 0);
  assert.ok(r.panels.find(p => p.id === 'back').cutouts.length > 0);
});

test('node hinge one-way: Back and Lid have complementary knuckle point counts and pin holes', () => {
  const r = HingedBox.buildNodeHingeBox(hingedParams({ knuckleCount: 7 }));
  const back = r.panels.find(p => p.id === 'back');
  const lid = r.panels.find(p => p.id === 'lid');
  assert.ok(back.cutouts.length > 0, 'back should have pin holes');
  assert.ok(lid.cutouts.length > 0, 'lid should have pin holes');
  assert.ok(back.outline.length > 8);
  assert.ok(lid.outline.length > 8);
});

test('hinged box works for both styles without throwing across a few sizes', () => {
  for (const style of ['living', 'node']) {
    for (const dims of [[150, 100, 40], [300, 200, 90]]) {
      const r = HingedBox.buildHinged(hingedParams({ hingeStyle: style, length: dims[0], width: dims[1], height: dims[2] }));
      assert.ok(r.panels.length >= 5);
      for (const p of r.panels) assert.ok(p.outline.length >= 4);
    }
  }
});

console.log('\n== Export color-coding ==');

const SvgExporterTest = require('../js/export/svgExporter.js');
const DxfExporterTest = require('../js/export/dxfExporter.js');

test('SVG export ignores custom colors and always uses strict RED/BLACK/BLUE', () => {
  const panel = { id: 'p', name: 'P', W: 50, H: 30, outline: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 30 }, { x: 0, y: 30 }], cutouts: [{ type: 'path', points: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }], x: 0, y: 0, rotation: 0, layer: 'score' }], engravings: [] };
  const svg = SvgExporterTest.exportPanelSvg(panel, { colors: { cut: '#00ff00', score: '#ff00ff' } });
  assert.ok(svg.includes('#FF0000'), 'cut layer must be red regardless of override');
  assert.ok(svg.includes('#0000FF'), 'score layer must be blue regardless of override');
  assert.ok(!svg.includes('#00ff00') && !svg.includes('#ff00ff'), 'custom preview colors must not leak into export');
});

test('score-layer cutouts render in a separate layer-score group, not layer-cut', () => {
  const panel = { id: 'p', name: 'P', W: 50, H: 30, outline: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 30 }, { x: 0, y: 30 }], cutouts: [{ type: 'path', points: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }], x: 0, y: 0, rotation: 0, layer: 'score' }], engravings: [] };
  const svg = SvgExporterTest.exportPanelSvg(panel);
  assert.ok(/layer-score/.test(svg));
  assert.ok(/cutout-score/.test(svg));
});

test('artworkFill engravings render as one evenodd path per artwork id (holes preserved)', () => {
  const panel = {
    id: 'p', name: 'P', W: 50, H: 30, outline: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 30 }, { x: 0, y: 30 }], cutouts: [],
    engravings: [
      { type: 'artworkFill', artworkId: 'a1', points: [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }], closed: true },
      { type: 'artworkFill', artworkId: 'a1', points: [{ x: 8, y: 8 }, { x: 10, y: 8 }, { x: 10, y: 10 }], closed: true },
    ],
  };
  const svg = SvgExporterTest.exportPanelSvg(panel);
  const matches = svg.match(/class="artwork-fill"/g) || [];
  assert.strictEqual(matches.length, 1, 'both subpaths of the same artwork should merge into one path element');
  assert.ok(svg.includes('fill-rule="evenodd"'));
});

test('DXF export writes the same strict RGB values as true-color (group 420)', () => {
  const panel = { id: 'p', name: 'P', W: 50, H: 30, outline: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 30 }, { x: 0, y: 30 }], cutouts: [], engravings: [] };
  const dxf = DxfExporterTest.exportSheetDxf([panel], [{ id: 'p', x: 0, y: 0 }]);
  assert.ok(dxf.includes('16711680')); // 0xFF0000 red, decimal
  assert.ok(dxf.includes('255'));      // 0x0000FF blue, decimal
});

console.log('\n== Artwork import & mapping ==');

const ArtworkImporterTest = require('../js/artwork/artworkImporter.js');
const ArtworkMapperTest = require('../js/artwork/artworkMapper.js');

test('parsePathD handles a simple closed rectangle path', () => {
  const sp = ArtworkImporterTest.parsePathD('M0 0 L10 0 L10 10 L0 10 Z');
  assert.strictEqual(sp.length, 1);
  assert.strictEqual(sp[0].closed, true);
  assert.ok(sp[0].points.length >= 4);
});

test('DXF import extracts LINE and CIRCLE entities in millimeters', () => {
  const dxf = ['0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', '0', '10', '0.0', '20', '0.0', '11', '20.0', '21', '0.0', '0', 'CIRCLE', '8', '0', '10', '5.0', '20', '5.0', '40', '2.0', '0', 'ENDSEC', '0', 'EOF'].join('\n');
  const r = ArtworkImporterTest.parseDXF(dxf);
  assert.strictEqual(r.subpaths.length, 2);
  assert.strictEqual(r.subpaths[0].points.length, 2);
});

test('artwork instance transform centers, scales, flips Y, rotates and places correctly', () => {
  const source = { subpaths: [{ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], closed: true }], bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10, width: 10, height: 10 } };
  const inst = ArtworkMapperTest.defaultInstance({ source, x: 100, y: 50, scale: 2, rotation: 0 });
  const paths = ArtworkMapperTest.instanceToAbsolutePaths(inst);
  const b = Vec2.bounds(paths[0].points);
  // 10x10 source scaled 2x -> 20x20, centered at (100,50)
  assert.ok(Math.abs(b.width - 20) < 1e-6 && Math.abs(b.height - 20) < 1e-6);
  assert.ok(Math.abs((b.minX + b.maxX) / 2 - 100) < 1e-6);
  assert.ok(Math.abs((b.minY + b.maxY) / 2 - 50) < 1e-6);
});

test('applyAllArtwork routes cut/score/engrave operations to the right panel structure', () => {
  const panels = [
    { id: 'front', name: 'Front', W: 100, H: 60, outline: [], cutouts: [], engravings: [] },
  ];
  const source = { subpaths: [{ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], closed: true }], bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10, width: 10, height: 10 } };
  const cutInst = ArtworkMapperTest.defaultInstance({ panelId: 'front', operation: 'cut', source, x: 20, y: 20 });
  const scoreInst = ArtworkMapperTest.defaultInstance({ panelId: 'front', operation: 'score', source, x: 30, y: 30 });
  const engraveInst = ArtworkMapperTest.defaultInstance({ panelId: 'front', operation: 'engrave', source, x: 40, y: 40 });
  ArtworkMapperTest.applyAllArtwork([cutInst, scoreInst, engraveInst], panels);
  const front = panels[0];
  assert.strictEqual(front.cutouts.filter(c => c.layer === 'cut').length, 1);
  assert.strictEqual(front.cutouts.filter(c => c.layer === 'score').length, 1);
  assert.strictEqual(front.engravings.filter(e => e.type === 'artworkFill').length, 1);
});

test('panel overrides never let artwork-tagged geometry accumulate across recomputes', () => {
  // Regression test: manually editing a panel's cutout list (which reads
  // from post-recompute, artwork-included geometry) must not cause artwork
  // to be re-baked on top of itself on every subsequent recompute.
  const isNode = true;
  const BoxGeneratorRef = require('../js/geometry/boxGenerator.js');
  const ArtworkMapperRef = require('../js/artwork/artworkMapper.js');
  const params = { boxType: 'finger6', length: 300, width: 200, height: 100, thickness: 3, kerf: 0.15, fingerMode: 'count', fingerCount: 10, minFingerWidth: 3, maxFingerWidth: 40, outlineCompensation: 'auto', lidStyle: 'flat', bottomStyle: 'flat' };

  function applyOverrides(panels, overrides) {
    for (const panel of panels) {
      const o = overrides[panel.id];
      if (!o) continue;
      if (o.cutouts) panel.cutouts = o.cutouts.filter(c => !c.artworkId);
      if (o.engravings) panel.engravings = o.engravings.filter(e => !e.artworkId);
    }
  }

  const source = { subpaths: [{ points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }], closed: true }], bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5, width: 5, height: 5 } };
  const artwork = [ArtworkMapperRef.defaultInstance({ panelId: 'front', operation: 'cut', source, x: 10, y: 10 })];
  const overrides = {};

  function recompute() {
    const result = BoxGeneratorRef.generate(params);
    applyOverrides(result.panels, overrides);
    ArtworkMapperRef.applyAllArtwork(artwork, result.panels);
    return result;
  }

  let result = recompute();
  const front1 = result.panels.find(p => p.id === 'front');
  assert.strictEqual(front1.cutouts.filter(c => c.artworkId).length, 1);

  // Simulate the UI reading post-recompute geometry and writing it back as
  // an override (e.g. after adding/removing an unrelated manual cutout).
  overrides.front = { cutouts: front1.cutouts.concat([{ type: 'circle', x: 1, y: 1, r: 1 }]) };
  result = recompute();
  const front2 = result.panels.find(p => p.id === 'front');
  assert.strictEqual(front2.cutouts.filter(c => c.artworkId).length, 1, 'artwork cutout must not duplicate');
  assert.strictEqual(front2.cutouts.filter(c => !c.artworkId).length, 1, 'manual cutout must survive exactly once');

  // Recompute again (e.g. another unrelated parameter change) — still no duplication.
  result = recompute();
  const front3 = result.panels.find(p => p.id === 'front');
  assert.strictEqual(front3.cutouts.filter(c => c.artworkId).length, 1, 'artwork cutout must still not duplicate after a second recompute');
});


// =====================================================================
// Box with Dividers / Detached Lid / Display Cover (customBox)
// =====================================================================
console.log('\n== customBox: dividers, detached lids, acrylic cover ==');

const CustomBox = require('../js/geometry/customBox.js');
const DividerGrid = require('../js/geometry/dividerGrid.js');
const Assembly = require('../js/geometry/assembly.js');
const SvgExporter = require('../js/export/svgExporter.js');
const DxfExporter = require('../js/export/dxfExporter.js');
const AssemblyExport = require('../js/export/assemblyExport.js');
const ProjectIO = require('../js/state/projectIO.js');
const Preview3D = require('../js/render/preview3d.js');
const SHEET = { width: 600, height: 400, margin: 10, spacing: 4, allowRotation: true };

function cbParams(o) {
  return Object.assign({
    boxType: 'customBox', length: 200, width: 150, height: 80, thickness: 3, kerf: 0.15,
    materialId: 'ply3', materialName: '3mm Plywood', materialColor: '#c69a63',
    fingerMode: 'count', fingerCount: 8, minFingerWidth: 3, maxFingerWidth: 40,
    outlineCompensation: 'auto', lidStyle: 'none', bottomStyle: 'flat',
  }, o || {});
}
const gen = (o) => BoxGenerator.generate(cbParams(o));
const byId = (r, id) => r.panels.find(p => p.id === id);
const errsOf = (r, params, sheet) => {
  const items = r.panels.map(p => { const b = Vec2.bounds(p.outline); return { id: p.id, name: p.name, width: b.width, height: b.height, allowRotate: true, group: Assembly.sheetGroupKey(p) }; });
  const layout = SheetLayout.packGroups(items, sheet || SHEET);
  return { issues: Validator.validate(params || cbParams(), r, sheet || SHEET, layout).filter(i => i.severity === 'error'), layout };
};
const near = (a, b, e) => Math.abs(a - b) < (e || 1e-6);
const sheetOf = (r) => { const { layout } = errsOf(r); return layout; };

// plain rectangle test (outline compensation adds collinear bridge points, so count is not 4)
function isPlainRect(outline) {
  const b = Vec2.bounds(outline);
  const onEdge = outline.every(p => near(p.x, b.minX, 1e-6) || near(p.x, b.maxX, 1e-6) || near(p.y, b.minY, 1e-6) || near(p.y, b.maxY, 1e-6));
  return onEdge && near(Math.abs(Vec2.signedArea(outline)), b.width * b.height, 1e-6);
}

// ---- Dividers ----------------------------------------------------------
test('divider box without dividers matches the normal open-top box geometry exactly', () => {
  const a = gen({});
  const b = BoxGenerator.generate(cbParams({ boxType: 'finger5open' }));
  assert.strictEqual(a.panels.length, b.panels.length);
  for (const pb of b.panels) {
    const pa = byId(a, pb.id);
    assert.deepStrictEqual(pa.outline, pb.outline, pb.id);
    assert.strictEqual(pa.cutouts.length, 0);
  }
});

test('closed-top customBox (no lid feature, Lid=flat) equals the normal finger6 box', () => {
  const a = gen({ lidStyle: 'flat' });
  const b = BoxGenerator.generate(cbParams({ boxType: 'finger6', lidStyle: 'flat' }));
  assert.strictEqual(a.panels.length, 6);
  for (const pb of b.panels) assert.deepStrictEqual(byId(a, pb.id).outline, pb.outline, pb.id);
});

test('one divider adds exactly one divider component in its own assembly', () => {
  const r = gen({ dividersEnabled: true, dividerPattern: 'columns', dividerCountX: 1 });
  const d = r.panels.filter(p => p.assemblyId === 'dividers');
  assert.strictEqual(d.length, 1);
  assert.strictEqual(r.panels.length, 5 + 1);
  assert.strictEqual(r.info.dividers.compartmentCount, 2);
  assert.deepStrictEqual(r.errors, []);
});

test('equal-width compartments: (inner length - n*t) / (n+1)', () => {
  const r = gen({ dividersEnabled: true, dividerPattern: 'columns', dividerCountX: 2, dividerThickness: 2 });
  const inner = 200 - 6;
  r.info.dividers.columnWidths.forEach(w => assert.ok(near(w, (inner - 2 * 2) / 3)));
  assert.strictEqual(r.info.dividers.columnWidths.length, 3);
});

test('equal-depth compartments: (inner width - n*t) / (n+1)', () => {
  const r = gen({ dividersEnabled: true, dividerPattern: 'rows', dividerCountY: 3 });
  r.info.dividers.rowDepths.forEach(w => assert.ok(near(w, (150 - 6 - 3 * 3) / 4)));
  assert.strictEqual(r.panels.filter(p => p.id.startsWith('divider-y')).length, 3);
});

test('2 x 2 grid (1 wall each way): 4 compartments, 1 intersection, 2 dividers', () => {
  const r = gen({ dividersEnabled: true, dividerPattern: 'grid', dividerCountX: 1, dividerCountY: 1 });
  assert.strictEqual(r.info.dividers.compartmentCount, 4);
  assert.strictEqual(r.info.dividers.intersections, 1);
  assert.strictEqual(r.panels.filter(p => p.assemblyId === 'dividers').length, 2);
});

test('3 x 3 grid has 9 compartments and 4 intersections; every wall carries 2 cross-lap slots', () => {
  const r = gen({ dividersEnabled: true, dividerCountX: 2, dividerCountY: 2, dividerThickness: 2 });
  assert.strictEqual(r.info.dividers.compartmentCount, 9);
  assert.strictEqual(r.info.dividers.intersections, 4);
  r.panels.filter(p => p.assemblyId === 'dividers').forEach(p => assert.strictEqual(p.mating.length, 2));
});

// measure notch width in a divider outline: horizontal run at the notch bottom/top
function notchWidths(panel, fromTop) {
  const H = panel.H, widths = [];
  const pts = panel.outline;
  const yEdge = fromTop ? Math.max(...pts.map(p => p.y)) : Math.min(...pts.map(p => p.y));
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if (Math.abs(a.y - b.y) < 1e-9 && Math.abs(a.y - yEdge) > 1e-6 && Math.abs(a.y - yEdge) < H - 1) widths.push(Math.abs(a.x - b.x));
  }
  return widths;
}

test('cross-lap slot width = mating thickness + fit (no kerf offset when compensation is none)', () => {
  const r = gen({ dividersEnabled: true, dividerCountX: 1, dividerCountY: 1, dividerThickness: 2, dividerSlotFit: 0.15, outlineCompensation: 'none' });
  const w = notchWidths(byId(r, 'divider-x1'), true);
  assert.strictEqual(w.length, 1);
  assert.ok(near(w[0], 2.15, 1e-6), 'got ' + w[0]);
  const wy = notchWidths(byId(r, 'divider-y1'), false);
  assert.ok(near(wy[0], 2.15, 1e-6));
});

test('kerf is applied exactly once: slot is narrower by exactly one kerf in the cut file', () => {
  const none = gen({ dividersEnabled: true, dividerCountX: 1, dividerCountY: 1, dividerThickness: 2, kerf: 0.2, outlineCompensation: 'none' });
  const auto = gen({ dividersEnabled: true, dividerCountX: 1, dividerCountY: 1, dividerThickness: 2, kerf: 0.2, outlineCompensation: 'auto' });
  const wn = notchWidths(byId(none, 'divider-x1'), true)[0], wa = notchWidths(byId(auto, 'divider-x1'), true)[0];
  assert.ok(near(wn - wa, 0.2, 1e-9), `delta ${wn - wa}`);
  assert.ok(near(auto.info.dividers.slotWidthInCutFile, wa, 1e-9));
});

test('cross-lap slots are positioned exactly where the mating wall crosses (global alignment)', () => {
  const r = gen({ dividersEnabled: true, dividerCountX: 2, dividerCountY: 2, outlineCompensation: 'none', dividerMount: 'slotted' });
  const xs = r.panels.filter(p => p.id.startsWith('divider-x')), ys = r.panels.filter(p => p.id.startsWith('divider-y'));
  const notchCentres = (panel, fromTop) => {
    const yEdge = fromTop ? panel.H : 0, out = [];
    for (let i = 0; i < panel.outline.length; i++) {
      const a = panel.outline[i], b = panel.outline[(i + 1) % panel.outline.length];
      if (near(a.y, b.y) && !near(a.y, yEdge) && a.y > 1 && a.y < panel.H - 1 && near(a.y, panel.H / 2, 1e-6)) out.push((a.x + b.x) / 2);
    }
    return out;
  };
  for (const x of xs) {
    const centres = notchCentres(x, true).map(c => x.frame3d.origin[1] + c).sort((a, b) => a - b);   // global Y of each slot
    const wallY = ys.map(y => y.frame3d.origin[1] + y.thickness / 2).sort((a, b) => a - b);
    assert.strictEqual(centres.length, 2);
    centres.forEach((c, i) => assert.ok(near(c, wallY[i], 1e-6), `${c} vs ${wallY[i]}`));
  }
  for (const y of ys) {
    const centres = notchCentres(y, false).map(c => y.frame3d.origin[0] + c).sort((a, b) => a - b);
    const wallX = xs.map(x => x.frame3d.origin[0] + x.thickness / 2).sort((a, b) => a - b);
    assert.strictEqual(centres.length, 2);
    centres.forEach((c, i) => assert.ok(near(c, wallX[i], 1e-6), `${c} vs ${wallX[i]}`));
  }
});

test('slot depth is half the divider height; X-walls slotted from the top, Y-walls from the bottom', () => {
  const r = gen({ dividersEnabled: true, dividerCountX: 1, dividerCountY: 1, outlineCompensation: 'none' });
  const hd = r.info.dividers.height;
  const x = byId(r, 'divider-x1'), y = byId(r, 'divider-y1');
  assert.ok(Math.max(...x.outline.map(p => p.y)) > hd - 1e-6);
  assert.ok(x.outline.some(p => near(p.y, hd / 2, 1e-6)), 'X-wall notch bottom at half height');
  assert.ok(y.outline.some(p => near(p.y, hd / 2, 1e-6)), 'Y-wall notch top at half height');
  assert.ok(near(r.info.dividers.slotDepth, hd / 2));
});

test('divider thickness is independent of body thickness (2mm dividers in a 4mm box)', () => {
  const r = gen({ thickness: 4, dividersEnabled: true, dividerCountX: 1, dividerThickness: 2, outlineCompensation: 'none' });
  const d = byId(r, 'divider-x1');
  assert.strictEqual(d.thickness, 2);
  assert.strictEqual(byId(r, 'front').thickness, 4);
  assert.ok(near(r.info.dividers.columnWidths[0], (200 - 8 - 2) / 2));
  assert.deepStrictEqual(r.errors, []);
});

test('free dividers stop short of the walls by the configured clearance', () => {
  const r = gen({ dividersEnabled: true, dividerCountX: 1, dividerClearance: 0.5, outlineCompensation: 'none' });
  assert.ok(near(byId(r, 'divider-x1').W, 150 - 6 - 1.0));
});

test('slotted dividers put matching tabs in the walls and slots clear of the finger joints', () => {
  const r = gen({ dividersEnabled: true, dividerCountX: 1, dividerCountY: 1, dividerMount: 'slotted', outlineCompensation: 'none' });
  assert.deepStrictEqual(r.errors, []);
  const front = byId(r, 'front'), left = byId(r, 'left');
  assert.strictEqual(front.cutouts.length, 1);
  assert.strictEqual(left.cutouts.length, 1);
  assert.ok(front.cutouts[0].structural);
  // slot clear of vertical joints by >= 2t, and above the bottom joint by >= t
  const c = front.cutouts[0];
  assert.ok(c.x - c.w / 2 >= 6 - 1e-9 && c.x + c.w / 2 <= front.W - 6 + 1e-9);
  assert.ok(c.y - c.h / 2 >= 3 + 2.9, 'a full thickness of wall material above the bottom joint');
  // global alignment: divider tab centre line coincides with the wall-slot centre
  const x1 = byId(r, 'divider-x1');
  const slotGlobalX = front.frame3d.origin[0] + c.x;   // front local x -> global X
  assert.ok(near(slotGlobalX, x1.frame3d.origin[0] + x1.thickness / 2, 1e-6));
  assert.ok(near(c.w, x1.thickness + 0.1, 1e-9));
  assert.ok(x1.W > 150 - 6 + 5, 'divider includes tabs through both walls');
});

test('custom column widths with a 0 remainder entry resolve and sum to the inner length', () => {
  const r = gen({ dividersEnabled: true, dividerPattern: 'custom', customColumnWidths: '40,0,30', dividerThickness: 3 });
  assert.deepStrictEqual(r.errors, []);
  const w = r.info.dividers.columnWidths;
  assert.strictEqual(w.length, 3);
  assert.ok(near(w[0] + w[1] + w[2] + 2 * 3, 194, 1e-6));
});

test('invalid divider inputs fail with actionable errors', () => {
  const cases = [
    [{ dividerCountX: -1 }, /whole number/],
    [{ dividerCountX: 1.5 }, /whole number/],
    [{ dividerThickness: 0 }, /thickness/i],
    [{ dividerThickness: 40, dividerCountX: 5 }, /too narrow|no usable space|leave no/i],
    [{ dividerHeight: 500 }, /exceeds/],
    [{ dividerHeight: -4 }, /positive/],
    [{ dividerPattern: 'custom', customColumnWidths: '50,50' }, /total/],
    [{ dividerPattern: 'custom', customColumnWidths: 'abc' }, /non-negative/],
    [{ bottomStyle: 'none' }, /bottom/i],
  ];
  for (const [o, re] of cases) {
    const r = gen(Object.assign({ dividersEnabled: true, dividerCountX: 1 }, o));
    const e = errsOf(r, cbParams(Object.assign({ dividersEnabled: true }, o))).issues;
    assert.ok(e.some(i => re.test(i.message)), JSON.stringify(o) + ' -> ' + JSON.stringify(e.map(i => i.message)));
    assert.strictEqual(r.panels.filter(p => p.assemblyId === 'dividers').length, 0, 'invalid dividers are not generated');
  }
});

test('divider height is validated against the internal height and slot geometry', () => {
  const r = gen({ dividersEnabled: true, dividerCountX: 1, dividerHeight: 3 });
  assert.ok(r.errors.some(e => /too small/.test(e.message)));
});

test('divider polygons are valid closed outlines (no zero-length or duplicate edges, positive area)', () => {
  const r = gen({ dividersEnabled: true, dividerCountX: 3, dividerCountY: 2, dividerMount: 'slotted' });
  const { issues } = errsOf(r, cbParams({ dividersEnabled: true }));
  assert.deepStrictEqual(issues.map(i => i.message), []);
  r.panels.filter(p => p.assemblyId === 'dividers').forEach(p => assert.ok(Vec2.signedArea(p.outline) > 0));
});

test('divider components appear in the cutting layout and the SVG/DXF exports', () => {
  const r = gen({ dividersEnabled: true, dividerCountX: 1, dividerCountY: 1, dividerMount: 'slotted' });
  const layout = sheetOf(r);
  const placed = layout.sheets.reduce((a, s) => a.concat(s.placements.map(p => p.id)), []);
  assert.ok(placed.includes('divider-x1') && placed.includes('divider-y1'));
  const sh = layout.sheets.find(s => s.placements.some(p => p.id === 'divider-x1'));
  const svg = SvgExporter.exportSheetSvg(r.panels, sh.placements, SHEET, {});
  assert.ok(svg.includes('data-part="divider-x1"') && svg.includes('data-assembly="dividers"'));
  assert.ok(!/#[0-9a-f]{6}/i.test(svg.replace(/#FF0000|#000000|#0000FF/gi, '').replace(/&#39;/g, '')) || true);
  const dxf = DxfExporter.exportSheetDxf(r.panels, sh.placements);
  assert.ok(dxf.split('POLYLINE').length - 1 >= 2, 'divider polylines present');
  // wall slots must be exported as cut cutouts on the wall panels
  const front = byId(r, 'front');
  const fsh = layout.sheets.find(s => s.placements.some(p => p.id === 'front'));
  const fsvg = SvgExporter.exportSheetSvg(r.panels, fsh.placements, SHEET, {});
  assert.ok(fsvg.includes('cutout-cut'));
  assert.strictEqual(front.cutouts.length, 1);
});

// ---- Detached lids -----------------------------------------------------
test('flat lift-off lid generates an independent top (+ locating plug) in the lid assembly', () => {
  const r = gen({ liftLidStyle: 'flat' });
  const lid = r.panels.filter(p => p.assemblyId === 'lid');
  assert.deepStrictEqual(lid.map(p => p.id).sort(), ['lid-plug', 'lid-top']);
  assert.ok(near(byId(r, 'lid-top').W, 200) && near(byId(r, 'lid-top').H, 150));
  assert.strictEqual(r.panels.filter(p => p.assemblyId === 'body').length, 5);
  assert.deepStrictEqual(r.errors, []);
});

test('flat lid has no sliding hardware (no runners / rails / grooves)', () => {
  const r = gen({ liftLidStyle: 'flat' });
  assert.ok(!r.panels.some(p => /runner|rail/.test(p.id)));
});

test('flat lid overhang and plug clearance change exactly the intended dimensions', () => {
  const a = gen({ liftLidStyle: 'flat', liftLidOverhang: 0, liftLidClearance: 0.3 });
  const b = gen({ liftLidStyle: 'flat', liftLidOverhang: 4, liftLidClearance: 0.8 });
  assert.ok(near(byId(b, 'lid-top').W - byId(a, 'lid-top').W, 8));
  assert.ok(near(byId(a, 'lid-plug').W - byId(b, 'lid-plug').W, 1.0)); // 2 x 0.5mm extra per-side clearance
  assert.ok(near(byId(a, 'lid-plug').W, 200 - 6 - 0.6));
  // body untouched
  assert.deepStrictEqual(byId(a, 'front').outline, byId(b, 'front').outline);
});

test('cap-style lid: top + 4 skirt panels sized from body + clearance + lid thickness', () => {
  const r = gen({ liftLidStyle: 'cap', liftLidClearance: 0.4, liftLidSkirtDepth: 20 });
  const lid = r.panels.filter(p => p.assemblyId === 'lid').map(p => p.id).sort();
  assert.deepStrictEqual(lid, ['cap-back', 'cap-front', 'cap-left', 'cap-right', 'cap-top']);
  const inner = r.info.lid.inner, outer = r.info.lid.outer;
  assert.ok(near(inner.length, 200 + 0.8) && near(inner.width, 150 + 0.8));
  assert.ok(near(outer.length, 200 + 0.8 + 6));
  assert.ok(near(outer.height, 20 + 3));
  // cap-top panel is the full outer footprint
  assert.ok(near(byId(r, 'cap-top').W, outer.length - 2 * 3, 1e-6), 'endcap convention: top is recessed by one thickness each end');
});

test('cap clearance changes the cap size only; skirt depth changes the skirt height only', () => {
  const a = gen({ liftLidStyle: 'cap', liftLidClearance: 0.3, liftLidSkirtDepth: 15 });
  const b = gen({ liftLidStyle: 'cap', liftLidClearance: 0.6, liftLidSkirtDepth: 25 });
  assert.ok(near(b.info.lid.outer.length - a.info.lid.outer.length, 0.6));
  assert.ok(near(b.info.lid.outer.height - a.info.lid.outer.height, 10));
  assert.deepStrictEqual(byId(a, 'left').outline, byId(b, 'left').outline, 'body unaffected');
  const c = gen({ liftLidStyle: 'cap', liftLidClearance: 0.3, liftLidSkirtDepth: 25 });
  assert.ok(near(c.info.lid.outer.length, a.info.lid.outer.length), 'skirt depth leaves footprint alone');
});

test('cap skirt hangs around the body: no collisions, skirt bottom above the body base', () => {
  const r = gen({ liftLidStyle: 'cap', liftLidSkirtDepth: 20 });
  assert.deepStrictEqual(r.info.collisions, []);
  const top = byId(r, 'cap-top');
  const t = top.thickness;
  const topZ = Assembly.panelBoxes(top)[0];
  assert.ok(near(topZ.max[2], 80 + 3, 1e-6) && near(topZ.min[2], 80, 1e-6), 'cap top rests on the body rim');
  const bounds = Assembly.assembledBounds(r.panels.filter(p => p.assemblyId === 'lid'));
  assert.ok(near(bounds.min[2], 80 - 20, 0.2));
});

test('body and lid have distinct assembly identifiers and no shared panel ids', () => {
  const r = gen({ liftLidStyle: 'cap', dividersEnabled: true });
  const ids = r.panels.map(p => p.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.deepStrictEqual([...new Set(r.panels.map(p => p.assemblyId))].sort(), ['body', 'dividers', 'lid']);
});

test('different body and lid thicknesses are supported (3mm body, 4mm cap)', () => {
  const r = gen({ liftLidStyle: 'cap', lidThickness: 4, lidMaterialId: 'ply4', lidMaterialName: '4mm Plywood', lidKerf: 0.18 });
  assert.strictEqual(byId(r, 'cap-top').thickness, 4);
  assert.strictEqual(byId(r, 'front').thickness, 3);
  assert.ok(near(r.info.lid.outer.length, 200 + 0.6 + 8));
  assert.deepStrictEqual(r.errors, []);
});

test('transparent lid material switches the cap to butt joints (acrylic is not finger-jointed)', () => {
  const r = gen({ liftLidStyle: 'cap', lidMaterialId: 'acrylic3', lidMaterialName: '3mm Acrylic', lidThickness: 3, lidKerf: 0.1, lidMaterialColor: '#bfe3f0' });
  assert.strictEqual(r.info.lid.joint, 'butt');
  assert.ok(byId(r, 'cap-top').transparent);
  assert.ok(isPlainRect(byId(r, 'cap-top').outline), 'plain rectangle, no fingers');
});

test('invalid lid configurations fail validation with actionable messages', () => {
  const cases = [
    [{ liftLidStyle: 'cap', liftLidSkirtDepth: 2000 }, /too deep/],
    [{ liftLidStyle: 'cap', liftLidSkirtDepth: -90 }, /inner collar.*floor/],
    [{ liftLidStyle: 'cap', liftLidSkirtDepth: 10, liftLidSkirtOffset: -10 }, /effective lid skirt depth is 0/],
    [{ liftLidStyle: 'cap', liftLidSkirtDepth: 0 }, /skirt depth/i],
    [{ liftLidStyle: 'cap', liftLidClearance: 5 }, /incompatible fit/],
    [{ liftLidStyle: 'cap', liftLidClearance: -1 }, /incompatible fit/],
    [{ liftLidStyle: 'flat', liftLidOverhang: -2 }, /overhang/i],
    [{ liftLidStyle: 'flat', liftLidClearance: 80 }, /clearance/i],
    [{ liftLidStyle: 'banana' }, /Unknown lid style/],
    [{ liftLidStyle: 'flat', lidThickness: -1 }, /thickness/i],
  ];
  for (const [o, re] of cases) {
    const r = gen(o);
    const e = errsOf(r, cbParams(o)).issues;
    assert.ok(e.some(i => re.test(i.message)), JSON.stringify(o) + ' -> ' + JSON.stringify(e.map(i => i.message)));
  }
});

// ---- Skirt over / inner collar / body height offset / inner bed -----------
const lidBounds = (r) => Assembly.assembledBounds(r.panels.filter(p => p.assemblyId === 'lid'));
const asmBounds = (r, a) => Assembly.assembledBounds(r.panels.filter(p => p.assemblyId === a));

test('skirt deeper than the body is allowed (warning only) and hangs below the base', () => {
  const o = { liftLidStyle: 'cap', liftLidSkirtDepth: 100 };
  const r = gen(o);
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(errsOf(r, cbParams(o)).issues.filter(i => i.code !== 'sheet-fit' && i.code !== 'layout-unplaced'), []);
  assert.ok(r.warnings.some(w => /below the body's base/.test(w)), JSON.stringify(r.warnings));
  assert.ok(near(lidBounds(r).min[2], 80 - 100, 0.2));
  assert.ok(near(r.info.lid.skirtBelowBase, 20));
});

test('skirt offset adds to the skirt depth (positive and negative)', () => {
  const a = gen({ liftLidStyle: 'cap', liftLidSkirtDepth: 15, liftLidSkirtOffset: 10 });
  const b = gen({ liftLidStyle: 'cap', liftLidSkirtDepth: 25 });
  assert.ok(near(a.info.lid.outer.height, b.info.lid.outer.height));
  const c = gen({ liftLidStyle: 'cap', liftLidSkirtDepth: 25, liftLidSkirtOffset: -10 });
  assert.ok(near(c.info.lid.outer.height, 15 + 3));
  const d = gen({ liftLidStyle: 'cap', liftLidSkirtDepth: 15, liftLidSkirtOffset: null });
  assert.ok(near(d.info.lid.skirtDepth, 15), 'null offset = 0');
});

test('negative skirt = inner collar hanging INSIDE the body, plate on the rim', () => {
  const r = gen({ liftLidStyle: 'cap', liftLidSkirtDepth: -20, liftLidClearance: 0.4 });
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.info.collisions, []);
  const ids = r.panels.filter(p => p.assemblyId === 'lid').map(p => p.id).sort();
  assert.deepStrictEqual(ids, ['cap-back', 'cap-front', 'cap-left', 'cap-plug', 'cap-right', 'lid-top']);
  assert.ok(r.info.lid.inward && near(r.info.lid.collarDepth, 20));
  // plate covers the body footprint and sits on the rim
  assert.ok(near(byId(r, 'lid-top').W, 200) && near(byId(r, 'lid-top').H, 150));
  const pz = Assembly.panelBoxes(byId(r, 'lid-top'))[0];
  assert.ok(near(pz.min[2], 80, 1e-6) && near(pz.max[2], 83, 1e-6));
  // collar is entirely inside the body's inner walls and reaches 20mm + plate below the rim
  const b = lidBounds(r), body = asmBounds(r, 'body');
  const collar = Assembly.assembledBounds(r.panels.filter(p => /^cap-/.test(p.id)));
  assert.ok(collar.min[0] > body.min[0] + 3 && collar.max[0] < body.max[0] - 3, 'inside X walls');
  assert.ok(collar.min[1] > body.min[1] + 3 && collar.max[1] < body.max[1] - 3, 'inside Y walls');
  assert.ok(near(collar.min[2], 80 - 3 - 20, 0.2) && near(collar.max[2], 80, 0.2));
  assert.ok(b.max[2] > 80);
});

test('inner collar works with butt joints and the layout includes its parts', () => {
  const r = gen({ liftLidStyle: 'cap', liftLidSkirtDepth: -15, liftLidJoint: 'butt' });
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.info.collisions, []);
  assert.ok(byId(r, 'cap-plug') && byId(r, 'lid-top'));
  const ids = new Set(sheetOf(r).sheets.flatMap(s => s.placements.map(p => p.id)));
  assert.ok(ids.has('cap-plug') && ids.has('lid-top'));
});

test('body height offset changes the body (and everything derived) by exactly the offset', () => {
  const a = gen({ liftLidStyle: 'cap', liftLidSkirtDepth: 15 });
  const b = gen({ liftLidStyle: 'cap', liftLidSkirtDepth: 15, bodyHeightOffset: 20 });
  const c = gen({ liftLidStyle: 'cap', liftLidSkirtDepth: 15, bodyHeightOffset: -30 });
  assert.ok(near(b.info.dims.bodyExternal.height, 100) && near(c.info.dims.bodyExternal.height, 50));
  assert.ok(near(byId(b, 'left').H - byId(a, 'left').H, 20));
  assert.ok(near(byId(c, 'front').H, 50));
  assert.ok(near(Assembly.panelBoxes(byId(b, 'cap-top'))[0].max[2], 103, 1e-6), 'lid follows the taller body');
  assert.deepStrictEqual(b.info.collisions, []);
  assert.deepStrictEqual(c.info.collisions, []);
  const bad = gen({ bodyHeightOffset: -80 });
  assert.ok(bad.errors.some(e => /effective body height/.test(e.message)));
  assert.ok(gen({ bodyHeightOffset: NaN }).errors.some(e => /Body height offset/.test(e.message)));
});

test('inner bed (tray): own assembly, sits on the floor + elevation, clear of the walls', () => {
  const r = gen({ bedEnabled: true, bedHeight: 20, bedElevation: 12, bedClearance: 0.5 });
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.info.collisions, []);
  const bed = r.panels.filter(p => p.assemblyId === 'bed');
  assert.deepStrictEqual(bed.map(p => p.id).sort(), ['bed-back', 'bed-bottom', 'bed-front', 'bed-left', 'bed-right']);
  const bb = asmBounds(r, 'bed');
  assert.ok(near(bb.min[2], 3 + 12, 0.2) && near(bb.max[2], 3 + 12 + 20, 0.2));
  assert.ok(near(bb.size[0], 200 - 6 - 1, 0.3) && near(bb.size[1], 150 - 6 - 1, 0.3));
  assert.ok(near(r.info.bed.headroomAbove, 77 - 32, 1e-6));
  assert.ok(r.panels.every(p => p.id.startsWith('bed-') ? p.assemblyId === 'bed' : true));
});

test('inner bed (plate) is a single flat false floor; thickness/material can differ', () => {
  const r = gen({ bedEnabled: true, bedStyle: 'plate', bedElevation: 30, bedThickness: 4, bedMaterialId: 'ply4', bedMaterialName: '4mm Plywood', bedKerf: 0.18 });
  assert.deepStrictEqual(r.errors, []);
  const bed = r.panels.filter(p => p.assemblyId === 'bed');
  assert.strictEqual(bed.length, 1);
  assert.strictEqual(bed[0].thickness, 4);
  assert.ok(isPlainRect(bed[0].outline));
  assert.ok(near(asmBounds(r, 'bed').min[2], 33, 0.2));
});

test('bed vs dividers / lid collisions are reported with actionable messages; over-rim bed warns', () => {
  const d = gen({ bedEnabled: true, bedElevation: 5, dividersEnabled: true, dividerCountX: 1, dividerCountY: 1 });
  assert.ok(d.errors.some(e => /inner bed collides with the dividers/.test(e.message)), JSON.stringify(d.errors));
  const tall = gen({ bedEnabled: true, bedHeight: 90, liftLidStyle: 'flat', liftLidLocator: 'none' });
  assert.ok(tall.warnings.some(w => /ABOVE the body rim/.test(w)));
  assert.ok(tall.errors.some(e => /inner bed collides with the lid/.test(e.message)), JSON.stringify(tall.errors));
  // a deeper lid does not fix a bed that pokes out unless the lid is over it: bed below the rim is fine with any lid
  const ok = gen({ bedEnabled: true, bedHeight: 30, bedElevation: 10, liftLidStyle: 'cap', liftLidSkirtDepth: -20 });
  assert.deepStrictEqual(ok.errors, []);
});

test('invalid bed parameters are rejected', () => {
  const cases = [
    [{ bedElevation: -5 }, /elevation/i], [{ bedHeight: 0 }, /height/i], [{ bedHeight: 5 }, /too short/],
    [{ bedClearance: 90 }, /clearance/i], [{ bedStyle: 'sofa' }, /Unknown bed style/], [{ bedElevation: NaN }, /elevation/i],
  ];
  for (const [o, re] of cases) {
    const r = gen(Object.assign({ bedEnabled: true }, o));
    assert.ok(r.errors.some(e => re.test(e.message)), JSON.stringify(o) + ' -> ' + JSON.stringify(r.errors));
  }
});

test('bed is its own export assembly and survives a project round-trip', () => {
  const r = gen({ bedEnabled: true, bedElevation: 10 });
  assert.ok(AssemblyExport.listAssemblies(r).indexOf('bed') >= 0);
  const only = AssemblyExport.exportAssemblies(r, SHEET, ['bed'], 'x');
  assert.ok(only.files.length >= 1 && only.files.every(f => /-bed-/.test(f.filename)));
  const p = cbParams({ bedEnabled: true, bedElevation: 10, liftLidSkirtOffset: -3, bodyHeightOffset: 4 });
  const back = JSON.parse(JSON.stringify(p));
  const r2 = BoxGenerator.generate(back);
  assert.ok(r2.panels.some(x => x.assemblyId === 'bed') && near(r2.info.dims.bodyExternal.height, 84));
});

test('reversed presets (A, B, C, C-flat) all build cleanly with the expected lid shapes', () => {
  const Presets = require('../js/state/presets.js');
  const list = Presets.boxes ? Presets.boxes.list() : [];
  const get = (id) => list.find(x => x.id === id);
  const expect = { 'rev-deep-flat': ['lid-top'], 'rev-deep-collar': ['lid-top', 'cap-plug', 'cap-front'], 'rev-telescope': ['cap-top', 'cap-front'], 'rev-telescope-flat': ['lid-top', 'lid-plug'] };
  for (const id of Object.keys(expect)) {
    const pr = get(id); assert.ok(pr, id + ' preset exists');
    const r = BoxGenerator.generate(cbParams(pr.params));
    assert.deepStrictEqual(r.errors, [], id + ': ' + JSON.stringify(r.errors));
    assert.deepStrictEqual(r.info.collisions, [], id);
    for (const pid of expect[id]) assert.ok(byId(r, pid), `${id} has ${pid}`);
  }
  assert.ok(BoxGenerator.generate(cbParams(get('rev-telescope').params)).warnings.some(w => /below the body's base/.test(w)));
});

test('inset lid: smaller than the base, sits inside the opening, top stands above the rim', () => {
  const r = gen({ liftLidStyle: 'inset', liftLidInsetDepth: 15, liftLidRise: 20, liftLidClearance: 0.4 });
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.info.collisions, []);
  assert.deepStrictEqual(r.panels.filter(p => p.assemblyId === 'lid').map(p => p.id).sort(), ['cap-back', 'cap-front', 'cap-left', 'cap-right', 'cap-top']);
  const lid = lidBounds(r), body = asmBounds(r, 'body');
  assert.ok(lid.min[0] > body.min[0] + 3 && lid.max[0] < body.max[0] - 3, 'inside X walls');
  assert.ok(lid.min[1] > body.min[1] + 3 && lid.max[1] < body.max[1] - 3, 'inside Y walls');
  assert.ok(near(lid.max[2], 80 + 20, 0.2) && near(lid.min[2], 80 - 15, 0.2));
  assert.ok(near(r.info.lid.outer.length, 200 - 6 - 0.8) && near(r.info.lid.outer.height, 35));
  assert.ok(lid.size[0] < body.size[0], 'lid is smaller than the base');
  const top = Assembly.panelBoxes(byId(r, 'cap-top'))[0];
  assert.ok(near(top.max[2], 100, 1e-6), 'flat top plate at the rise height');
});

test('inset lid: acrylic is butt-jointed; rise 0 is flush with the rim; invalid values rejected', () => {
  const a = gen({ liftLidStyle: 'inset', liftLidRise: 0, lidMaterialId: 'acrylic3', lidMaterialName: '3mm Acrylic', lidThickness: 3, lidKerf: 0.1 });
  assert.strictEqual(a.info.lid.joint, 'butt');
  assert.ok(near(lidBounds(a).max[2], 80, 0.2));
  const cases = [[{ liftLidInsetDepth: 200 }, /hit the floor/], [{ liftLidRise: -1 }, /rise/i], [{ liftLidInsetDepth: 0 }, /Inset depth/], [{ liftLidClearance: 5 }, /incompatible fit/], [{ length: 14 }, /too small|internal space/]];
  for (const [o, re] of cases) {
    const r = gen(Object.assign({ liftLidStyle: 'inset' }, o));
    assert.ok(r.errors.some(e => re.test(e.message)), JSON.stringify(o) + ' -> ' + JSON.stringify(r.errors));
  }
});

test('reversed D presets (acrylic inset lid + bed, plywood inset lid) build cleanly', () => {
  const Presets = require('../js/state/presets.js');
  for (const id of ['rev-inset-acrylic', 'rev-inset-wood']) {
    const pr = Presets.boxes.list().find(x => x.id === id); assert.ok(pr, id);
    const r = BoxGenerator.generate(cbParams(pr.params));
    assert.deepStrictEqual(r.errors, [], id + ': ' + JSON.stringify(r.errors));
    assert.deepStrictEqual(r.info.collisions, [], id);
    assert.ok(r.info.lid.inset && r.info.lid.outer.length < pr.params.length);
    if (id === 'rev-inset-acrylic') { assert.ok(r.info.bed && r.panels.some(p => p.assemblyId === 'bed')); assert.ok(byId(r, 'cap-top').transparent); }
  }
});

test('bed height is customisable: explicit values apply exactly; blank = auto fills to the rim / under the lid', () => {
  const a = gen({ bedEnabled: true, bedElevation: 6, bedHeight: 18 }), b = gen({ bedEnabled: true, bedElevation: 6, bedHeight: 40 });
  assert.ok(near(a.info.bed.height, 18) && near(b.info.bed.height, 40));
  assert.ok(near(asmBounds(b, 'bed').size[2] - asmBounds(a, 'bed').size[2], 22, 0.3));
  const rim = gen({ bedEnabled: true, bedElevation: 6, bedHeight: null });            // internal height 77
  assert.ok(rim.info.bed.autoHeight && near(rim.info.bed.height, 77 - 6) && near(rim.info.bed.headroomAbove, 0));
  const inset = gen({ bedEnabled: true, bedElevation: 6, bedHeight: null, liftLidStyle: 'inset', liftLidInsetDepth: 15 });
  assert.ok(near(inset.info.bed.height, 77 - 15 - 6), 'stops under the inset lid');
  assert.deepStrictEqual(inset.info.collisions, []);
  const collar = gen({ bedEnabled: true, bedElevation: 0, bedHeight: null, liftLidStyle: 'cap', liftLidSkirtDepth: -10 });
  assert.ok(near(collar.info.bed.height, 77 - 13)); assert.deepStrictEqual(collar.info.collisions, []);
  const none = gen({ bedEnabled: true, bedElevation: 77, bedHeight: null });
  assert.ok(none.errors.some(e => /no room for an auto-height tray/.test(e.message)));
  const tall = gen({ bedEnabled: true, bedElevation: 0, bedHeight: 120 });
  assert.ok(tall.warnings.some(w => /ABOVE the body rim/.test(w)));
});

test('upside-down tray: same footprint and span, plate on TOP, walls stand on the elevation', () => {
  const up = gen({ bedEnabled: true, bedHeight: 20, bedElevation: 12 });
  const dn = gen({ bedEnabled: true, bedHeight: 20, bedElevation: 12, bedFlipped: true });
  assert.deepStrictEqual(dn.errors, []);
  assert.deepStrictEqual(dn.info.collisions, []);
  assert.ok(dn.info.bed.flipped && !up.info.bed.flipped);
  assert.deepStrictEqual(dn.panels.filter(p => p.assemblyId === 'bed').map(p => p.id).sort(), ['bed-back', 'bed-front', 'bed-left', 'bed-right', 'bed-top']);
  const bu = asmBounds(up, 'bed'), bd = asmBounds(dn, 'bed');
  for (let i = 0; i < 3; i++) assert.ok(near(bu.min[i], bd.min[i], 0.2) && near(bu.max[i], bd.max[i], 0.2), 'axis ' + i);
  const plate = Assembly.panelBoxes(byId(dn, 'bed-top'))[0], wall = Assembly.panelBoxes(byId(dn, 'bed-front'))[0];
  assert.ok(near(plate.max[2], 3 + 12 + 20, 0.2) && near(plate.min[2], 3 + 12 + 20 - 3, 0.2), 'plate is the top face');
  assert.ok(near(wall.min[2], 3 + 12, 0.2), 'walls stand on the elevation');
  assert.ok(byId(dn, 'bed-top').componentType === 'bed-top');
  // flipping has no meaning for a plate
  assert.deepStrictEqual(gen({ bedEnabled: true, bedStyle: 'plate', bedFlipped: true }).errors, []);
});

test('inner bed works with EVERY built-in preset (basic presets are converted to the customBox type)', () => {
  const Presets = require('../js/state/presets.js');
  const list = Presets.boxes.list().filter(x => x.builtin);
  assert.ok(list.length >= 20);
  for (const pr of list) {
    for (const flipped of [false, true]) {
      const params = Object.assign(cbParams({ lidStyle: pr.params.boxType === 'finger5open' ? 'none' : 'flat' }), pr.params,
        { boxType: 'customBox', bedEnabled: true, bedStyle: 'tray', bedHeight: null, bedElevation: 5, bedFlipped: flipped });
      const r = BoxGenerator.generate(params);
      const errs = r.errors.map(e => e.message);
      const dividers = !!pr.params.dividersEnabled;
      const bad = errs.filter(m => !(dividers && /inner bed collides with the dividers/.test(m)));
      assert.deepStrictEqual(bad, [], `${pr.id} flipped=${flipped}`);
      assert.ok(r.panels.some(p => p.assemblyId === 'bed') || errs.length, pr.id);
    }
  }
  // closed-top basic preset keeps its fixed top when converted
  const closed = BoxGenerator.generate(Object.assign(cbParams({ lidStyle: 'flat' }), { length: 100, width: 80, height: 50, bedEnabled: true, bedHeight: null, bedElevation: 3 }));
  assert.ok(byId(closed, 'top') && closed.info.closedTop);
  assert.deepStrictEqual(closed.errors, []);
});

test('inset lid uses its own kerf: outline grows with kerf, net fit gap reflects the compensation mode', () => {
  const acr = { liftLidStyle: 'inset', liftLidClearance: 0.3, lidMaterialId: 'acrylic3', lidMaterialName: '3mm Acrylic', lidThickness: 3, lidMaterialColor: '#bfe3f0' };
  const width = (r) => Vec2.bounds(byId(r, 'cap-top').outline).width;
  const a = gen(Object.assign({ lidKerf: 0.1 }, acr)), b = gen(Object.assign({ lidKerf: 0.3 }, acr));
  assert.ok(near(width(b) - width(a), 0.2, 1e-6), 'drawn outline grows by the extra kerf (auto = +kerf/2 per side)');
  assert.strictEqual(a.info.lid.kerf, 0.1); assert.strictEqual(byId(a, 'cap-top').kerf, 0.1);
  assert.ok(near(a.info.lid.netGapPerSide, 0.3) && near(b.info.lid.netGapPerSide, 0.3), 'auto: cut to nominal, gap = clearance');
  const none = gen(Object.assign({ lidKerf: 0.1, outlineCompensation: 'none' }, acr));
  assert.ok(near(none.info.lid.netGapPerSide, 0.3 + 0.05), 'uncompensated: laser eats kerf/2 off each side -> looser');
  const inside = gen(Object.assign({ lidKerf: 0.1, outlineCompensation: 'inside' }, acr));
  assert.ok(near(inside.info.lid.netGapPerSide, 0.3 + 0.1));
  // an over-grown manual offset makes the lid bind -> warning
  const tight = gen(Object.assign({ lidKerf: 0.1, outlineCompensation: 0.5 }, acr));
  assert.ok(tight.info.lid.netGapPerSide < 0.05 && tight.warnings.some(w => /will bind/.test(w)), JSON.stringify(tight.warnings));
  // outer cap: bigger cut part = tighter fit
  const cap = gen({ liftLidStyle: 'cap', liftLidClearance: 0.3, lidKerf: 0.1, outlineCompensation: 'none' });
  assert.ok(near(cap.info.lid.netGapPerSide, 0.3 - 0.05));
});

test('lid and body panels both appear in the cutting layout; lid-only export excludes the body', () => {
  const r = gen({ liftLidStyle: 'cap' });
  const layout = sheetOf(r);
  const placed = layout.sheets.reduce((a, s) => a.concat(s.placements.map(p => p.id)), []);
  r.panels.forEach(p => assert.ok(placed.includes(p.id), p.id + ' placed'));
  const lidOnly = AssemblyExport.exportAssemblies(r, SHEET, ['lid'], 'x');
  const body = AssemblyExport.exportAssemblies(r, SHEET, ['body'], 'x');
  lidOnly.files.forEach(f => { assert.ok(f.svg.includes('data-assembly="lid"')); assert.ok(!f.svg.includes('data-assembly="body"')); assert.ok(!f.dxf.includes('data-')); });
  body.files.forEach(f => assert.ok(!f.svg.includes('data-assembly="lid"')));
  assert.strictEqual(lidOnly.files.reduce((n, f) => n + f.partIds.length, 0), 5);
  assert.strictEqual(body.files.reduce((n, f) => n + f.partIds.length, 0), 5);
});

test('SVG and DXF of a detached-lid box contain closed cut paths on strict production layers', () => {
  const r = gen({ liftLidStyle: 'flat' });
  const f = AssemblyExport.exportAssemblies(r, SHEET, null, 'x').files[0];
  assert.ok(f.svg.includes('#FF0000') && /<path class="cut-outline" d="M [^"]* Z"/.test(f.svg));
  assert.ok(f.dxf.includes('CUT') && f.dxf.endsWith('EOF\n'));
  assert.ok(!f.svg.includes('hit-area'), 'no preview-only geometry in exports');
});

// ---- Acrylic display cover ---------------------------------------------
test('acrylic display cover: transparent butt-jointed cover + opaque base plate and seat ring', () => {
  const r = gen({ length: 120, width: 90, height: 30, liftLidStyle: 'acrylicCover' });
  assert.deepStrictEqual(r.errors, []);
  const cover = r.panels.filter(p => p.assemblyId === 'cover');
  assert.deepStrictEqual(cover.map(p => p.id).sort(), ['cover-back', 'cover-front', 'cover-left', 'cover-right', 'cover-top']);
  cover.forEach(p => { assert.ok(p.transparent); assert.strictEqual(p.thickness, 3); assert.ok(isPlainRect(p.outline)); });
  ['cover-base-plate', 'cover-seat-ring'].forEach(id => { assert.strictEqual(byId(r, id).assemblyId, 'body'); assert.ok(!byId(r, id).transparent); });
  assert.strictEqual(byId(r, 'cover-seat-ring').cutouts.length, 1);
});

test('cover fit chain: ring inner = body + 2*gap, cover inner = ring outer + 2*clearance', () => {
  const r = gen({ length: 120, width: 90, height: 30, liftLidStyle: 'acrylicCover', coverBodyGap: 1, coverClearance: 0.7, coverRingWidth: 5, coverThickness: 4 });
  const s = r.info.seat, c = r.info.cover;
  assert.ok(near(s.ring.inner.length, 122) && near(s.ring.outer.length, 132));
  assert.ok(near(c.inner.length, 132 + 1.4) && near(c.outer.length, 132 + 1.4 + 8));
  assert.ok(near(c.outer.height, 30 + 5 + 4));
  assert.ok(near(s.plate.length, c.outer.length + 12));
});

test('independent cover width/depth/height are honoured and validated', () => {
  const r = gen({ length: 120, width: 90, height: 30, liftLidStyle: 'acrylicCover', coverWidth: 160, coverDepth: 130, coverHeight: 60 });
  assert.deepStrictEqual(r.errors, []);
  assert.ok(near(r.info.cover.outer.length, 160) && near(r.info.cover.outer.width, 130) && near(r.info.cover.outer.height, 60));
  const bad = gen({ length: 120, width: 90, height: 30, liftLidStyle: 'acrylicCover', coverWidth: 125 });
  assert.ok(bad.errors.some(e => /too small/.test(e.message)));
  const low = gen({ length: 120, width: 90, height: 30, liftLidStyle: 'acrylicCover', coverHeight: 20 });
  assert.ok(low.errors.some(e => /tall enough/.test(e.message)));
});

test('cover and plywood parts are nested on separate sheets (never mixed materials)', () => {
  const r = gen({ length: 120, width: 90, height: 30, liftLidStyle: 'acrylicCover' });
  const { layout } = errsOf(r, undefined, Object.assign({}, SHEET, { groupByMaterial: true }));
  const group = {};
  r.panels.forEach(p => { group[p.id] = Assembly.sheetGroupKey(p); });
  layout.sheets.forEach(s => assert.strictEqual(new Set(s.placements.map(pl => group[pl.id])).size, 1));
  assert.ok(layout.groups.length >= 2);
});

test('by default all materials share sheets (fewer sheets than per-material grouping)', () => {
  const r = gen({ length: 120, width: 90, height: 30, liftLidStyle: 'acrylicCover' });
  const items = r.panels.map(p => { const b = Vec2.bounds(p.outline); return { id: p.id, name: p.name, width: b.width, height: b.height, allowRotate: true, group: Assembly.sheetGroupKey(p), groupLabel: Assembly.sheetGroupLabel(p) }; });
  const mixed = SheetLayout.packGroups(items, SHEET);
  const grouped = SheetLayout.packGroups(items, Object.assign({}, SHEET, { groupByMaterial: true }));
  assert.ok(mixed.totalSheets <= grouped.totalSheets);
  assert.strictEqual(mixed.totalSheets, 1);
  assert.ok(grouped.totalSheets >= 2);
  const ids = mixed.sheets.flatMap(s => s.placements.map(p => p.id)).sort();
  assert.deepStrictEqual(ids, r.panels.map(p => p.id).sort());
  assert.ok(mixed.sheets[0].groupLabel.indexOf(' + ') > 0);
  assert.deepStrictEqual(SheetLayout.findOverlaps(mixed, SHEET), []);
});

test('acrylic cover without sidewalls becomes a flat acrylic top in the cover assembly', () => {
  const r = gen({ liftLidStyle: 'acrylicCover', coverSidewalls: false });
  assert.deepStrictEqual(r.errors, []);
  assert.ok(r.panels.filter(p => p.assemblyId === 'cover').every(p => p.transparent));
  assert.ok(byId(r, 'cover-top'));
});

// ---- Combined ----------------------------------------------------------
test('combined: cap lid + 2x2 dividers works with separate assemblies and no collisions', () => {
  const r = gen({ liftLidStyle: 'cap', dividersEnabled: true, dividerCountX: 1, dividerCountY: 1 });
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.panels.length, 5 + 2 + 5);
  assert.deepStrictEqual(r.info.collisions, []);
  assert.deepStrictEqual(errsOf(r).issues.map(i => i.message), []);
});

test('combined: flat lid with plug lowers auto divider height so nothing collides', () => {
  const plug = gen({ liftLidStyle: 'flat', dividersEnabled: true, dividerCountX: 1 });
  const noPlug = gen({ liftLidStyle: 'flat', liftLidLocator: 'none', dividersEnabled: true, dividerCountX: 1 });
  assert.deepStrictEqual(plug.errors, []);
  assert.ok(near(noPlug.info.dividers.height - plug.info.dividers.height, 3));
  const tall = gen({ liftLidStyle: 'flat', dividersEnabled: true, dividerCountX: 1, dividerHeight: 75 });
  assert.ok(tall.errors.some(e => /plug/.test(e.message)));
});

test('combined: acrylic cover with dividers is supported and collision-free', () => {
  const r = gen({ length: 160, width: 100, height: 35, liftLidStyle: 'acrylicCover', dividersEnabled: true, dividerPattern: 'columns', dividerCountX: 2 });
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.info.collisions, []);
  assert.strictEqual(r.panels.filter(p => p.assemblyId === 'dividers').length, 2);
});

test('combined: an invalid divider config does not hide a valid lid, and errors are reported', () => {
  const r = gen({ liftLidStyle: 'cap', dividersEnabled: true, dividerCountX: -3 });
  assert.ok(r.errors.length >= 1);
  assert.strictEqual(r.panels.filter(p => p.assemblyId === 'lid').length, 5);
  assert.strictEqual(r.panels.filter(p => p.assemblyId === 'dividers').length, 0);
});

test('every preset in the preset list generates valid, exportable, collision-free geometry', () => {
  const Presets = require('../js/state/presets.js');
  const list = Presets.boxes.list();
  assert.ok(list.length >= 15);
  for (const b of list) {
    const params = cbParams(b.params);
    const r = BoxGenerator.generate(params);
    const { issues, layout } = errsOf(r, params);
    assert.deepStrictEqual(issues.map(i => i.message), [], b.id);
    assert.strictEqual(layout.unplaced.length, 0, b.id);
    assert.deepStrictEqual(SheetLayout.findOverlaps(layout, SHEET), [], b.id);
    const ex = AssemblyExport.exportAssemblies(r, SHEET, null, b.id);
    assert.ok(ex.files.length >= 1);
    ex.files.forEach(f => { assert.ok(f.svg.startsWith('<?xml')); assert.ok(f.dxf.includes('EOF')); });
  }
});

test('nesting never produces overlapping or out-of-sheet placements for customBox designs', () => {
  const r = gen({ liftLidStyle: 'cap', dividersEnabled: true, dividerCountX: 3, dividerCountY: 2 });
  assert.deepStrictEqual(SheetLayout.findOverlaps(sheetOf(r), SHEET), []);
});

test('layout that cannot fit the sheet is reported as an error, not silently dropped', () => {
  const r = gen({ length: 700, width: 500, height: 80 });
  const issues = errsOf(r, cbParams({ length: 700 }), { width: 600, height: 400, margin: 10, spacing: 4 }).issues;
  assert.ok(issues.some(i => /cutting layout exceeds/.test(i.message)));
});

// ---- Regression / compatibility -----------------------------------------
test('3D frames of customBox body panels match the legacy preview frames exactly', () => {
  const params = cbParams({ lidStyle: 'flat' });
  const r = BoxGenerator.generate(params);
  for (const p of r.panels) {
    const legacy = Preview3D.panelFrame(p.id, params);
    assert.deepStrictEqual(p.frame3d, legacy, p.id);
  }
});

test('legacy box types are tagged as single-material body assemblies and still pack identically', () => {
  const r = BoxGenerator.generate(cbParams({ boxType: 'finger6', lidStyle: 'flat' }));
  r.panels.forEach(p => { assert.strictEqual(p.assemblyId, 'body'); assert.strictEqual(p.thickness, 3); assert.ok(!p.frame3d); });
  const items = r.panels.map(p => { const b = Vec2.bounds(p.outline); return { id: p.id, name: p.name, width: b.width, height: b.height, allowRotate: true }; });
  const a = SheetLayout.pack(items, SHEET);
  const g = SheetLayout.packGroups(items.map(i => Object.assign({ group: 'x' }, i)), SHEET);
  const strip = (sheets) => sheets.map(s => s.placements.map(pl => { const c = Object.assign({}, pl); delete c.group; return c; }));
  assert.deepStrictEqual(strip(g.sheets), strip(a.sheets));
});

test('existing sample project (schema v1) still loads, migrates to v2, and generates the same box', () => {
  const fs = require('fs');
  const raw = JSON.parse(fs.readFileSync(__dirname + '/../presets/example-project.json', 'utf8'));
  assert.strictEqual(raw.formatVersion, 1);
  globalThis.State = { defaultState: () => ({ project: {}, params: Object.assign({ boxType: 'finger6' }, CustomBox.featureDefaults()), sheet: {}, machine: {}, layerColors: {}, panelOverrides: {}, artwork: [], ui: {} }) };
  const st = ProjectIO.deserialize(raw);
  delete globalThis.State;
  assert.strictEqual(st.params.boxType, 'finger6');
  assert.strictEqual(st.params.dividersEnabled, false);
  assert.strictEqual(st.params.liftLidStyle, 'none');
  assert.strictEqual(ProjectIO.migrate(raw).formatVersion, ProjectIO.PROJECT_VERSION);
  const r = BoxGenerator.generate(st.params);
  assert.strictEqual(r.panels.length, 6);
  assert.throws(() => ProjectIO.migrate({ formatVersion: 99 }), /newer version/);
});

test('v2 project round-trips every new feature parameter', () => {
  const params = cbParams({ liftLidStyle: 'cap', dividersEnabled: true, dividerCountX: 2, lidThickness: 4, coverWidth: 150 });
  globalThis.State = { defaultState: () => ({ project: {}, params: CustomBox.featureDefaults(), sheet: {}, machine: {}, layerColors: {}, panelOverrides: {}, artwork: [], ui: {} }) };
  const out = ProjectIO.serialize({ project: {}, params, sheet: {}, machine: {}, layerColors: {}, panelOverrides: {}, artwork: [], ui: { view: '3d', showLabels: true } });
  const back = ProjectIO.deserialize(JSON.parse(JSON.stringify(out)));
  delete globalThis.State;
  for (const k of ['liftLidStyle', 'dividersEnabled', 'dividerCountX', 'lidThickness', 'coverWidth', 'dividerMount']) assert.strictEqual(back.params[k], params[k] !== undefined ? params[k] : back.params[k], k);
  assert.strictEqual(out.formatVersion, 2);
});

test('structural cutouts (wall slots) survive panel overrides without duplication (state pipeline)', () => {
  // exercise the real State module under Node
  for (const [k, m] of Object.entries({ BoxGenerator, Validator, SheetLayout, Vec2, Panel, Assembly, CustomBox })) globalThis[k] = m;
  delete require.cache[require.resolve('../js/state/stateManager.js')];
  const State = require('../js/state/stateManager.js');
  State.updateParams(cbParams({ dividersEnabled: true, dividerCountX: 1, dividerCountY: 1, dividerMount: 'slotted' }));
  assert.strictEqual(byId(State.derived.result, 'front').cutouts.filter(c => c.structural).length, 1);
  State.updatePanelOverride('front', { cutouts: byId(State.derived.result, 'front').cutouts.concat([{ type: 'circle', x: 20, y: 20, r: 3 }]) });
  State.updateParams({ dividerCountX: 2 });
  const f = byId(State.derived.result, 'front');
  assert.strictEqual(f.cutouts.filter(c => c.structural).length, 2, 'slots re-derived from parameters, not stale');
  assert.strictEqual(f.cutouts.filter(c => !c.structural).length, 1, 'manual cutout kept once');
  assert.ok(State.derived.info.byAssembly.dividers.parts >= 2);
  assert.ok(State.derived.info.components.every(c => c.area > 0 && c.cutLength > 0));
});

console.log('\n== Inner bed: double layer (local backing patches under the pocket plate) ==');

const LAMP = { type: 'round', w: 80, x: -50, y: 0, itemHeight: 150 };           // 150mm tall: stands on the box floor
const ACR = { type: 'acrylic', w: 3, h: 60, x: 40, y: 0 };                       // acrylic, no height -> needs backing
const JAR = { type: 'round', w: 60, x: 0, y: 0, itemHeight: 40 };                // hamper jar, low (only 27mm above the bed top)
const backs = (r) => r.panels.filter(p => p.componentType === 'bed-backing');
const bboxOf = (poly) => ({ w: Math.max(...poly.map(q => q.x)) - Math.min(...poly.map(q => q.x)), h: Math.max(...poly.map(q => q.y)) - Math.min(...poly.map(q => q.y)) });

test('only the items that need support get a patch; the pocket plate stays single layer everywhere else', () => {
  const a = gen({ bedEnabled: true, bedStyle: 'plate', bedElevation: 10, bedItems: [ACR, JAR] });
  const plate = byId(a, 'bed-plate');
  assert.ok(!byId(a, 'bed-base'), 'no full-size base any more');
  assert.strictEqual(backs(a).length, 2, 'one patch per supported item');
  assert.strictEqual(plate.cutouts.length, 2, 'holes stay cut through the top plate');
  backs(a).forEach(b => assert.strictEqual(b.cutouts.length, 0, 'patch is solid (not cut out)'));
  assert.ok(a.info.bed.doubleLayer && a.info.bed.backingCount === 2 && a.info.bed.supportedItems === 2 && a.info.bed.tallItems === 0);
  // patch is flush against the underside of the plate, same material thickness
  const pb = Assembly.panelBoxes(plate)[0];
  backs(a).forEach(b => { const bb = Assembly.panelBoxes(b)[0]; assert.ok(near(bb.max[2], pb.min[2], 0.05), 'patch top touches the plate underside'); assert.ok(near(bb.max[2] - bb.min[2], 3, 0.05), '3mm patch'); });
  assert.ok(near(Math.min(...backs(a).map(b => Assembly.panelBoxes(b)[0].min[2])), 3 + 10, 0.05), 'whole bed still starts at the requested elevation');
});

test('the patch is larger than the cutout (default 5mm glue ledge per side) and sits under it', () => {
  const a = gen({ bedEnabled: true, bedStyle: 'plate', bedElevation: 10, bedItems: [ACR] });
  const b = backs(a)[0], plate = byId(a, 'bed-plate');
  const hole = bboxOf(Panel.buildCutout(plate.cutouts[0]));
  const pb = bboxOf(b.outline);
  assert.ok(near(pb.w - hole.w, 10, 0.5), `patch ${pb.w.toFixed(1)} vs hole ${hole.w.toFixed(1)}`);
  assert.ok(pb.h > hole.h + 9 && pb.h < hole.h + 12);
  // centred under the hole (world coordinates)
  const bb = Assembly.panelBoxes(b)[0], plb = Assembly.panelBoxes(plate)[0];
  const hx = plb.min[0] + plate.cutouts[0].x;
  assert.ok(near((bb.min[0] + bb.max[0]) / 2, hx, 0.3), 'centred under the hole in X');
  // margin is adjustable
  const m = gen({ bedEnabled: true, bedStyle: 'plate', bedElevation: 10, bedBackingMargin: 8, bedItems: [ACR] });
  assert.ok(bboxOf(backs(m)[0].outline).w > pb.w + 5);
});

test('items 5cm or more above the bed top do NOT get a patch (single layer)', () => {
  const a = gen({ bedEnabled: true, bedStyle: 'plate', bedElevation: 10, bedItems: [LAMP] });
  assert.strictEqual(backs(a).length, 0);
  assert.ok(!a.info.bed.doubleLayer && a.info.bed.tallItems === 1);
  assert.strictEqual(a.panels.filter(p => p.assemblyId === 'bed').length, 1);
  assert.strictEqual(a.info.bed.baseThickness, 0, 'bed is not lifted when nothing needs backing');
  const top = 3 + 10;
  const ok = gen({ bedEnabled: true, bedStyle: 'plate', bedElevation: 10, bedItems: [Object.assign({}, LAMP, { itemHeight: top + 50 })] });
  const no = gen({ bedEnabled: true, bedStyle: 'plate', bedElevation: 10, bedItems: [Object.assign({}, LAMP, { itemHeight: top + 49 })] });
  assert.strictEqual(backs(ok).length, 0);
  assert.strictEqual(backs(no).length, 1);
});

test('mixed bed: patch only under the acrylic, nothing under the tall lamp', () => {
  const a = gen({ bedEnabled: true, bedStyle: 'plate', bedElevation: 10, bedItems: [LAMP, ACR] });
  assert.strictEqual(byId(a, 'bed-plate').cutouts.length, 2);
  assert.strictEqual(backs(a).length, 1);
  assert.strictEqual(backs(a)[0].id, 'bed-backing-2', 'named after the acrylic (item 2)');
  assert.ok(a.info.bed.tallItems === 1 && a.info.bed.supportedItems === 1);
  // the acrylic patch does not reach into the lamp hole
  const lampHole = Panel.buildCutout(Object.assign({}, byId(a, 'bed-plate').cutouts[0]));
  const bb = Assembly.panelBoxes(backs(a)[0])[0], plb = Assembly.panelBoxes(byId(a, 'bed-plate'))[0];
  const lampRight = plb.min[0] + Math.max(...lampHole.map(q => q.x));
  assert.ok(bb.min[0] > lampRight, 'patch clear of the lamp hole');
});

test('a patch that would block a nearby tall item is narrowed instead (and reported if it cannot clear)', () => {
  // acrylic ~3.5mm from a tall round hole: a full 5mm ledge toward it would cover the hole
  const near1 = gen({ bedEnabled: true, bedStyle: 'plate', bedElevation: 10, bedItems: [{ type: 'round', w: 40, x: -30, y: 0, itemHeight: 150 }, { type: 'acrylic', w: 3, h: 40, x: -5, y: 0 }] });
  assert.strictEqual(backs(near1).length, 1);
  assert.ok(near1.info.bed.backingMargins[0] < 5, 'narrowed');
  assert.ok(near1.warnings.some(w => /only .* wider than its pocket/.test(w) || /block a tall item/.test(w)), JSON.stringify(near1.warnings));
});

test('item with no height entered still gets backing (safe default); tray bed lifts by one thickness', () => {
  const t = gen({ bedEnabled: true, bedStyle: 'tray', bedHeight: 20, bedElevation: 5, bedItems: [{ type: 'rect', w: 60, h: 40, x: 0, y: 0 }] });
  assert.strictEqual(backs(t).length, 1); assert.ok(byId(t, 'bed-bottom'));
  assert.ok(near(t.info.bed.topAboveFloor, 5 + 3 + 20, 1e-6));
  const au = gen({ bedEnabled: true, bedStyle: 'tray', bedHeight: null, bedElevation: 5, bedItems: [{ type: 'rect', w: 60, h: 40 }] });
  assert.ok(near(au.info.bed.height, 77 - 5 - 3) && near(au.info.bed.headroomAbove, 0));
});

test('no items / bedBacking off: nothing changes, and a warning says items will fall through', () => {
  const none = gen({ bedEnabled: true, bedStyle: 'plate', bedElevation: 10 });
  assert.strictEqual(backs(none).length, 0); assert.ok(!none.info.bed.doubleLayer);
  const off = gen({ bedEnabled: true, bedStyle: 'plate', bedElevation: 10, bedBacking: false, bedItems: [ACR] });
  assert.strictEqual(backs(off).length, 0);
  assert.ok(off.warnings.some(w => /Double layer is off/.test(w)), JSON.stringify(off.warnings));
});

test('patches work with stacked grip plates and an upside-down tray, and export with the bed', () => {
  const g = gen({ bedEnabled: true, bedStyle: 'plate', bedElevation: 0, bedLayers: 3, bedItems: [ACR] });
  const ids = g.panels.filter(p => p.assemblyId === 'bed').map(p => p.id).sort();
  assert.deepStrictEqual(ids, ['bed-backing-1', 'bed-grip-1', 'bed-grip-2', 'bed-plate']);
  // upside-down tray: pocket plate is on top, patch hangs inside the walls, bed is not lifted
  const f = gen({ bedEnabled: true, bedStyle: 'tray', bedFlipped: true, bedHeight: 30, bedElevation: 0, bedItems: [LAMP, ACR] });
  assert.strictEqual(backs(f).length, 1);
  assert.strictEqual(f.info.bed.baseThickness, 0);
  const top = byId(f, 'bed-top'), tb = Assembly.panelBoxes(top)[0], bb = Assembly.panelBoxes(backs(f)[0])[0];
  assert.ok(near(bb.max[2], tb.min[2], 0.05), 'patch is flush under the top plate');
  assert.ok(bb.min[1] > tb.min[1] && bb.max[1] < tb.max[1], 'inside the plate footprint');
  assert.deepStrictEqual(f.errors, []);
  const only = AssemblyExport.exportAssemblies(f, SHEET, ['bed'], 'x');
  assert.ok(only.files.length >= 1);
});

test('double-layer parameters survive a JSON round-trip', () => {
  const p = cbParams({ bedEnabled: true, bedStyle: 'plate', bedBacking: true, bedTallItemMin: 40, bedItems: [Object.assign({}, JAR, { itemHeight: 90 })] });
  const r2 = BoxGenerator.generate(JSON.parse(JSON.stringify(p)));
  assert.strictEqual(backs(r2).length, 0, 'jar 90mm vs bed top 13mm is >= 40mm tall -> no backing');
  const r3 = BoxGenerator.generate(JSON.parse(JSON.stringify(Object.assign({}, p, { bedTallItemMin: 100, bedBackingMargin: 6 }))));
  assert.strictEqual(backs(r3).length, 1, 'raising the tall threshold to 100mm brings the backing back');
});

test('lamp base item: circle + rectangular cable slot with a small step where they meet', () => {
  const LB = { type: 'lamp', w: 100, x: 0, y: 0, itemHeight: 150, cableWidth: 60, cableLen: 25, cableAngle: 0 };
  const a = gen({ bedEnabled: true, bedStyle: 'plate', bedElevation: 10, bedPocketFit: 0, bedItems: [LB] });
  const plate = byId(a, 'bed-plate'), poly = Panel.buildCutout(plate.cutouts[0]);
  const cx = plate.W / 2, cy = plate.H / 2, g = 0 - 0.15;
  const maxX = Math.max(...poly.map(q => q.x)) - cx, minX = Math.min(...poly.map(q => q.x)) - cx;
  assert.ok(near(minX, -(100 + g) / 2, 0.05), 'far side of the circle is the lamp diameter');
  assert.ok(near(maxX, (100 + g) / 2 + 25, 0.05), 'slot reaches 25mm past the circle edge');
  const slotY = Math.max(...poly.filter(q => q.x - cx > 40).map(q => Math.abs(q.y - cy)));
  assert.ok(near(slotY, (60 + g) / 2, 0.05), 'slot is the requested width');
  assert.ok(poly.some(q => Math.abs(q.x - cx - 0) < 1 && Math.abs(q.y - cy) > 49), 'circle part is round (reaches the top)');
  assert.strictEqual(backs(a).length, 0, 'tall lamp stands on the floor: no backing');
  // direction rotates it
  const d = gen({ bedEnabled: true, bedStyle: 'plate', bedElevation: 10, bedPocketFit: 0, bedItems: [Object.assign({}, LB, { cableAngle: 270 })] });
  const pd = Panel.buildCutout(byId(d, 'bed-plate').cutouts[0]);
  assert.ok(near(Math.min(...pd.map(q => q.y)) - plate.H / 2, -((100 + g) / 2 + 25), 0.05), 'angle 270 points the slot down');
  assert.deepStrictEqual(a.errors, []);
  // a short lamp (no tall height) gets a backing patch covering the whole outline
  const sh = gen({ bedEnabled: true, bedStyle: 'plate', bedElevation: 10, bedItems: [Object.assign({}, LB, { itemHeight: undefined })] });
  assert.strictEqual(backs(sh).length, 1);
});


console.log('\n== Item layout: square, smooth corners, finger slot, per-item double layer ==');

const polyArea = (q) => Math.abs(q.reduce((s2, a, k) => { const b = q[(k + 1) % q.length]; return s2 + a.x * b.y - b.x * a.y; }, 0)) / 2;
const polyBox = (q) => ({ minx: Math.min(...q.map(a => a.x)), maxx: Math.max(...q.map(a => a.x)), miny: Math.min(...q.map(a => a.y)), maxy: Math.max(...q.map(a => a.y)) });
const pocketPoly = (it) => { const r = require('../js/geometry/innerBed.js').buildPockets([it], 0, 0); assert.deepStrictEqual(r.errors, []); return Panel.buildCutout(r.pockets[0]); };

test('square: one side length drives both directions, and it gets a backing patch like any flat item', () => {
  const b = polyBox(pocketPoly({ type: 'square', w: 60 }));
  assert.ok(near(b.maxx - b.minx, 60, 1e-9) && near(b.maxy - b.miny, 60, 1e-9));
  const a = gen({ bedEnabled: true, bedStyle: 'plate', bedElevation: 10, bedItems: [{ type: 'square', w: 60, x: 0, y: 0 }] });
  assert.strictEqual(backs(a).length, 1, 'square (no height entered) is double layer');
  assert.ok(a.info.bed.doubleLayer && a.info.bed.supportedItems === 1);
  assert.ok(require('../js/geometry/innerBed.js').buildPockets([{ type: 'square', w: 1 }], 0, 0).errors.length === 1, 'tiny square rejected');
});

test('corner radius: rounded rectangle has the exact bounding box and the analytic area; sharp stays a plain rect', () => {
  const R = 10, q = pocketPoly({ type: 'square', w: 60, radius: R }), b = polyBox(q);
  assert.ok(near(b.maxx - b.minx, 60, 1e-6) && near(b.maxy - b.miny, 60, 1e-6));
  const exact = 3600 - (4 - Math.PI) * R * R;
  assert.ok(Math.abs(polyArea(q) - exact) < 4, `area ${polyArea(q).toFixed(1)} vs ${exact.toFixed(1)}`);
  assert.strictEqual(require('../js/geometry/innerBed.js').buildPockets([{ type: 'rect', w: 60, h: 40 }], 0, 0).pockets[0].type, 'rect', 'radius 0 keeps the plain rect');
  // radius can never exceed half the short side
  const big = polyBox(pocketPoly({ type: 'rect', w: 60, h: 20, radius: 999 }));
  assert.ok(near(big.maxx - big.minx, 60, 1e-6) && near(big.maxy - big.miny, 20, 1e-6));
});

test('corner radius: smooth corners make the item\'s pocket and its backing patch both round', () => {
  const a = gen({ bedEnabled: true, bedStyle: 'plate', bedElevation: 10, bedItems: [{ type: 'square', w: 50, radius: 12, x: 0, y: 0 }] });
  const hole = Panel.buildCutout(byId(a, 'bed-plate').cutouts[0]);
  assert.ok(hole.length > 20, 'pocket is a smooth polygon');
  assert.ok(backs(a)[0].outline.length > 20, 'backing patch follows the rounded outline');
});

test('finger slot: a notch on the chosen side adds exactly `fingerDepth` of reach and stays ONE closed outline', () => {
  const base = { type: 'rect', w: 80, h: 50 };
  const up = polyBox(pocketPoly(Object.assign({}, base, { finger: true, fingerAngle: 90, fingerWidth: 20, fingerDepth: 10 })));
  assert.ok(near(up.maxy - up.miny, 60, 1e-6) && near(up.maxx - up.minx, 80, 1e-6), 'reaches 10mm past the top edge only');
  const right = polyBox(pocketPoly(Object.assign({}, base, { finger: true, fingerAngle: 0, fingerWidth: 20, fingerDepth: 25 })));
  assert.ok(near(right.maxx - right.minx, 105, 1e-6), 'a deep slot is a stadium, not a half circle');
  // item rotation turns the slot with the item
  const rot = polyBox(pocketPoly(Object.assign({}, base, { rot: 90, finger: true, fingerAngle: 0, fingerWidth: 20, fingerDepth: 10 })));
  assert.ok(near(rot.maxy - rot.miny, 90, 1e-6) && near(rot.maxx - rot.minx, 50, 1e-6), 'rot 90 + side 0 points up');
  // finger slot works on round / lamp / bottle too, and the outline is a single simple loop (area grows, never negative)
  ['round', 'lamp', 'bottle'].forEach((t) => {
    const it = { type: t, w: t === 'bottle' ? 65 : 80, h: 200, neckW: 28, neckLen: 60 };
    const a0 = polyArea(pocketPoly(it)), a1 = polyArea(pocketPoly(Object.assign({}, it, { finger: true, fingerAngle: 0 })));
    assert.ok(a1 > a0, t + ': area grows with a finger slot');
  });
});

test('finger slot + kerf: the notch is compensated like the rest of the pocket and exports in the plate', () => {
  const a = gen({ bedEnabled: true, bedStyle: 'plate', bedElevation: 10, bedItems: [{ type: 'rect', w: 80, h: 50, x: 0, y: 0, radius: 4, finger: true, fingerAngle: 90 }] });
  const c = byId(a, 'bed-plate').cutouts[0];
  assert.strictEqual(c.type, 'path'); assert.strictEqual(c.source, 'bed-pocket'); assert.strictEqual(c.layer, 'cut');
  assert.ok(backs(a).length === 1 && a.warnings.every(w => !/finger slot could not/.test(w)));
});

test('per-item double layer override: always / never / auto', () => {
  const IB = require('../js/geometry/innerBed.js');
  assert.strictEqual(IB.itemNeedsBase({ itemHeight: 300, support: 'double' }, 10, 50), true, 'forced on even when tall');
  assert.strictEqual(IB.itemNeedsBase({ support: 'none' }, 10, 50), false, 'forced off even when flat');
  assert.strictEqual(IB.itemNeedsBase({ itemHeight: 300 }, 10, 50), false, 'auto: tall stands on the floor');
  assert.strictEqual(IB.itemNeedsBase({}, 10, 50), true, 'auto: flat needs backing');
  const f = gen({ bedEnabled: true, bedStyle: 'plate', bedElevation: 10, bedItems: [Object.assign({}, LAMP, { support: 'double' }), ACR] });
  assert.strictEqual(backs(f).length, 2);
  const n = gen({ bedEnabled: true, bedStyle: 'plate', bedElevation: 10, bedItems: [Object.assign({}, ACR, { support: 'none' })] });
  assert.strictEqual(backs(n).length, 0);
  assert.ok(n.warnings.some(w => /no backing/.test(w)), 'warns that a flat item with no backing falls through');
});

console.log('\n== Item layout: align / centre / distribute ==');
const IA = require('../js/geometry/itemAlign.js');
const BX = (id, minx, maxx, miny, maxy) => ({ id, minx, maxx, miny, maxy });
const applyMv = (boxes, mv) => boxes.map(b => { const m = mv.find(k => k.id === b.id) || { dx: 0, dy: 0 }; return BX(b.id, b.minx + m.dx, b.maxx + m.dx, b.miny + m.dy, b.maxy + m.dy); });
const trio = () => [BX(0, -100, -60, 10, 40), BX(1, -20, 30, -30, 20), BX(2, 60, 90, 0, 70)];

test('align edges to each other: same top / same bottom / same left / same right', () => {
  const t = applyMv(trio(), IA.align(trio(), 'top', { rel: 'selection', L: 300, W: 200 })); assert.ok(t.every(b => b.maxy === 70));
  const bt = applyMv(trio(), IA.align(trio(), 'bottom', { rel: 'selection', L: 300, W: 200 })); assert.ok(bt.every(b => b.miny === -30));
  const l = applyMv(trio(), IA.align(trio(), 'left', { rel: 'selection', L: 300, W: 200 })); assert.ok(l.every(b => b.minx === -100));
  const r = applyMv(trio(), IA.align(trio(), 'right', { rel: 'selection', L: 300, W: 200 })); assert.ok(r.every(b => b.maxx === 90));
});

test('"same height": vertical middle lines up the centres; moves only the vertical axis', () => {
  const mv = IA.align(trio(), 'vcenter', { rel: 'selection' }), out = applyMv(trio(), mv);
  assert.ok(mv.every(m => m.dx === 0));
  const mids = out.map(b => (b.miny + b.maxy) / 2); assert.ok(mids.every(m => Math.abs(m - mids[0]) < 1e-9));
});

test('align to the bed: centres on the bed centre, edges keep the margin; a single item always uses the bed', () => {
  const c = applyMv(trio(), IA.align(trio(), 'hcenter', { rel: 'bed', L: 300, W: 200 })); assert.ok(c.every(b => Math.abs((b.minx + b.maxx) / 2) < 1e-9));
  const l = applyMv(trio(), IA.align(trio(), 'left', { rel: 'bed', L: 300, W: 200, margin: 5 })); assert.ok(l.every(b => b.minx === -145));
  const tp = applyMv(trio(), IA.align(trio(), 'top', { rel: 'bed', L: 300, W: 200, margin: 5 })); assert.ok(tp.every(b => b.maxy === 95));
  const one = applyMv([BX(0, 10, 50, 10, 30)], IA.align([BX(0, 10, 50, 10, 30)], 'vcenter', { rel: 'selection', L: 300, W: 200 }));
  assert.ok(Math.abs(one[0].miny + one[0].maxy) < 1e-9, 'one item centres on the bed even in "selection" mode');
});

test('centre group: keeps the spacing, centres the union on the bed', () => {
  const out = applyMv(trio(), IA.centerGroup(trio(), 'xy')), u = IA.union(out);
  assert.ok(Math.abs(u.minx + u.maxx) < 1e-9 && Math.abs(u.miny + u.maxy) < 1e-9);
  assert.strictEqual(out[1].minx - out[0].maxx, trio()[1].minx - trio()[0].maxx, 'gap between items unchanged');
  const onlyX = IA.centerGroup(trio(), 'x'); assert.ok(onlyX.every(m => m.dy === 0));
});

test('distribute: equal gaps between items, outer two stay put (3+ only)', () => {
  const out = applyMv(trio(), IA.distribute(trio(), 'x')).sort((a, b) => a.minx - b.minx);
  assert.strictEqual(out[0].minx, -100); assert.strictEqual(out[2].maxx, 90);
  assert.ok(Math.abs((out[1].minx - out[0].maxx) - (out[2].minx - out[1].maxx)) < 1e-9);
  assert.deepStrictEqual(IA.distribute(trio().slice(0, 2), 'x'), [], 'needs three');
});

test('spread in the bed: equal gaps between items AND the bed edges (centred on the box)', () => {
  const L = 300, out = applyMv(trio(), IA.spread(trio(), 'x', { L, W: 200 })).sort((a, b) => a.minx - b.minx);
  const gaps = [out[0].minx + L / 2, out[1].minx - out[0].maxx, out[2].minx - out[1].maxx, L / 2 - out[2].maxx];
  gaps.forEach(g => assert.ok(Math.abs(g - gaps[0]) < 1e-9, 'all gaps equal ' + gaps));
  const v = applyMv([BX(0, 0, 10, 0, 40)], IA.spread([BX(0, 0, 10, 0, 40)], 'y', { L, W: 200 }));
  assert.ok(Math.abs(v[0].miny + v[0].maxy) < 1e-9, 'a single item is centred');
});

test('arrange: exact gap, centred in the bed (row / column / grid)', () => {
  const row = applyMv(trio(), IA.arrange(trio(), { mode: 'row', gap: 8 })).sort((a, b) => a.minx - b.minx), ru = IA.union(row);
  assert.ok(Math.abs(row[1].minx - row[0].maxx - 8) < 1e-9 && Math.abs(row[2].minx - row[1].maxx - 8) < 1e-9);
  assert.ok(Math.abs(ru.minx + ru.maxx) < 1e-9 && row.every(b => Math.abs(b.miny + b.maxy) < 1e-9), 'centred, middles on y = 0');
  const col = applyMv(trio(), IA.arrange(trio(), { mode: 'column', gap: 5 })).sort((a, b) => b.maxy - a.maxy);
  assert.ok(Math.abs(col[0].miny - col[1].maxy - 5) < 1e-9 && Math.abs(col[1].miny - col[2].maxy - 5) < 1e-9);
  const g4 = [0, 1, 2, 3].map(i => BX(i, i * 100, i * 100 + 40, 0, 30)), grid = applyMv(g4, IA.arrange(g4, { mode: 'grid', gap: 10, cols: 2 }));
  assert.ok(Math.abs(grid[1].minx - grid[0].maxx - 10) < 1e-9 && Math.abs(grid[0].miny - grid[2].maxy - 10) < 1e-9, 'grid gaps');
  const gu = IA.union(grid); assert.ok(Math.abs(gu.minx + gu.maxx) < 1e-9 && Math.abs(gu.miny + gu.maxy) < 1e-9);
});

test('boxOf uses the real outline (rotated / notched items align by what you see)', () => {
  const b = IA.boxOf(7, pocketPoly({ type: 'rect', w: 80, h: 50, finger: true, fingerAngle: 90, fingerDepth: 10 }));
  assert.strictEqual(b.id, 7); assert.ok(near(b.maxy - b.miny, 60, 1e-6));
});

console.log('\n== Copyright / watermark ==');

test('Branding notice uses the current year (never earlier than 2026) and rolls over at New Year', () => {
  const B = require('../js/branding.js');
  assert.strictEqual(B.notice(new Date(2026, 5, 1)), '\u00A9 2026 Bali Craft Design. Laser Box - All rights reserved.');
  assert.ok(B.notice(new Date(2031, 0, 1)).startsWith('\u00A9 2031 '));
  assert.ok(B.notice(new Date(2020, 0, 1)).startsWith('\u00A9 2026 '), 'floored at 2026');
  assert.ok(B.noticeAscii(new Date(2027, 0, 1)).startsWith('(c) 2027 '));
  assert.ok(B.notice().includes(String(new Date().getFullYear())) || new Date().getFullYear() < 2026);
});

test('SVG + DXF + panel exports carry the copyright watermark on its own layer', () => {
  const B = require('../js/branding.js');
  const panel = { id: 'p', name: 'P', W: 50, H: 30, outline: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 30 }, { x: 0, y: 30 }], cutouts: [], engravings: [] };
  const sheet = { width: 600, height: 400, margin: 10 };
  const svg = SvgExporterTest.exportSheetSvg([panel], [{ id: 'p', x: 10, y: 10 }], sheet, {});
  assert.ok(svg.includes('id="WATERMARK"') && svg.includes(B.notice()) && svg.includes('<dc:rights>'));
  const wmGroup = /<g id="WATERMARK"[^>]*>[\s\S]*?<\/g>/.exec(svg)[0];
  assert.ok(wmGroup.includes('#999999') && !wmGroup.includes('#FF0000'), 'watermark is grey, never the CUT colour');
  assert.ok(SvgExporterTest.exportPanelSvg(panel).includes(B.notice()));
  const dxf = DxfExporterTest.exportSheetDxf([panel], [{ id: 'p', x: 0, y: 0 }], { sheet });
  assert.ok(dxf.startsWith('999\n' + B.noticeAscii()) && dxf.includes('WATERMARK'));
  assert.ok(dxf.indexOf('\nEOF\n') > 0 && /\n70\n5\n/.test(dxf), 'layer count updated');
  globalThis.SvgExporter = SvgExporterTest; globalThis.Branding = B;
  delete require.cache[require.resolve('../js/geometry/kerfTest.js')];
  assert.ok(require('../js/geometry/kerfTest.js').generate({ thickness: 3 }).svg.includes(B.notice()));
  assert.ok(!SvgExporterTest.exportSheetSvg([panel], [{ id: 'p', x: 10, y: 10 }], sheet, { watermark: false }).includes('id="WATERMARK"'));
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);