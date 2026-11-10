/**
 * dxfExporter.js — minimal but valid DXF (R12 ASCII) writer.
 *
 * R12 is used deliberately over newer LWPOLYLINE-based DXF because it is
 * the most universally readable variant across laser/CAM software, at the
 * cost of slightly more verbose POLYLINE/VERTEX/SEQEND entities.
 *
 * Layers follow the same strict production colour-coding as the SVG export:
 *   CUT     red   (#FF0000 / ACI 1)   — through-cuts
 *   ENGRAVE black (#000000 / ACI 0)   — raster/fill engraving (artwork fills)
 *   SCORE   blue  (#0000FF / ACI 5)   — vector scoring, no through-cut
 * Both the legacy ACI index (group 62, for older readers) and a true 24-bit
 * RGB colour (group 420, code 0x62 = "true color", read by LightBurn and
 * most modern CAM software) are written so the exact hex values match
 * regardless of which colour model the importing software prefers.
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const V = isNode ? require('../geometry/vec2.js') : root.Vec2;
  const Branding = isNode ? require('../branding.js') : root.Branding;

  const LAYER_COLORS = {
    CUT: { aci: 1, rgb: 0xFF0000 },
    ENGRAVE: { aci: 0, rgb: 0x000000 },
    SCORE: { aci: 5, rgb: 0x0000FF },
    LABEL: { aci: 8, rgb: 0x999999 }, // part names; separate layer so it can be switched off / set to "don't output"
    WATERMARK: { aci: 8, rgb: 0x999999 }, // copyright notice; own layer, set to "don't output"
  };

  function polylineEntity(points, layer, closed) {
    const flag = closed === false ? 0 : 1;
    let s = '0\nPOLYLINE\n8\n' + layer + '\n66\n1\n70\n' + flag + '\n';
    for (const p of points) {
      s += '0\nVERTEX\n8\n' + layer + '\n10\n' + V.round(p.x, 4) + '\n20\n' + V.round(p.y, 4) + '\n30\n0.0\n';
    }
    s += '0\nSEQEND\n';
    return s;
  }

  function textEntity(x, y, height, text, layer, rotation) {
    return `0\nTEXT\n8\n${layer}\n10\n${V.round(x, 4)}\n20\n${V.round(y, 4)}\n30\n0.0\n40\n${height}\n1\n${String(text).replace(/\n/g, ' ')}\n` + (rotation ? `50\n${rotation}\n` : '');
  }

  /**
   * @param {Array} panels      panel objects with .outline, .cutouts, .engravings
   * @param {Array} placements  [{id, x, y, rotated}] from sheet layout
   */
  function exportSheetDxf(panels, placements, opts) {
    opts = opts || {};
    const PanelGeo = isNode ? require('../geometry/panel.js') : root.Panel;
    const byId = {};
    for (const p of panels) byId[p.id] = p;

    let entities = '';
    for (const pl of placements) {
      const panel = byId[pl.id];
      if (!panel) continue;
      if (opts.assemblies && opts.assemblies.indexOf(panel.assemblyId || 'body') < 0) continue;
      const ob = V.bounds(panel.outline);
      // Anchor to the real outline bounds so the part's bbox lands exactly on its placement box.
      const transform = (p) => {
        let x = p.x - ob.minX, y = p.y - ob.minY;
        if (pl.rotated) { const rx = -y + ob.height; const ry = x; x = rx; y = ry; } // 90° rotation, bbox -> [0,h]x[0,w]
        return { x: x + pl.x, y: y + pl.y };
      };
      entities += polylineEntity(panel.outline.map(transform), 'CUT');

      for (const c of panel.cutouts || []) {
        const poly = PanelGeo.buildCutout(c);
        const layer = (c.layer || 'cut').toUpperCase() === 'SCORE' ? 'SCORE' : 'CUT';
        entities += polylineEntity(poly.map(transform), layer, c.closed !== false);
      }

      if (opts.showLabels) {
        const asm = panel.assemblyId && panel.assemblyId !== 'body' ? ` [${panel.assemblyId}]` : '';
        const t = transform({ x: ob.minX + 2, y: ob.minY + 2 });
        entities += textEntity(t.x, t.y, 3, panel.name + asm + (panel.partNumber ? ' #' + panel.partNumber : ''), 'LABEL', pl.rotated ? 90 : 0);
      }

      for (const e of panel.engravings || []) {
        if (e.type === 'text') {
          const t = transform({ x: e.x, y: e.y });
          entities += textEntity(t.x, t.y, e.size || 4, e.text, 'ENGRAVE');
        } else if (e.type === 'artworkFill') {
          // Closed polylines on the ENGRAVE layer — the operator's laser
          // software assigns the actual fill/raster operation to this
          // layer; our job is correct geometry + correct layer/colour.
          entities += polylineEntity(e.points.map(transform), 'ENGRAVE', e.closed !== false);
        }
      }
    }

    // Copyright watermark: bottom-left corner of the sheet, on its own layer.
    const wm = opts.watermark !== false;
    if (wm) entities += textEntity(Math.min(4, (opts.sheet && opts.sheet.margin) || 4), 1.5, 2.5, Branding.noticeAscii(), 'WATERMARK');

    const layerDef = (name) => {
      const c = LAYER_COLORS[name];
      return `0\nLAYER\n2\n${name}\n70\n0\n62\n${c.aci}\n6\nCONTINUOUS\n420\n${c.rgb}\n`;
    };

    return (
      (wm ? '999\n' + Branding.noticeAscii() + '\n' : '') + // DXF comment (group 999)
      '0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n' + // 4 = millimeters
      '0\nSECTION\n2\nTABLES\n' +
      '0\nTABLE\n2\nLAYER\n70\n5\n' +
      layerDef('CUT') + layerDef('ENGRAVE') + layerDef('SCORE') + layerDef('LABEL') + layerDef('WATERMARK') +
      '0\nENDTAB\n0\nENDSEC\n' +
      '0\nSECTION\n2\nENTITIES\n' +
      entities +
      '0\nENDSEC\n0\nEOF\n'
    );
  }

  const DxfExporter = { exportSheetDxf, LAYER_COLORS };

  if (typeof module !== 'undefined' && module.exports) module.exports = DxfExporter;
  else root.DxfExporter = DxfExporter;
})(typeof window !== 'undefined' ? window : globalThis);
