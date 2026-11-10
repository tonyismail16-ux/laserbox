/**
 * kerfTest.js — generates a small calibration pattern: a row of slots and a
 * matching row of tabs, each pair cut assuming a different kerf value. The
 * user cuts the pattern once, tries fitting each tab into each same-column
 * slot, and reads off the label of the pair that fits best (snug, not
 * loose, not forced) to find their machine's real-world kerf for a given
 * material/power/speed combination.
 */
(function (root) {
  'use strict';

  const SvgExporter = root.SvgExporter;
  const Branding = (typeof module !== 'undefined' && module.exports) ? require('../branding.js') : root.Branding;
  const Kerf = root.Kerf;

  /**
   * @param {object} opts { thickness, testWidth, kerfMin, kerfMax, steps }
   */
  function generate(opts) {
    opts = opts || {};
    const thickness = opts.thickness || 3;
    const testWidth = opts.testWidth || 15; // nominal tab/slot width
    const kerfMin = opts.kerfMin !== undefined ? opts.kerfMin : 0.05;
    const kerfMax = opts.kerfMax !== undefined ? opts.kerfMax : 0.35;
    const steps = opts.steps || 7;
    const gap = 6;
    const tabH = thickness + 6;

    let body = '';
    let x = 0;
    const labels = [];
    for (let i = 0; i < steps; i++) {
      const k = kerfMin + ((kerfMax - kerfMin) * i) / (steps - 1);
      const half = k / 2;

      // Slot coupon: a plate with a rectangular hole of width (testWidth - k)
      const plateW = testWidth + gap * 2;
      const plateH = tabH + gap * 2;
      const slotW = testWidth - k;
      const slotOutline = [
        { x: 0, y: 0 }, { x: plateW, y: 0 }, { x: plateW, y: plateH }, { x: 0, y: plateH },
      ];
      const holeX = plateW / 2 - slotW / 2, holeY = plateH / 2 - tabH / 2;
      const hole = [
        { x: holeX, y: holeY }, { x: holeX + slotW, y: holeY },
        { x: holeX + slotW, y: holeY + tabH }, { x: holeX, y: holeY + tabH },
      ];
      body += `<g transform="translate(${x} 0)">` +
        `<path fill="none" stroke="#ff3b30" stroke-width="0.15" d="${SvgExporter.pointsToPathD(slotOutline)}" />` +
        `<path fill="none" stroke="#ff3b30" stroke-width="0.15" d="${SvgExporter.pointsToPathD(hole)}" />` +
        `<text x="${plateW / 2}" y="${plateH + 4}" font-size="3" text-anchor="middle" fill="#ccc">${k.toFixed(2)}mm</text>` +
        `</g>`;
      x += plateW + 4;
      labels.push(k.toFixed(2));
    }

    const row2Y = tabH + gap * 2 + 14;
    let x2 = 0;
    for (let i = 0; i < steps; i++) {
      const k = kerfMin + ((kerfMax - kerfMin) * i) / (steps - 1);
      const plateW = testWidth + gap * 2;
      const tabW = testWidth + k;
      const tabOutline = [
        { x: 0, y: 0 }, { x: tabW, y: 0 }, { x: tabW, y: tabH }, { x: 0, y: tabH },
      ];
      const tx = plateW / 2 - tabW / 2;
      body += `<g transform="translate(${x2 + tx} ${row2Y})">` +
        `<path fill="none" stroke="#0a7bff" stroke-width="0.15" d="${SvgExporter.pointsToPathD(tabOutline)}" />` +
        `</g>` +
        `<text x="${x2 + plateW / 2}" y="${row2Y + tabH + 4}" font-size="3" text-anchor="middle" fill="#ccc">${k.toFixed(2)}mm</text>`;
      x2 += plateW + 4;
    }

    const totalW = x;
    const totalH = row2Y + tabH + 10;
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}mm" height="${totalH}mm" viewBox="0 0 ${totalW} ${totalH}">\n` +
      `<!-- Kerf calibration: cut once. Try fitting each blue tab into the red slot of the SAME kerf label.\n` +
      `     The pair that fits snugly (not loose, not forced) is close to your machine's real kerf for this material/power/speed. -->\n` +
      `<!-- ${Branding.notice()} -->\n` +
      `<metadata><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"><rdf:Description><dc:rights>${Branding.notice()}</dc:rights><dc:creator>${Branding.OWNER}</dc:creator></rdf:Description></rdf:RDF></metadata>\n` +
      `<rect x="0" y="0" width="${totalW}" height="${totalH}" fill="#0e0f13" />` +
      body +
      `<g id="WATERMARK" class="layer-watermark" fill="#999999"><text x="4" y="${totalH - 2}" font-size="2.5" font-family="sans-serif">${Branding.notice()}</text></g>` +
      `</svg>\n`;

    return { svg, labels, testWidth, thickness };
  }

  const KerfTest = { generate };

  if (typeof module !== 'undefined' && module.exports) module.exports = KerfTest;
  else root.KerfTest = KerfTest;
})(typeof window !== 'undefined' ? window : globalThis);
