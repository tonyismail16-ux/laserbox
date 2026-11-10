/**
 * stateManager.js — the single source of truth for the whole application.
 * The UI reads from `State.current` and calls `State.update(patch)` /
 * `State.updateParams(patch)`; every update triggers a synchronous
 * recompute of geometry + validation + layout, then notifies subscribers.
 * There is exactly one geometry recompute path, used by the 2D preview,
 * 3D preview, properties panel, and exporters alike.
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  // Resolve a sibling module: require() under Node (tests), window global in the browser.
  const dep = (name, path) => (isNode ? require(path) : root[name]);

  function featureDefaults() {
    const CB = dep('CustomBox', '../geometry/customBox.js');
    return CB ? CB.featureDefaults() : {};
  }

  function defaultParams() {
    return Object.assign({
      // Box-feature parameters (dividers / detached lid / display cover) are
      // appended below via featureDefaults(), so old projects load unchanged.
    }, baseParams(), featureDefaults());
  }

  function baseParams() {
    return {
      boxType: 'finger6',
      length: 300, width: 200, height: 100,
      thickness: 3, kerf: 0.15,
      materialId: 'ply3', materialName: '3mm Plywood', materialColor: '#c69a63',
      fingerMode: 'count', // 'count' | 'width' | 'manual'
      fingerCount: 10, fingerWidth: 20,
      minFingerWidth: 3, maxFingerWidth: 50,
      outlineCompensation: 'auto', // 'auto' | 'inside' | 'outside' | 'none'
      lidStyle: 'flat', // 'flat' | 'none'
      bottomStyle: 'flat', // 'flat' | 'none'
      // Sliding lid box (js/geometry/slidingLidBox.js)
      lidClearance: 0.2, horizontalClearance: 0.3,
      frontLowerAmount: null, railWidth: null, railSetbackFromFront: 24,
      thumbPull: { enabled: true, radius: 10 },
      // Hinged box (js/geometry/hingedBox.js)
      hingeStyle: 'living', hingeSegments: 'continuous', hingeSegmentCount: 3,
      lidOpening: 'oneWay', hingeBandHeight: 8, hingeSlitPitch: 2.5,
      knuckleCount: 9, pinHoleDiameter: 2.0,
    };
  }

  function defaultSheet() {
    return { width: 600, height: 400, margin: 10, spacing: 4, allowRotation: true, groupByMaterial: false };
  }

  function defaultState() {
    return {
      project: { name: 'Untitled Box', units: 'mm', precision: 2, createdAt: Date.now() },
      params: defaultParams(),
      sheet: defaultSheet(),
      machine: { id: 'co2-80w', name: 'CO2 Laser 80W', speedCutMmPerMin: 600, speedEngraveMmPerMin: 6000, passes: 1 },
      layerColors: { cut: '#FF0000', engrave: '#000000', score: '#0000FF', guide: '#9aa0a6' },
      ui: { view: '3d', selectedPanelId: null, showLabels: true, exploded: false, lidLifted: false, showGrid: true, debugMode: false },
      panelOverrides: {}, // { [panelId]: { cutouts: [], engravings: [], edgeOverrides: {} } }
      artwork: [], // ArtworkMapper instances: { id, panelId, operation, x, y, scale, rotation, source }
    };
  }

  const listeners = [];
  let current = defaultState();
  let derived = null; // { result, issues, layout }

  function applyOverrides(panels, overrides) {
    for (const panel of panels) {
      const o = overrides[panel.id];
      if (!o) continue;
      // Overrides only ever represent manually-authored geometry — artwork
      // is re-derived fresh from `current.artwork` on every recompute (see
      // below), so any artwork-tagged entries here are stripped to avoid
      // them being both replayed from the override AND re-applied by
      // ArtworkMapper, which would double them up on every subsequent edit.
      // Generated structural cutouts (divider wall slots, seat-ring openings)
      // are re-derived on every recompute from the parameters, so they are
      // never taken from — or duplicated by — a stored override.
      const structural = (panel.cutouts || []).filter(c => c.structural);
      if (o.cutouts) panel.cutouts = structural.concat(o.cutouts.filter(c => !c.artworkId && !c.structural));
      if (o.engravings) panel.engravings = o.engravings.filter(e => !e.artworkId);
      if (o.partNumber !== undefined) panel.partNumber = o.partNumber;
    }
    return panels;
  }

  function polygonAreaAbs(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) { const p1 = pts[i], p2 = pts[(i + 1) % pts.length]; a += p1.x * p2.y - p2.x * p1.y; }
    return Math.abs(a / 2);
  }

  function recompute() {
    const BoxGenerator = dep('BoxGenerator', '../geometry/boxGenerator.js');
    const Validator = dep('Validator', '../validation/validator.js');
    const SheetLayout = dep('SheetLayout', '../geometry/sheetLayout.js');
    const Vec2 = dep('Vec2', '../geometry/vec2.js');
    const Panel = dep('Panel', '../geometry/panel.js');
    const Assembly = dep('Assembly', '../geometry/assembly.js');
    const ArtworkMapper = isNode ? null : root.ArtworkMapper;

    const result = BoxGenerator.generate(current.params);
    applyOverrides(result.panels, current.panelOverrides);
    if (ArtworkMapper && current.artwork && current.artwork.length) {
      ArtworkMapper.applyAllArtwork(current.artwork, result.panels);
    }

    // Parts that share a physical sheet must share material + thickness.
    const items = result.panels.map(p => {
      const b = Vec2.bounds(p.outline);
      return {
        id: p.id, name: p.name, width: b.width, height: b.height, allowRotate: current.sheet.allowRotation,
        group: Assembly.sheetGroupKey(p), groupLabel: Assembly.sheetGroupLabel(p),
      };
    });
    const layout = SheetLayout.packGroups(items, current.sheet);
    const issues = Validator.validate(current.params, result, current.sheet, layout);

    const cutLenOf = (p) => Vec2.perimeter(p.outline) +
      (p.cutouts || []).filter(c => c.layer !== 'score').reduce((cs, c) => cs + Vec2.perimeter(Panel.buildCutout(c)), 0);
    const totalCutLength = result.panels.reduce((s, p) => s + Vec2.perimeter(p.outline) +
      (p.cutouts || []).reduce((cs, c) => cs + Vec2.perimeter(Panel.buildCutout(c)), 0), 0);
    const totalEngraveLength = result.panels.reduce((s, p) => s + (p.engravings || []).reduce((es, e) =>
      es + (e.type === 'text' ? (e.text || '').length * (e.size || 4) * 1.3 : 0), 0), 0);

    const cutTimeMin = current.machine.speedCutMmPerMin ? (totalCutLength * (current.machine.passes || 1)) / current.machine.speedCutMmPerMin : null;
    const engraveTimeMin = current.machine.speedEngraveMmPerMin ? totalEngraveLength / current.machine.speedEngraveMmPerMin : null;

    // Per-component manufacturing data (no prices: those need real material
    // costs and machine rates, so only quantities are exposed here).
    const components = result.panels.map(p => {
      const holes = (p.cutouts || []).filter(c => c.layer !== 'score' && c.closed !== false)
        .reduce((a, c) => a + polygonAreaAbs(Panel.buildCutout(c)), 0);
      return {
        id: p.id, name: p.name, assemblyId: p.assemblyId, componentType: p.componentType,
        materialId: p.materialId, materialName: p.materialName, thickness: p.thickness,
        area: Math.max(polygonAreaAbs(p.outline) - holes, 0), cutLength: cutLenOf(p),
      };
    });
    const byMaterial = {}, byAssembly = {};
    for (const c of components) {
      const key = Assembly.sheetGroupKey({ materialId: c.materialId, thickness: c.thickness });
      const m = byMaterial[key] = byMaterial[key] || { key, materialName: c.materialName, thickness: c.thickness, parts: 0, partArea: 0, cutLength: 0, sheets: 0 };
      m.parts++; m.partArea += c.area; m.cutLength += c.cutLength;
      const a = byAssembly[c.assemblyId] = byAssembly[c.assemblyId] || { assemblyId: c.assemblyId, parts: 0, partArea: 0, cutLength: 0 };
      a.parts++; a.partArea += c.area; a.cutLength += c.cutLength;
    }
    // a sheet counts toward every material that has at least one part on it
    for (const sh of layout.sheets) {
      const mats = {};
      for (const pl of sh.placements) mats[pl.group] = true;
      for (const k of Object.keys(mats)) if (byMaterial[k]) byMaterial[k].sheets++;
    }

    derived = {
      result, issues, layout,
      info: {
        totalCutLength, totalEngraveLength,
        cutTimeMin, engraveTimeMin,
        estimatedTimeMin: (cutTimeMin || 0) + (engraveTimeMin || 0),
        partCount: result.panels.length,
        sheetsNeeded: layout.totalSheets,
        utilization: layout.utilization,
        components, byMaterial, byAssembly,
      },
    };
    return derived;
  }

  function notify() {
    for (const fn of listeners) fn(current, derived);
  }

  function subscribe(fn) {
    listeners.push(fn);
    return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  }

  function update(patch) {
    Object.assign(current, patch);
    recompute();
    notify();
  }

  function updateParams(patch) {
    Object.assign(current.params, patch);
    recompute();
    notify();
  }

  function updateSheet(patch) {
    Object.assign(current.sheet, patch);
    recompute();
    notify();
  }

  function updatePanelOverride(panelId, patch) {
    current.panelOverrides[panelId] = Object.assign({}, current.panelOverrides[panelId], patch);
    recompute();
    notify();
  }

  function addArtwork(instance) {
    current.artwork.push(instance);
    recompute();
    notify();
    return instance;
  }

  function updateArtwork(id, patch) {
    const inst = current.artwork.find(a => a.id === id);
    if (inst) Object.assign(inst, patch);
    recompute();
    notify();
  }

  function removeArtwork(id) {
    current.artwork = current.artwork.filter(a => a.id !== id);
    recompute();
    notify();
  }

  function replaceState(newState) {
    current = newState;
    recompute();
    notify();
  }

  function reset() {
    current = defaultState();
    recompute();
    notify();
  }

  recompute();

  const State = {
    get current() { return current; },
    get derived() { return derived; },
    subscribe, update, updateParams, updateSheet, updatePanelOverride, replaceState, reset,
    addArtwork, updateArtwork, removeArtwork,
    defaultState, defaultParams, defaultSheet, recompute, featureDefaults,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = State;
  else root.State = State;
})(typeof window !== 'undefined' ? window : globalThis);
