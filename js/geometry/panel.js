/**
 * panel.js — builds the closed outline polyline for a single rectangular
 * panel from its 4 edge definitions (each either 'flat' or 'finger'), plus
 * any cutouts. Local coordinate system: origin at bottom-left corner,
 * +x to the right, +y upward. This SAME geometry is later fed to the 2D
 * preview, the 3D preview, and the SVG/DXF exporters — there is only one
 * source of truth for the shape.
 */
(function (root) {
  'use strict';

  const V = (typeof module !== 'undefined' && module.exports) ? require('./vec2.js') : root.Vec2;

  // Orientation for each of the 4 sides of a rectangle, local coords, y-up.
  // dir = direction of travel along the edge; inward = unit vector pointing
  // into the panel body (the direction a "gap"/slot recesses toward).
  function edgeFrame(side, W, H) {
    switch (side) {
      case 'bottom': return { start: { x: 0, y: 0 }, end: { x: W, y: 0 }, dir: { x: 1, y: 0 }, inward: { x: 0, y: 1 }, horizontal: true, length: W };
      case 'right': return { start: { x: W, y: 0 }, end: { x: W, y: H }, dir: { x: 0, y: 1 }, inward: { x: -1, y: 0 }, horizontal: false, length: H };
      case 'top': return { start: { x: W, y: H }, end: { x: 0, y: H }, dir: { x: -1, y: 0 }, inward: { x: 0, y: -1 }, horizontal: true, length: W };
      case 'left': return { start: { x: 0, y: H }, end: { x: 0, y: 0 }, dir: { x: 0, y: -1 }, inward: { x: 1, y: 0 }, horizontal: false, length: H };
    }
  }

  const SIDES = ['bottom', 'right', 'top', 'left'];

  /**
   * Build the point list for a single edge, local to the panel.
   * edgeDef:
   *   { type: 'flat', outlineOffset: number }
   *   { type: 'finger', segments: [{start,end,state}], thickness: number }
   */
  function buildEdgePoints(side, W, H, edgeDef) {
    const f = edgeFrame(side, W, H);
    const pt = (alongPos, depth) => ({
      x: f.start.x + f.dir.x * alongPos + f.inward.x * depth,
      y: f.start.y + f.dir.y * alongPos + f.inward.y * depth,
    });

    if (!edgeDef || edgeDef.type === 'flat') {
      const offset = (edgeDef && edgeDef.outlineOffset) || 0; // + grows outward
      const depth = -offset; // outward = -inward direction
      return [pt(0, depth), pt(f.length, depth)];
    }

    if (edgeDef.type === 'custom') {
      // edgeDef.points: [{along, depth}], already in this edge's own 1D
      // (along-edge, perpendicular-depth) convention — used by non-rectangular
      // edge profiles such as interlocking node/knuckle hinges.
      return V.dedupe(edgeDef.points.map(p => pt(p.along, p.depth)));
    }

    // finger edge
    const pts = [];
    for (const seg of edgeDef.segments) {
      const depth = seg.state === 'gap' ? edgeDef.thickness : 0;
      pts.push(pt(seg.start, depth));
      pts.push(pt(seg.end, depth));
    }
    return V.dedupe(pts);
  }

  /** Insert a right-angle connector point between two edges if their endpoints don't coincide. */
  function bridge(prevPoint, prevHorizontal, nextPoint) {
    if (V.eq(prevPoint, nextPoint, 1e-4)) return null;
    return prevHorizontal
      ? { x: nextPoint.x, y: prevPoint.y }
      : { x: prevPoint.x, y: nextPoint.y };
  }

  /**
   * @param {number} W panel nominal width
   * @param {number} H panel nominal height
   * @param {object} edges { bottom, right, top, left } edge definitions
   * @returns {Array<{x,y}>} closed outline polyline (local panel coords)
   */
  function buildOutline(W, H, edges) {
    let points = [];
    let prevFrame = null;
    for (let i = 0; i < SIDES.length; i++) {
      const side = SIDES[i];
      const frame = edgeFrame(side, W, H);
      const edgePts = buildEdgePoints(side, W, H, edges[side]);
      if (points.length > 0) {
        const b = bridge(points[points.length - 1], prevFrame.horizontal, edgePts[0]);
        if (b) points.push(b);
      }
      points = points.concat(edgePts);
      prevFrame = frame;
    }
    // close the loop back to the very first point
    const first = points[0];
    const last = points[points.length - 1];
    const b = bridge(last, prevFrame.horizontal, first);
    if (b) points.push(b);
    points = V.dedupe(points);
    // drop a final point identical to the first (closed path implied)
    if (points.length > 1 && V.eq(points[0], points[points.length - 1], 1e-4)) points.pop();
    return points;
  }

  /** Polygon approximation of a circle, `segments` sides, centered at (cx,cy). */
  function circlePoints(cx, cy, r, segments) {
    segments = segments || 48;
    const pts = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  function rectPoints(cx, cy, w, h) {
    return [
      { x: cx - w / 2, y: cy - h / 2 },
      { x: cx + w / 2, y: cy - h / 2 },
      { x: cx + w / 2, y: cy + h / 2 },
      { x: cx - w / 2, y: cy + h / 2 },
    ];
  }

  /** Rounded slot: rectangle of length `len` (x-axis before rotation) capped with semicircles of radius `r` = h/2. */
  function slotPoints(cx, cy, len, width, segments) {
    segments = segments || 24;
    const r = width / 2;
    const half = Math.max(len / 2 - r, 0);
    const pts = [];
    // right semicircle
    for (let i = 0; i <= segments / 2; i++) {
      const a = -Math.PI / 2 + (i / (segments / 2)) * Math.PI;
      pts.push({ x: cx + half + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    // left semicircle
    for (let i = 0; i <= segments / 2; i++) {
      const a = Math.PI / 2 + (i / (segments / 2)) * Math.PI;
      pts.push({ x: cx - half + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  function rotatePointsAround(points, cx, cy, deg) {
    return points.map(p => {
      const r = V.rotate({ x: p.x - cx, y: p.y - cy }, deg);
      return { x: r.x + cx, y: r.y + cy };
    });
  }

  /** Build a cutout's polygon (local panel coords) from its definition. */
  function buildCutout(cutout) {
    let pts;
    switch (cutout.type) {
      case 'circle': pts = circlePoints(cutout.x, cutout.y, cutout.r, 48); break;
      case 'rect': pts = rectPoints(cutout.x, cutout.y, cutout.w, cutout.h); break;
      case 'slot': pts = slotPoints(cutout.x, cutout.y, cutout.length, cutout.width); break;
      case 'path': pts = (cutout.points || []).map(p => ({ x: p.x + cutout.x, y: p.y + cutout.y })); break;
      default: pts = rectPoints(cutout.x || 0, cutout.y || 0, cutout.w || 10, cutout.h || 10);
    }
    if (cutout.rotation) pts = rotatePointsAround(pts, cutout.x, cutout.y, cutout.rotation);
    return pts;
  }

  const Panel = { edgeFrame, buildEdgePoints, buildOutline, buildCutout, circlePoints, rectPoints, slotPoints, SIDES };

  if (typeof module !== 'undefined' && module.exports) module.exports = Panel;
  else root.Panel = Panel;
})(typeof window !== 'undefined' ? window : globalThis);
