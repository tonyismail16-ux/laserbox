/**
 * preview2d.js — renders the SAME panel.outline / cutouts / engravings data
 * used for export into an on-screen <svg>, with pan/zoom and a light grid.
 * Browser-only (uses the DOM).
 */
(function (root) {
  'use strict';

  const SvgExporter = root.SvgExporter;
  const Vec2 = root.Vec2;

  function makeViewer(svgEl) {
    let viewBox = { x: -20, y: -20, w: 400, h: 300 };
    let dragging = false, lastX = 0, lastY = 0;

    function applyViewBox() {
      svgEl.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
    }

    function fitTo(bounds, padding) {
      padding = padding === undefined ? 20 : padding;
      const w = Math.max(bounds.width, 1) + padding * 2;
      const h = Math.max(bounds.height, 1) + padding * 2;
      // preserve the svg's aspect ratio so content isn't stretched
      const rect = svgEl.getBoundingClientRect();
      const aspect = rect.width && rect.height ? rect.width / rect.height : w / h;
      let vw = w, vh = h;
      if (vw / vh < aspect) vw = vh * aspect; else vh = vw / aspect;
      viewBox = { x: bounds.minX - (vw - bounds.width) / 2, y: bounds.minY - (vh - bounds.height) / 2, w: vw, h: vh };
      applyViewBox();
    }

    svgEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      const scale = e.deltaY > 0 ? 1.1 : 0.9;
      const rect = svgEl.getBoundingClientRect();
      const mx = viewBox.x + ((e.clientX - rect.left) / rect.width) * viewBox.w;
      const my = viewBox.y + ((e.clientY - rect.top) / rect.height) * viewBox.h;
      viewBox.x = mx - (mx - viewBox.x) * scale;
      viewBox.y = my - (my - viewBox.y) * scale;
      viewBox.w *= scale; viewBox.h *= scale;
      applyViewBox();
    }, { passive: false });

    svgEl.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; svgEl.setPointerCapture(e.pointerId); });
    svgEl.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const rect = svgEl.getBoundingClientRect();
      const dx = (e.clientX - lastX) * (viewBox.w / rect.width);
      const dy = (e.clientY - lastY) * (viewBox.h / rect.height);
      viewBox.x -= dx; viewBox.y -= dy;
      lastX = e.clientX; lastY = e.clientY;
      applyViewBox();
    });
    svgEl.addEventListener('pointerup', () => { dragging = false; });
    svgEl.addEventListener('pointerleave', () => { dragging = false; });

    applyViewBox();
    return { fitTo, applyViewBox, get viewBox() { return viewBox; }, zoomBy(f) { viewBox.w *= f; viewBox.h *= f; applyViewBox(); } };
  }

  function gridBackground(bounds, spacing) {
    spacing = spacing || 10;
    const x0 = Math.floor(bounds.minX / spacing) * spacing;
    const y0 = Math.floor(bounds.minY / spacing) * spacing;
    let lines = '';
    for (let x = x0; x <= bounds.maxX; x += spacing) {
      const major = Math.round(x / spacing) % 5 === 0;
      lines += `<line x1="${x}" y1="${bounds.minY}" x2="${x}" y2="${bounds.maxY}" class="${major ? 'gm' : 'gn'}" stroke-width="${major ? 0.4 : 0.2}" />`;
    }
    for (let y = y0; y <= bounds.maxY; y += spacing) {
      const major = Math.round(y / spacing) % 5 === 0;
      lines += `<line x1="${bounds.minX}" y1="${y}" x2="${bounds.maxX}" y2="${y}" class="${major ? 'gm' : 'gn'}" stroke-width="${major ? 0.4 : 0.2}" />`;
    }
    return `<g class="grid" style="pointer-events:none">${lines}</g>`;
  }

  /** Render all panels in a simple non-nested grid, for quick per-panel inspection. */
  function renderPanelsGrid(svgEl, panels, opts) {
    opts = opts || {};
    const gap = opts.gap || 15;
    let cursorX = 0, maxRowH = 0;
    const maxWidth = opts.wrapWidth || 900;
    let body = '';
    let allBounds = null;
    const positions = [];
    let rowY = 0;
    for (const panel of panels) {
      const b = Vec2.bounds(panel.outline);
      if (cursorX + b.width > maxWidth && cursorX > 0) { rowY += maxRowH + gap; cursorX = 0; maxRowH = 0; }
      positions.push({ panel, x: cursorX - b.minX, y: rowY - b.minY });
      cursorX += b.width + gap;
      maxRowH = Math.max(maxRowH, b.height);
    }

    for (const { panel, x, y } of positions) {
      body += SvgExporter.panelToSvgGroup(panel, { x, y, colors: opts.colors, strict: false, showLabel: opts.showLabels !== false, interactive: true });
      const local = Vec2.bounds(panel.outline);
      const b2 = { minX: x + local.minX, minY: y + local.minY, maxX: x + local.maxX, maxY: y + local.maxY };
      allBounds = allBounds ? {
        minX: Math.min(allBounds.minX, b2.minX), minY: Math.min(allBounds.minY, b2.minY),
        maxX: Math.max(allBounds.maxX, b2.maxX), maxY: Math.max(allBounds.maxY, b2.maxY),
      } : b2;
    }
    if (allBounds) { allBounds.width = allBounds.maxX - allBounds.minX; allBounds.height = allBounds.maxY - allBounds.minY; }
    else allBounds = { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100 };

    const grid = opts.showGrid ? gridBackground({ minX: allBounds.minX - 30, minY: allBounds.minY - 30, maxX: allBounds.maxX + 30, maxY: allBounds.maxY + 30 }) : '';
    svgEl.innerHTML = grid + body;
    return allBounds;
  }

  /** Render one sheet's nested layout (from SheetLayout.pack output). */
  function renderSheetLayout(svgEl, panels, placements, sheet, opts) {
    opts = opts || {};
    const grid = opts.showGrid ? gridBackground({ minX: 0, minY: 0, maxX: sheet.width, maxY: sheet.height }, opts.gridSpacing || 20) : '';
    const border = `<rect x="0" y="0" width="${sheet.width}" height="${sheet.height}" fill="none" stroke="#5a6270" stroke-width="1" />`;
    // dashed outline of the usable area (sheet minus margin) the nester fills
    const m = sheet.margin || 0;
    const usable = m > 0 ? `<rect x="${m}" y="${m}" width="${sheet.width - 2 * m}" height="${sheet.height - 2 * m}" fill="none" stroke="#5a6270" stroke-width="0.4" stroke-dasharray="4 3" style="pointer-events:none" />` : '';
    const byId = {};
    for (const p of panels) byId[p.id] = p;
    let body = '';
    for (const pl of placements) {
      const panel = byId[pl.id];
      if (!panel) continue;
      body += SvgExporter.panelToSvgGroup(panel, { x: pl.x, y: pl.y, rotated: pl.rotated, colors: opts.colors, strict: false, showLabel: opts.showLabels !== false, interactive: true, fitBounds: true });
    }
    svgEl.innerHTML = grid + border + usable + body;
    return { minX: 0, minY: 0, maxX: sheet.width, maxY: sheet.height, width: sheet.width, height: sheet.height };
  }

  const Preview2D = { makeViewer, renderPanelsGrid, renderSheetLayout, gridBackground };

  if (typeof module !== 'undefined' && module.exports) module.exports = Preview2D;
  else root.Preview2D = Preview2D;
})(typeof window !== 'undefined' ? window : globalThis);
