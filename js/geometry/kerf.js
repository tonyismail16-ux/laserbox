/**
 * kerf.js — kerf compensation logic.
 *
 * Physical fact about laser cutting: the beam removes a strip of material of
 * width `kerf`, centered on the programmed cut path. This means, with ZERO
 * compensation:
 *   - protrusions (tabs) come out narrower than drawn, by `kerf` total
 *   - recesses (slots/gaps) come out wider than drawn, by `kerf` total
 *
 * If both mating parts are cut on the same machine with the same kerf, the
 * natural result is a joint that is `2 * kerf` looser than the nominal
 * design — usually too sloppy for a finger-jointed box.
 *
 * To counteract this, we pre-compensate the DESIGN geometry in the opposite
 * direction: we widen tabs and narrow gaps by `kerf` before cutting, so that
 * after the laser removes its kerf, the finished parts come out at the
 * nominal dimensions (a snug press fit). This is the standard approach used
 * by production laser box generators.
 *
 * Because a tab and its neighboring gap share a single cut line, widening a
 * tab automatically narrows the adjacent gap by the same amount — so we only
 * ever move the shared internal boundary, never both sides independently.
 */
(function (root) {
  'use strict';

  /**
   * Shift every INTERNAL boundary (not the first 0 or the final length) by
   * kerf/2 toward whichever side is a GAP, i.e. away from the TAB. The very
   * first and last boundaries of the edge are left untouched here — those
   * coincide with the panel's outer silhouette / corners and are handled by
   * `compensateOutline` instead, so we don't double-compensate the corner.
   *
   * @param {Array} segments  output of FingerJoint.segmentEdge(...).segments
   * @param {number} kerf
   * @returns {Array} new segments array with adjusted start/end/width
   */
  function compensateSegments(segments, kerf) {
    if (!kerf || segments.length < 2) return segments.map(s => Object.assign({}, s));
    const half = kerf / 2;
    const out = segments.map(s => Object.assign({}, s));
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i], b = out[i + 1];
      // Shared boundary between segment a and b. Move it toward the GAP side.
      let shift = 0;
      if (a.state === 'tab' && b.state === 'gap') shift = +half;
      else if (a.state === 'gap' && b.state === 'tab') shift = -half;
      // tab/tab or gap/gap shouldn't occur (states alternate) — no shift.
      a.end += shift;
      b.start += shift;
    }
    for (const s of out) {
      s.width = s.end - s.start;
      if (s.width < 0) s.width = 0; // clamped; validator will flag this upstream
    }
    return out;
  }

  /**
   * Resolve a global outline compensation offset (mm) to apply to
   * non-jointed (flat) edges of a panel, so its overall silhouette comes out
   * at the correct finished size once the laser's kerf is removed.
   *
   * mode:
   *  'none'     -> 0 (cut exactly on the nominal line)
   *  'outside'  -> +kerf/2  (grow the path outward; laser eats inward to hit nominal)
   *  'inside'   -> -kerf/2  (shrink the path inward; laser eats outward to hit nominal)
   *  'auto'     -> same as 'outside' for outer silhouette edges (most common default
   *                for a part that must fit *around* something / hold its outer size)
   *  number     -> used directly as a manual offset in mm
   */
  function resolveOutlineOffset(mode, kerf) {
    if (typeof mode === 'number') return mode;
    switch (mode) {
      case 'inside': return -kerf / 2;
      case 'outside': return kerf / 2;
      case 'auto': return kerf / 2;
      case 'none':
      default: return 0;
    }
  }

  const Kerf = { compensateSegments, resolveOutlineOffset };

  if (typeof module !== 'undefined' && module.exports) module.exports = Kerf;
  else root.Kerf = Kerf;
})(typeof window !== 'undefined' ? window : globalThis);
