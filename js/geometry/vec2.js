/**
 * vec2.js — minimal 2D vector + path helpers.
 * Pure math, no DOM. Runs identically in-browser or under Node (for tests).
 */
(function (root) {
  'use strict';

  const EPS = 1e-6;

  function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
  function scale(a, s) { return { x: a.x * s, y: a.y * s }; }
  function len(a) { return Math.sqrt(a.x * a.x + a.y * a.y); }
  function dist(a, b) { return len(sub(a, b)); }
  function eq(a, b, eps) { eps = eps === undefined ? EPS : eps; return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps; }

  /** Rotate a point by degrees around the origin. */
  function rotate(p, deg) {
    const r = (deg * Math.PI) / 180;
    const c = Math.cos(r), s = Math.sin(r);
    return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
  }

  /** Round a number to a fixed number of decimal places, avoiding -0. */
  function round(n, decimals) {
    decimals = decimals === undefined ? 4 : decimals;
    const f = Math.pow(10, decimals);
    const r = Math.round(n * f) / f;
    return Object.is(r, -0) ? 0 : r;
  }

  /**
   * Remove consecutive duplicate points from a polyline (within eps),
   * which otherwise produce zero-length SVG segments.
   */
  function dedupe(points, eps) {
    eps = eps === undefined ? EPS : eps;
    const out = [];
    for (const p of points) {
      if (out.length === 0 || !eq(out[out.length - 1], p, eps)) out.push(p);
    }
    return out;
  }

  /** Signed area of a closed polygon (shoelace formula). Positive = CCW. */
  function signedArea(points) {
    let a = 0;
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];
      a += p1.x * p2.y - p2.x * p1.y;
    }
    return a / 2;
  }

  /** Total perimeter length of a closed polyline. */
  function perimeter(points) {
    let total = 0;
    for (let i = 0; i < points.length; i++) {
      total += dist(points[i], points[(i + 1) % points.length]);
    }
    return total;
  }

  /** Axis-aligned bounding box of a set of points. */
  function bounds(points) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }

  const Vec2 = { add, sub, scale, len, dist, eq, rotate, round, dedupe, signedArea, perimeter, bounds, EPS };

  if (typeof module !== 'undefined' && module.exports) module.exports = Vec2;
  else root.Vec2 = Vec2;
})(typeof window !== 'undefined' ? window : globalThis);
