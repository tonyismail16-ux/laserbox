/**
 * branding.js — single source of truth for the copyright / watermark notice.
 *
 * The year is computed from the clock every time a notice is built, so the
 * on-screen footer and every export automatically roll over on 1 January.
 * (Floored at START_YEAR so a wrong system clock can never print an earlier year.)
 */
(function (root) {
  'use strict';

  const OWNER = 'Bali Craft Design';
  const PRODUCT = 'Laser Box';
  const START_YEAR = 2026;

  function year(date) {
    const y = (date || new Date()).getFullYear();
    return Math.max(START_YEAR, y);
  }

  /** "© 2026 Bali Craft Design. Laser Box - All rights reserved." */
  function notice(date) {
    return `\u00A9 ${year(date)} ${OWNER}. ${PRODUCT} - All rights reserved.`;
  }

  /** Same text, pure ASCII (for DXF R12, which has no reliable Unicode support). */
  function noticeAscii(date) {
    return `(c) ${year(date)} ${OWNER}. ${PRODUCT} - All rights reserved.`;
  }

  const Branding = { OWNER, PRODUCT, START_YEAR, year, notice, noticeAscii };

  if (typeof module !== 'undefined' && module.exports) module.exports = Branding;
  else root.Branding = Branding;
})(typeof window !== 'undefined' ? window : globalThis);
