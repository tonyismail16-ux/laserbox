/**
 * artworkMapper.js — takes an imported artwork (from artworkImporter.js) and
 * a placement (panel, position, scale, rotation, operation) and produces
 * fully-resolved, panel-local geometry:
 *
 *   - operation 'cut'   -> panel.cutouts entries, layer 'cut'   (through-cut)
 *   - operation 'score' -> panel.cutouts entries, layer 'score' (vector score,
 *                          not a through-cut — same path, different laser pass)
 *   - operation 'engrave' -> panel.engravings entries of type 'artworkFill'
 *                          (a solid raster/fill area, no material removed)
 *
 * Every point is baked to its final, absolute panel-local (x,y) — nothing
 * downstream (SVG/DXF export, 2D preview, 3D preview) needs to know about
 * scale/rotation/placement; it only ever draws plain polylines, same as
 * every other piece of geometry in the app.
 *
 * Coordinate note: imported artwork is in SVG-style Y-DOWN space (as it
 * came out of the source file). Panels are Y-UP. `instanceToAbsolutePaths`
 * flips Y as part of the transform so the artwork appears right-side-up
 * when viewed against the panel face, matching what the designer saw in
 * their SVG/DXF editor.
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const V = isNode ? require('../geometry/vec2.js') : root.Vec2;

  function defaultInstance(overrides) {
    return Object.assign({
      id: 'art-' + Math.random().toString(36).slice(2, 9),
      name: 'Artwork',
      panelId: null,
      operation: 'engrave', // 'engrave' | 'cut' | 'score'
      x: 0, y: 0,           // placement anchor in panel-local mm (artwork center lands here)
      scale: 1,
      rotation: 0,          // degrees
      mirrorX: false,
      mirrorY: false,
      source: null,         // { subpaths, bounds } from ArtworkImporter
    }, overrides);
  }

  /** Transform every subpath of an artwork instance into absolute panel-local points. */
  function instanceToAbsolutePaths(instance) {
    const { subpaths, bounds } = instance.source;
    const cx = bounds.minX + bounds.width / 2;
    const cy = bounds.minY + bounds.height / 2;
    const s = instance.scale || 1;
    const mx = instance.mirrorX ? -1 : 1;
    const my = instance.mirrorY ? -1 : 1;
    const rad = ((instance.rotation || 0) * Math.PI) / 180;
    const cosA = Math.cos(rad), sinA = Math.sin(rad);

    return subpaths.map(sp => ({
      closed: sp.closed,
      points: sp.points.map(p => {
        // 1) center on the artwork's own bounding box
        let x = (p.x - cx) * mx;
        let y = (p.y - cy) * my;
        // 2) flip Y: source is Y-down, panels are Y-up
        y = -y;
        // 3) uniform scale
        x *= s; y *= s;
        // 4) rotate
        const rx = x * cosA - y * sinA;
        const ry = x * sinA + y * cosA;
        // 5) place at the anchor
        return { x: rx + instance.x, y: ry + instance.y };
      }),
    }));
  }

  /** Bounding size of the artwork AFTER scaling (before rotation), for UI display / fit-to-panel helpers. */
  function instanceScaledSize(instance) {
    const b = instance.source.bounds;
    return { width: b.width * instance.scale, height: b.height * instance.scale };
  }

  /** Scale factor that fits the artwork within `maxW x maxH`, preserving aspect ratio. */
  function fitScale(instance, maxW, maxH) {
    const b = instance.source.bounds;
    if (b.width <= 0 || b.height <= 0) return 1;
    return Math.min(maxW / b.width, maxH / b.height);
  }

  /**
   * Applies an artwork instance onto its target panel, mutating the panel's
   * cutouts/engravings arrays. Idempotent w.r.t. re-application if the
   * caller first removes any previous geometry tagged with this instance id
   * (see `removeInstanceFromPanel`).
   */
  function applyInstanceToPanel(instance, panel) {
    const paths = instanceToAbsolutePaths(instance);
    if (instance.operation === 'engrave') {
      panel.engravings = panel.engravings || [];
      for (const p of paths) {
        panel.engravings.push({ type: 'artworkFill', artworkId: instance.id, points: p.points, closed: p.closed });
      }
    } else {
      panel.cutouts = panel.cutouts || [];
      const layer = instance.operation === 'score' ? 'score' : 'cut';
      for (const p of paths) {
        panel.cutouts.push({ type: 'path', artworkId: instance.id, points: p.points, x: 0, y: 0, rotation: 0, closed: p.closed, layer });
      }
    }
    return panel;
  }

  function removeInstanceFromPanel(instanceId, panel) {
    if (panel.cutouts) panel.cutouts = panel.cutouts.filter(c => c.artworkId !== instanceId);
    if (panel.engravings) panel.engravings = panel.engravings.filter(e => e.artworkId !== instanceId);
    return panel;
  }

  /**
   * Applies every artwork instance in `instances` to the matching panel in
   * `panels` (by panelId). Call this once per geometry recompute, after
   * BoxGenerator.generate() and before validation/export, so artwork rides
   * along with every other per-panel override.
   */
  function applyAllArtwork(instances, panels) {
    const byId = {};
    for (const p of panels) byId[p.id] = p;
    for (const inst of instances) {
      const panel = byId[inst.panelId];
      if (panel && inst.source) applyInstanceToPanel(inst, panel);
    }
    return panels;
  }

  const ArtworkMapper = {
    defaultInstance, instanceToAbsolutePaths, instanceScaledSize, fitScale,
    applyInstanceToPanel, removeInstanceFromPanel, applyAllArtwork,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = ArtworkMapper;
  else root.ArtworkMapper = ArtworkMapper;
})(typeof window !== 'undefined' ? window : globalThis);
