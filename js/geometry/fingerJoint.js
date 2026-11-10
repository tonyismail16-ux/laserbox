/**
 * fingerJoint.js — pure math for finger-joint segmentation along a single edge.
 *
 * An edge of length L is divided into a sequence of alternating segments:
 *   TAB  = material present (this part of the edge sits at the edge's nominal line)
 *   GAP  = material absent  (this part is recessed INTO the panel by `thickness`,
 *          forming a slot that receives the mating panel's tab)
 *
 * Two panels that share a physical edge must use COMPLEMENTARY phase (one
 * starts with TAB, the other starts with GAP) so that wherever one panel has
 * material, the other has a slot — this is what makes the joint interlock.
 *
 * No DOM / no dependencies — safe to unit test under Node.
 */
(function (root) {
  'use strict';

  const TAB = 'tab';
  const GAP = 'gap';

  /**
   * @param {number} length     edge length (mm)
   * @param {object} opts
   *   mode: 'count' | 'width' | 'manual'
   *   count: number            (mode='count') total number of segments (tabs+gaps)
   *   width: number            (mode='width') desired segment width; count is derived
   *   phase: 0|1               which state the first segment takes (0=TAB, 1=GAP)
   *   manualBoundaries: number[]   (mode='manual') strictly increasing, 0..length
   *   manualStates: ('tab'|'gap')[] (mode='manual') one per resulting segment
   *   minFingerWidth, maxFingerWidth: number (mm) — for validation only
   * @returns {{segments: {start:number end:number state:string width:number}[],
   *            width: number, count: number, warnings: string[]}}
   */
  function segmentEdge(length, opts) {
    opts = opts || {};
    const mode = opts.mode || 'count';
    const phase = opts.phase ? 1 : 0;
    const warnings = [];
    let boundaries, states;

    if (mode === 'manual' && opts.manualBoundaries && opts.manualBoundaries.length >= 2) {
      boundaries = opts.manualBoundaries.slice().sort((a, b) => a - b);
      if (Math.abs(boundaries[0]) > 1e-6) boundaries.unshift(0);
      if (Math.abs(boundaries[boundaries.length - 1] - length) > 1e-6) boundaries.push(length);
      states = opts.manualStates && opts.manualStates.length === boundaries.length - 1
        ? opts.manualStates.slice()
        : boundaries.slice(1).map((_, i) => (i + phase) % 2 === 0 ? TAB : GAP);
    } else {
      let count;
      if (mode === 'width') {
        const w = Math.max(opts.width || 10, 0.1);
        count = Math.max(1, Math.round(length / w));
      } else {
        count = Math.max(1, Math.round(opts.count || 5));
      }
      const segW = length / count;
      boundaries = [];
      for (let i = 0; i <= count; i++) boundaries.push(i * segW);
      states = [];
      for (let i = 0; i < count; i++) states.push((i + phase) % 2 === 0 ? TAB : GAP);
    }

    const segments = [];
    for (let i = 0; i < states.length; i++) {
      const start = boundaries[i];
      const end = boundaries[i + 1];
      segments.push({ start, end, width: end - start, state: states[i] });
    }

    // Validation
    const widths = segments.map(s => s.width);
    const minW = Math.min(...widths);
    if (opts.minFingerWidth && minW < opts.minFingerWidth - 1e-6) {
      warnings.push(`Finger width ${minW.toFixed(2)}mm is below the recommended minimum of ${opts.minFingerWidth}mm.`);
    }
    if (opts.maxFingerWidth && Math.max(...widths) > opts.maxFingerWidth + 1e-6) {
      warnings.push(`Finger width ${Math.max(...widths).toFixed(2)}mm exceeds the configured maximum of ${opts.maxFingerWidth}mm.`);
    }
    if (opts.kerf && minW <= opts.kerf) {
      warnings.push(`Kerf (${opts.kerf}mm) is larger than or equal to the smallest finger (${minW.toFixed(2)}mm) — this segment will vanish or invert.`);
    }

    return { segments, width: widths[0], count: segments.length, warnings };
  }

  /** Returns the phase (0|1) that should be used on the mating edge so it interlocks. */
  function matingPhase(phase) {
    return phase ? 0 : 1;
  }

  const FingerJoint = { TAB, GAP, segmentEdge, matingPhase };

  if (typeof module !== 'undefined' && module.exports) module.exports = FingerJoint;
  else root.FingerJoint = FingerJoint;
})(typeof window !== 'undefined' ? window : globalThis);
