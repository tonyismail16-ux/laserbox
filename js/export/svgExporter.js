/**
 * svgExporter.js — turns panel geometry into a clean, layered SVG string.
 * Uses the exact same `panel.outline` / `panel.cutouts` / `panel.engravings`
 * arrays that drive the 2D and 3D previews — there is no separate "export
 * geometry".
 *
 * Layers are emitted as named, colour-coded <g> groups so the file opens
 * correctly in LightBurn, Illustrator, and Inkscape (which read top-level
 * groups as layers; LightBurn primarily by colour, which is why exported
 * files ALWAYS use the strict production colours below regardless of
 * whatever colours are configured for the on-screen preview):
 *
 *   RED   #FF0000  CUT    — every through-cut: outlines, joints, cutouts
 *   BLACK #000000  ENGRAVE — raster/fill engraving (uploaded artwork fills)
 *   BLUE  #0000FF  SCORE  — vector scoring / guide lines (no through-cut)
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const V = isNode ? require('../geometry/vec2.js') : root.Vec2;
  const Branding = isNode ? require('../branding.js') : root.Branding;

  // Exact production colours, per laser-software convention. `panelToSvgGroup`
  // uses these unless explicitly called with `strict:false` (used only by the
  // interactive on-screen preview, which is allowed to use custom colours).
  const STRICT_COLORS = { cut: '#FF0000', engrave: '#000000', score: '#0000FF', guide: '#999999' };

  function pointsToPathD(points, decimals, closed) {
    if (!points.length) return '';
    const fmt = (n) => V.round(n, decimals === undefined ? 3 : decimals);
    let d = `M ${fmt(points[0].x)} ${fmt(points[0].y)} `;
    for (let i = 1; i < points.length; i++) d += `L ${fmt(points[i].x)} ${fmt(points[i].y)} `;
    if (closed !== false) d += 'Z';
    return d;
  }

  function escapeXml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /**
   * Copyright metadata + visible watermark for exported files.
   * - <metadata> carries the notice invisibly (dc:rights) for any SVG reader.
   * - The visible text lives in its OWN grey layer (#999999, same colour as the
   *   part-label guide layer) so laser software can set it to "don't output";
   *   it is never part of the CUT (red) / ENGRAVE (black) / SCORE (blue) layers.
   */
  function copyrightMetadata() {
    const n = escapeXml(Branding.notice());
    return `  <metadata>\n    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/">\n` +
      `      <rdf:Description>\n        <dc:rights>${n}</dc:rights>\n        <dc:creator>${escapeXml(Branding.OWNER)}</dc:creator>\n      </rdf:Description>\n    </rdf:RDF>\n  </metadata>\n`;
  }
  function watermarkLayer(x, y, size) {
    return `  <g id="WATERMARK" class="layer-watermark" data-layer="watermark" fill="${STRICT_COLORS.guide}" stroke="none">\n` +
      `    <text x="${V.round(x, 2)}" y="${V.round(y, 2)}" font-size="${size}" font-family="sans-serif">${escapeXml(Branding.notice())}</text>\n  </g>\n`;
  }

  function flipY(points, H) { return points.map(p => ({ x: p.x, y: H - p.y })); }

  /**
   * @param {object} panel   with .outline, .cutouts, .engravings, .W, .H, .name
   * @param {object} opts    { x, y, rotated, colors, strict, showLabel, decimals, interactive }
   *   `strict` (default true) forces the exact production colours above,
   *   ignoring `colors`. Pass `strict:false` with a `colors` override for
   *   the customizable on-screen preview only — never for production export.
   */
  function panelToSvgGroup(panel, opts) {
    opts = opts || {};
    const strict = opts.strict !== false;
    const colors = strict ? STRICT_COLORS : Object.assign({}, STRICT_COLORS, opts.colors);
    const x = opts.x || 0, y = opts.y || 0;
    // 90° CW: after the Y flip the outline spans x∈[0,W], y∈[0,H]; translate by -H first so it lands in x∈[0,H], y∈[0,W]
    let transform;
    if (opts.fitBounds) {
      // Anchor the drawing to the real outline bounds (tabs protrude a hair past the nominal W/H)
      // so the part's bounding box lands exactly on its placement box (x, y, w, h).
      const b = V.bounds(panel.outline);
      if (opts.rotated) {
        // flipped point (px, H-py) -> rotate(90): (-(H-py), px); shift so the bbox min is the origin
        transform = `translate(${V.round(x, 3)} ${V.round(y, 3)}) rotate(90) translate(${V.round(-b.minX, 4)} ${V.round(b.minY - panel.H, 4)})`;
      } else {
        transform = `translate(${V.round(x - b.minX, 4)} ${V.round(y - (panel.H - b.maxY), 4)})`;
      }
    } else {
      // 90° CW: after the Y flip the outline spans x∈[0,W], y∈[0,H]; translate by -H first so it lands in x∈[0,H], y∈[0,W]
      const rotate = opts.rotated ? `rotate(90) translate(0 ${-panel.H})` : '';
      transform = `translate(${V.round(x, 3)} ${V.round(y, 3)}) ${rotate}`.trim();
    }

    const PanelGeo = isNode ? require('../geometry/panel.js') : root.Panel;

    // ---- CUT layer: panel outline + every cutout NOT tagged 'score' ----
    let cutInner = `    <path class="cut-outline" d="${pointsToPathD(flipY(panel.outline, panel.H))}" />\n`;
    let scoreInner = '';
    for (const c of panel.cutouts || []) {
      const poly = PanelGeo.buildCutout(c);
      const flipped = flipY(poly, panel.H);
      const layer = c.layer || 'cut';
      const d = pointsToPathD(flipped, undefined, c.closed !== false);
      if (layer === 'score') scoreInner += `    <path class="cutout-score" data-layer="score" d="${d}" />\n`;
      else cutInner += `    <path class="cutout-cut" data-layer="cut" d="${d}" />\n`;
    }

    // ---- ENGRAVE layer: text labels/notes + grouped artwork fills ----
    let engraveInner = '';
    const artworkGroups = {};
    for (const e of panel.engravings || []) {
      if (e.type === 'text') {
        const ey = panel.H - e.y;
        engraveInner += `    <text x="${V.round(e.x, 2)}" y="${V.round(ey, 2)}" font-size="${e.size || 4}" font-family="${escapeXml(e.font || 'sans-serif')}" text-anchor="${e.anchor || 'start'}">${escapeXml(e.text)}</text>\n`;
      } else if (e.type === 'artworkFill') {
        const key = e.artworkId || 'artwork';
        (artworkGroups[key] = artworkGroups[key] || []).push(e);
      }
    }
    // Combine every subpath of one artwork into a single multi-subpath
    // <path> with fill-rule="evenodd" so internal holes (e.g. the counter
    // of a letter "O") render as holes rather than solid fill.
    for (const key of Object.keys(artworkGroups)) {
      let d = '';
      for (const sp of artworkGroups[key]) d += pointsToPathD(flipY(sp.points, panel.H), undefined, sp.closed !== false) + ' ';
      engraveInner += `    <path class="artwork-fill" data-artwork="${escapeXml(key)}" fill-rule="evenodd" d="${d.trim()}" />\n`;
    }

    let label = '';
    if (opts.showLabel) {
      const asm = panel.assemblyId && panel.assemblyId !== 'body' ? ` [${panel.assemblyId}]` : '';
      label = `    <text class="part-label" x="2" y="${panel.H - 2}" font-size="3">${escapeXml(panel.name)}${asm}${panel.partNumber ? ' #' + panel.partNumber : ''}</text>\n`;
    }

    // Invisible hit-area so the whole panel body is clickable for selection
    // on screen (paths here use fill="none", so only the stroke itself would
    // otherwise be clickable). Only added for the interactive on-screen
    // preview — never for exported production files, which stay clean.
    const hitRect = opts.interactive
      ? `    <rect class="hit-area" x="0" y="0" width="${V.round(panel.W, 3)}" height="${V.round(panel.H, 3)}" fill="transparent" style="pointer-events:all" />\n`
      : '';

    // Assembly/material identification lives in plain data-* attributes on
    // the group, never in the cut layers, so it cannot affect cutting paths.
    const assemblyAttr = panel.assemblyId ? ` data-assembly="${escapeXml(panel.assemblyId)}" data-material="${escapeXml(panel.materialId || '')}" data-thickness="${panel.thickness !== undefined ? panel.thickness : ''}"` : '';
    return `  <g class="panel" data-part="${escapeXml(panel.id)}" data-name="${escapeXml(panel.name)}"${assemblyAttr} transform="${transform}">\n` +
      hitRect +
      `    <g class="layer-cut" fill="none" stroke="${colors.cut}" stroke-width="0.1">\n${cutInner}    </g>\n` +
      (scoreInner ? `    <g class="layer-score" fill="none" stroke="${colors.score}" stroke-width="0.1">\n${scoreInner}    </g>\n` : '') +
      (engraveInner ? `    <g class="layer-engrave" fill="${colors.engrave}" stroke="none">\n${engraveInner}    </g>\n` : '') +
      (label ? `    <g class="layer-guide" fill="${colors.guide}" stroke="none">\n${label}    </g>\n` : '') +
      `  </g>\n`;
  }

  /**
   * Export a full sheet layout as one SVG document. Always uses the strict
   * production colours (RED/BLACK/BLUE) regardless of preview settings.
   * @param {Array} panels     panel objects (with .outline etc.)
   * @param {object} placements  from SheetLayout.pack(...).sheets[i].placements
   * @param {object} sheet     { width, height }
   * @param {object} opts      { showLabels, decimals }
   */
  function exportSheetSvg(panels, placements, sheet, opts) {
    opts = opts || {};
    const byId = {};
    for (const p of panels) byId[p.id] = p;

    let body = '';
    for (const pl of placements) {
      const panel = byId[pl.id];
      if (!panel) continue;
      // opts.assemblies: optional whitelist (e.g. ['lid']) for per-assembly exports
      if (opts.assemblies && opts.assemblies.indexOf(panel.assemblyId || 'body') < 0) continue;
      body += panelToSvgGroup(panel, { x: pl.x, y: pl.y, rotated: pl.rotated, strict: true, showLabel: opts.showLabels, fitBounds: true });
    }

    return `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${sheet.width}mm" height="${sheet.height}mm" ` +
      `viewBox="0 0 ${sheet.width} ${sheet.height}">\n` +
      `  <!-- Generated by LaserBox Studio. Units: millimeters.${opts.title ? '\n       ' + escapeXml(opts.title) : ''}\n` +
      `       Layers: CUT #FF0000 (through-cuts) | ENGRAVE #000000 (raster fill) | SCORE #0000FF (vector score) | WATERMARK #999999 (copyright text, do not output).\n` +
      `       ${escapeXml(Branding.notice())} -->\n` +
      (opts.watermark === false ? '' : copyrightMetadata()) +
      body +
      (opts.watermark === false ? '' : watermarkLayer(Math.min(4, (sheet.margin || 4)), sheet.height - 2, 2.5)) +
      `</svg>\n`;
  }

  /** Export a single panel as its own standalone SVG (no sheet placement). Always strict production colours. */
  function exportPanelSvg(panel, opts) {
    opts = opts || {};
    const pad = opts.pad || 2;
    const wm = opts.watermark !== false;
    const w = panel.W + pad * 2, h = panel.H + pad * 2 + (wm ? 5 : 0);
    const body = panelToSvgGroup(panel, { x: pad, y: pad, strict: true, showLabel: opts.showLabels });
    return `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">\n` +
      `  <!-- ${escapeXml(Branding.notice())} -->\n` +
      (wm ? copyrightMetadata() : '') +
      body +
      (wm ? watermarkLayer(pad, h - 1.5, Math.min(2.5, Math.max(1.2, (w - pad * 2) / 55))) : '') +
      `</svg>\n`;
  }

  const SvgExporter = { exportSheetSvg, exportPanelSvg, panelToSvgGroup, pointsToPathD, STRICT_COLORS };

  if (typeof module !== 'undefined' && module.exports) module.exports = SvgExporter;
  else root.SvgExporter = SvgExporter;
})(typeof window !== 'undefined' ? window : globalThis);
