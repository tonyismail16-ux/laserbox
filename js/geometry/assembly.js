/**
 * assembly.js — shared helpers for multi-assembly designs (body + dividers +
 * detached lid + display cover).
 *
 * Responsibilities (pure math, DOM-free, Node-testable):
 *   - Per-component material resolution (body / divider / lid / cover), with
 *     "inherit from body" semantics so legacy single-material projects work.
 *   - Panel metadata tagging (assemblyId, componentType, material, thickness,
 *     kerf, 3D frame, explode direction, joint notes).
 *   - 3D frames for the app's "endcap" box convention, plus rigid transforms
 *     so an upside-down cap can reuse the same finger-joint panels.
 *   - Axis-aligned collision boxes for assembly-level interference checks.
 *
 * A "frame" is { x, y, z, origin }: the panel's local x/y/outline axes and its
 * extrusion axis (thickness) expressed in global coordinates. This is exactly
 * the structure preview3d.js already used internally for legacy panels.
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const Vec2 = isNode ? require('./vec2.js') : root.Vec2;

  const ASSEMBLIES = {
    body: 'Box body',
    dividers: 'Divider grid',
    bed: 'Inner bed',
    lid: 'Detached lid',
    cover: 'Display cover',
  };

  /** Acrylic-family materials are treated as transparent and never finger-jointed. */
  function isTransparentMaterial(materialId) {
    return typeof materialId === 'string' && /^acrylic/i.test(materialId);
  }

  const COMPONENT_KEY = { body: '', divider: 'divider', bed: 'bed', lid: 'lid', cover: 'cover' };

  /**
   * Resolve the material for one component. Null/undefined fields inherit
   * from the body material, so a project with only the legacy single
   * material keeps working unchanged.
   */
  function resolveMaterial(p, component) {
    const key = COMPONENT_KEY[component];
    const pick = (suffix, fallback) => {
      if (!key) return fallback;
      const v = p[key + suffix];
      return v === null || v === undefined || v === '' ? fallback : v;
    };
    const materialId = pick('MaterialId', p.materialId);
    return {
      component,
      materialId,
      materialName: pick('MaterialName', p.materialName),
      materialColor: pick('MaterialColor', p.materialColor),
      thickness: pick('Thickness', p.thickness),
      kerf: pick('Kerf', p.kerf),
      transparent: isTransparentMaterial(materialId),
    };
  }

  /** Key used to decide which panels may share a physical sheet. */
  function sheetGroupKey(panel) {
    const id = panel.materialId || 'material';
    const t = panel.thickness != null ? panel.thickness : 0;
    return `${id}@${Number(t).toFixed(2)}`;
  }

  function sheetGroupLabel(panel) {
    const name = panel.materialName || panel.materialId || 'Material';
    return `${name} (${Number(panel.thickness || 0).toFixed(1)}mm)`;
  }

  /** Attach assembly/material/3D metadata to a generated panel (mutates + returns it). */
  function tagPanel(panel, meta) {
    meta = meta || {};
    const m = meta.material || {};
    panel.assemblyId = meta.assemblyId || panel.assemblyId || 'body';
    panel.componentType = meta.componentType || panel.componentType || 'panel';
    panel.materialId = m.materialId !== undefined ? m.materialId : panel.materialId;
    panel.materialName = m.materialName !== undefined ? m.materialName : panel.materialName;
    panel.materialColor = m.materialColor !== undefined ? m.materialColor : panel.materialColor;
    panel.thickness = m.thickness !== undefined ? m.thickness : panel.thickness;
    panel.kerf = m.kerf !== undefined ? m.kerf : panel.kerf;
    panel.transparent = m.transparent !== undefined ? !!m.transparent : !!panel.transparent;
    if (meta.frame3d) panel.frame3d = meta.frame3d;
    if (meta.explodeDir) panel.explodeDir = meta.explodeDir;
    if (meta.joint) panel.joint = meta.joint;
    if (meta.mating) panel.mating = meta.mating;
    if (meta.notes) panel.notes = meta.notes;
    if (meta.coreBounds) panel.coreBounds = meta.coreBounds;
    if (meta.collisionBoxes) panel.collisionBoxes = meta.collisionBoxes;
    return panel;
  }

  /** Fill defaults on panels from legacy box types (single material, always "body"). */
  function tagLegacy(panels, params) {
    for (const p of panels) {
      if (p.assemblyId) continue;
      tagPanel(p, {
        assemblyId: 'body',
        componentType: 'panel',
        material: {
          materialId: params.materialId, materialName: params.materialName,
          materialColor: params.materialColor, thickness: params.thickness,
          kerf: params.kerf, transparent: false,
        },
      });
    }
    return panels;
  }

  // ---------------------------------------------------------------------
  // 3D frames for the "endcap" convention (see boxGenerator.js header)
  // ---------------------------------------------------------------------

  const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

  /**
   * Frames of the six panels of a finger6-convention box of outer size
   * L x W x H and thickness t, whose min corner sits at `origin`.
   */
  function boxFrames(L, W, H, t, origin) {
    const o = origin || [0, 0, 0];
    const F = (x, y, z, org) => ({ x, y, z, origin: add3(org, o) });
    return {
      left: F([0, 1, 0], [0, 0, 1], [1, 0, 0], [0, 0, 0]),
      right: F([0, 1, 0], [0, 0, 1], [1, 0, 0], [L - t, 0, 0]),
      front: F([1, 0, 0], [0, 0, 1], [0, 1, 0], [t, 0, 0]),
      back: F([1, 0, 0], [0, 0, 1], [0, 1, 0], [t, W - t, 0]),
      bottom: F([1, 0, 0], [0, 1, 0], [0, 0, 1], [t, 0, 0]),
      top: F([1, 0, 0], [0, 1, 0], [0, 0, 1], [t, 0, H - t]),
    };
  }

  /**
   * Apply a proper rotation (no mirroring, so extrusion stays consistent) and
   * translation to a frame. rot: 'none' | 'flipX' (180° about the X axis).
   */
  function rigidFrame(frame, rot, T) {
    const R = rot === 'flipX' ? (v) => [v[0], -v[1], -v[2]] : (v) => v.slice();
    return { x: R(frame.x), y: R(frame.y), z: R(frame.z), origin: add3(R(frame.origin), T || [0, 0, 0]) };
  }

  // ---------------------------------------------------------------------
  // Bounds / collisions
  // ---------------------------------------------------------------------

  function localRects(panel) {
    if (panel.collisionBoxes && panel.collisionBoxes.length) return panel.collisionBoxes;
    const b = panel.coreBounds || Vec2.bounds(panel.outline);
    return [{ minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY }];
  }

  /** Global axis-aligned boxes occupied by a panel with a frame3d (one per local rect). */
  function panelBoxes(panel) {
    const f = panel.frame3d;
    if (!f) return [];
    const t = panel.thickness || 0;
    return localRects(panel).map(r => {
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (const a of [r.minX, r.maxX]) for (const b of [r.minY, r.maxY]) for (const c of [0, t]) {
        for (let i = 0; i < 3; i++) {
          const v = f.origin[i] + a * f.x[i] + b * f.y[i] + c * f.z[i];
          if (v < mn[i]) mn[i] = v;
          if (v > mx[i]) mx[i] = v;
        }
      }
      return { min: mn, max: mx };
    });
  }

  /** Overall global bounds of all frame-carrying panels. */
  function assembledBounds(panels) {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    let any = false;
    for (const p of panels) {
      for (const bx of panelBoxes(p)) {
        any = true;
        for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], bx.min[i]); mx[i] = Math.max(mx[i], bx.max[i]); }
      }
    }
    if (!any) return null;
    return { min: mn, max: mx, size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] };
  }

  function boxesOverlapVolume(a, b, eps) {
    eps = eps === undefined ? 1e-4 : eps;
    for (let i = 0; i < 3; i++) {
      if (Math.min(a.max[i], b.max[i]) - Math.max(a.min[i], b.min[i]) <= eps) return false;
    }
    return true;
  }

  /**
   * Find unintended interference between panels. Pairs inside one assembly
   * are skipped (finger joints and cross-lap dividers overlap by design in
   * AABB terms); body<->divider, and every pair involving lid/cover, are checked.
   * @returns {Array<{a:string,b:string}>}
   */
  function findCollisions(panels, eps) {
    // Outline compensation grows parts by kerf/2 beyond their nominal faces,
    // so surfaces that merely touch overlap by a hair. 0.2mm is above any
    // realistic kerf offset yet well below a genuine interference.
    eps = eps === undefined ? 0.2 : eps;
    const out = [];
    const boxes = panels.map(p => ({ p, boxes: panelBoxes(p) }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const A = boxes[i], B = boxes[j];
        if (!A.boxes.length || !B.boxes.length) continue;
        if (A.p.assemblyId === B.p.assemblyId) continue;
        let hit = false;
        for (const ba of A.boxes) { for (const bb of B.boxes) { if (boxesOverlapVolume(ba, bb, eps)) { hit = true; break; } } if (hit) break; }
        if (hit) out.push({ a: A.p.id, b: B.p.id, aName: A.p.name, bName: B.p.name, aAssembly: A.p.assemblyId, bAssembly: B.p.assemblyId });
      }
    }
    return out;
  }

  const Assembly = {
    ASSEMBLIES, isTransparentMaterial, resolveMaterial, sheetGroupKey, sheetGroupLabel,
    tagPanel, tagLegacy, boxFrames, rigidFrame, panelBoxes, assembledBounds, findCollisions,
  };

  if (isNode) module.exports = Assembly;
  else root.Assembly = Assembly;
})(typeof window !== 'undefined' ? window : globalThis);
