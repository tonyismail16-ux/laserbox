/**
 * validator.js — manufacturing-facing validation. Produces plain-language
 * warnings someone operating a laser cutter can act on, not stack traces.
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const V = isNode ? require('../geometry/vec2.js') : root.Vec2;

  const SEVERITY = { INFO: 'info', WARN: 'warning', ERROR: 'error' };

  function issue(severity, message, code) {
    return { severity, message, code: code || null };
  }

  /**
   * @param {object} params    the current box parameters
   * @param {object} result    { panels, warnings, info } from BoxGenerator.generate
   * @param {object} [sheet]   optional { width, height } sheet dimensions to check fit against
   */
  function validate(params, result, sheet, layout) {
    const issues = [];

    // Errors raised by feature generators (dividers / lids / cover) — these
    // carry actionable text and are NEVER silently clamped away.
    for (const e of result.errors || []) issues.push(issue(SEVERITY.ERROR, e.message, e.code || 'generator-error'));
    const t = params.thickness, k = params.kerf;

    if (k <= 0) issues.push(issue(SEVERITY.INFO, 'Kerf is set to 0 — no compensation will be applied. Real laser cuts always remove some material; consider running the kerf test generator.'));
    if (k >= t * 0.8) issues.push(issue(SEVERITY.WARN, `Kerf (${k}mm) is close to or exceeds material thickness (${t}mm) — finger joints may be too loose or fail to form.`, 'kerf-vs-thickness'));

    // Generator-level warnings (finger width, impossible geometry, etc.)
    for (const w of result.warnings) issues.push(issue(SEVERITY.WARN, w, 'generator'));

    // Per-panel geometry checks
    for (const panel of result.panels) {
      if (!panel.outline || panel.outline.length < 3) {
        issues.push(issue(SEVERITY.ERROR, `Panel "${panel.name}" has degenerate geometry (fewer than 3 points) — check dimensions and finger settings.`, 'degenerate-panel'));
        continue;
      }
      const area = V.signedArea(panel.outline);
      if (Math.abs(area) < 1) {
        issues.push(issue(SEVERITY.ERROR, `Panel "${panel.name}" has near-zero area — dimensions may be too small for the current material thickness and finger settings.`, 'zero-area'));
      }
      // Self-intersection is expensive to check exactly; flag an approximate
      // symptom instead: any segment shorter than a tenth of the kerf, which
      // usually indicates two cuts have collapsed into each other.
      for (let i = 0; i < panel.outline.length; i++) {
        const a = panel.outline[i];
        const b = panel.outline[(i + 1) % panel.outline.length];
        const segLen = V.dist(a, b);
        if (segLen > 0 && segLen < Math.max(k, 0.05) / 2) {
          issues.push(issue(SEVERITY.WARN, `Panel "${panel.name}" has a very short segment (${segLen.toFixed(3)}mm) near a joint — likely a kerf/finger-width collision.`, 'joint-collision'));
          break;
        }
      }
      // Cutouts fully outside panel bounds
      const b = V.bounds(panel.outline);
      for (const c of panel.cutouts || []) {
        if (c.x < b.minX || c.x > b.maxX || c.y < b.minY || c.y > b.maxY) {
          issues.push(issue(SEVERITY.WARN, `A cutout on panel "${panel.name}" is positioned outside the panel bounds.`, 'cutout-oob'));
        }
      }
    }

    // Per-component checks (only meaningful when components differ from the body)
    const seenComponent = {};
    for (const panel of result.panels) {
      if (panel.thickness !== undefined && !(panel.thickness > 0)) {
        issues.push(issue(SEVERITY.ERROR, `Panel "${panel.name}" has a non-positive material thickness (${panel.thickness}).`, 'panel-thickness'));
      }
      if (!panel.outline || panel.outline.length < 3) continue;
      // Zero-length and duplicated edges break laser paths and double-cut.
      const n = panel.outline.length, edgeKeys = {};
      let zero = false, dup = false;
      for (let i = 0; i < n; i++) {
        const a = panel.outline[i], b = panel.outline[(i + 1) % n];
        if (V.dist(a, b) < 1e-6) zero = true;
        const ka = a.x.toFixed(4) + ',' + a.y.toFixed(4), kb = b.x.toFixed(4) + ',' + b.y.toFixed(4);
        const key = ka < kb ? ka + '|' + kb : kb + '|' + ka;
        if (edgeKeys[key]) dup = true;
        edgeKeys[key] = true;
      }
      if (zero) issues.push(issue(SEVERITY.ERROR, `Panel "${panel.name}" contains a zero-length edge — the laser would stall or double-cut there.`, 'zero-length-edge'));
      if (dup) issues.push(issue(SEVERITY.ERROR, `Panel "${panel.name}" contains a duplicated edge — it would be cut twice.`, 'duplicate-edge'));

      const ck = (panel.assemblyId || 'body') + '|' + panel.materialId + '|' + panel.thickness + '|' + panel.kerf;
      if (panel.kerf !== undefined && panel.thickness > 0 && panel.assemblyId && panel.assemblyId !== 'body' && !seenComponent[ck]) {
        seenComponent[ck] = true;
        if (panel.kerf >= panel.thickness * 0.8) {
          issues.push(issue(SEVERITY.WARN, `Kerf (${panel.kerf}mm) is close to or exceeds the ${panel.assemblyId} material thickness (${panel.thickness}mm) — those joints/slots will be too loose.`, 'component-kerf'));
        }
      }
    }

    // Sheet layout: every part must be placed, inside the sheet, without overlap
    if (layout) {
      for (const u of layout.unplaced || []) {
        issues.push(issue(SEVERITY.ERROR, `The cutting layout exceeds the available sheet dimensions: part "${u.name || u.id}" (${u.width.toFixed(0)}×${u.height.toFixed(0)}mm) does not fit on a ${sheet.width}×${sheet.height}mm sheet with ${sheet.margin || 0}mm margins.`, 'layout-unplaced'));
      }
      const SheetLayout = isNode ? require('../geometry/sheetLayout.js') : root.SheetLayout;
      if (SheetLayout && SheetLayout.findOverlaps) {
        for (const o of SheetLayout.findOverlaps(layout, sheet)) {
          issues.push(issue(SEVERITY.ERROR, o.kind === 'overlap'
            ? `Parts "${o.a}" and "${o.b}" overlap in the cutting layout (sheet ${o.sheet + 1}).`
            : `Part "${o.a}" extends outside the usable area of sheet ${o.sheet + 1}.`, 'layout-' + o.kind));
        }
      }
      const placedIds = {};
      for (const s of layout.sheets) for (const pl of s.placements) placedIds[pl.id] = (placedIds[pl.id] || 0) + 1;
      for (const panel of result.panels) {
        if (!placedIds[panel.id] && !(layout.unplaced || []).some(u => u.id === panel.id)) {
          issues.push(issue(SEVERITY.ERROR, `Component "${panel.name}" was generated but not placed in the cutting layout.`, 'layout-missing'));
        }
      }
    }

    // Sheet fit
    if (sheet && sheet.width && sheet.height) {
      for (const panel of result.panels) {
        const b = V.bounds(panel.outline);
        if (b.width > sheet.width - 2 * (sheet.margin || 0) && b.height > sheet.height - 2 * (sheet.margin || 0)) {
          issues.push(issue(SEVERITY.ERROR, `Panel "${panel.name}" (${b.width.toFixed(0)}×${b.height.toFixed(0)}mm) cannot fit on the selected sheet even with rotation.`, 'sheet-fit'));
        }
      }
    }

    // Material vs joint depth
    if (t > Math.min(params.length, params.width, params.height) / 2) {
      issues.push(issue(SEVERITY.WARN, 'Material thickness is large relative to box dimensions — joints may be structurally weak.', 'thickness-ratio'));
    }

    return issues;
  }

  function summarize(issues) {
    return {
      errors: issues.filter(i => i.severity === SEVERITY.ERROR).length,
      warnings: issues.filter(i => i.severity === SEVERITY.WARN).length,
      infos: issues.filter(i => i.severity === SEVERITY.INFO).length,
    };
  }

  const Validator = { validate, summarize, SEVERITY };

  if (typeof module !== 'undefined' && module.exports) module.exports = Validator;
  else root.Validator = Validator;
})(typeof window !== 'undefined' ? window : globalThis);
