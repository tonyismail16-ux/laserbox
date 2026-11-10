/**
 * liftOffLidBox.js — detached (lift-off) lids. NOT a sliding lid (no grooves,
 * runners or rails) and NOT hinged. The lid is its own assembly (`lid`) that
 * is cut, exported and nested independently of the box body.
 *
 * ── Style 'flat' ──────────────────────────────────────────────────────────
 *   lid-top   (L + 2·overhang) × (W + 2·overhang), rests on the body rim.
 *   lid-plug  optional locating plate glued under the lid. It drops INTO the
 *             body opening:
 *                 plug = (L − 2·tb − 2·clearance) × (W − 2·tb − 2·clearance)
 *             so the lid cannot slide off. `clearance` is per side.
 *
 * ── Style 'cap' ───────────────────────────────────────────────────────────
 *   The lid has a top plate and four skirt walls that go AROUND the outside
 *   of the body.
 *      cap inner  = body external + 2·clearance           (per side gap)
 *      cap outer  = cap inner + 2·lidThickness
 *      cap height = skirtDepth + lidThickness
 *   The top plate rests on the body rim; the skirt hangs `skirtDepth` down
 *   the body's outer walls. Plywood caps use the app's finger joints (the
 *   same 5-panel generator as an open-top box, flipped upside-down); a
 *   transparent (acrylic) lid is butt-jointed instead.
 *
 * ── Style 'inset' (reversed: larger base, SMALLER lid) ────────────────────
 *   The base is the larger part. The lid is a smaller open-box cover (top +
 *   4 walls, flat top) that sits INSIDE the base's opening, like an acrylic
 *   cover set into a wooden box:
 *      lid outer  = base internal size − 2·clearance          (per side gap)
 *      lid height = liftLidInsetDepth (below the rim) + liftLidRise (above it)
 *   `liftLidRise` 0 makes the lid top flush with the rim. Transparent material
 *   is butt-jointed; plywood uses finger joints.
 *
 * Fit values are starting points. Real fit depends on the machine kerf,
 * material tolerance and assembly preference, so every value is configurable.
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const BoxGenerator = isNode ? require('./boxGenerator.js') : root.BoxGenerator;
  const Kerf = isNode ? require('./kerf.js') : root.Kerf;
  const Assembly = isNode ? require('./assembly.js') : root.Assembly;
  const DisplayCover = isNode ? require('./displayCover.js') : root.DisplayCover;

  const STYLES = ['none', 'flat', 'cap', 'inset', 'acrylicCover'];

  function lidDefaults() {
    return {
      liftLidStyle: 'none',        // 'none' | 'flat' | 'cap' | 'inset' | 'acrylicCover'
      liftLidClearance: 0.3,       // mm per side — cap gap / plug gap
      liftLidOverhang: 0,          // mm per side — flat lid overhang beyond the body
      liftLidSkirtDepth: 15,       // mm — cap skirt depth
      liftLidInsetDepth: 15,       // mm — inset lid: how far it goes DOWN into the base
      liftLidRise: 20,             // mm — inset lid: how far it stands ABOVE the base rim
      liftLidSkirtOffset: 0,       // mm ± — added to the skirt depth; total < 0 = inner collar
      liftLidLocator: 'plug',      // flat lid: 'plug' | 'none'
      liftLidJoint: 'auto',        // cap joint: 'auto' (butt if transparent, else finger) | 'finger' | 'butt'
      liftLidEngraveText: '',      // optional engraved text on the lid top
      liftLidEngraveSize: 8,       // mm text height
      lidThickness: null,          // null = inherit body thickness
      lidMaterialId: null, lidMaterialName: null, lidMaterialColor: null, lidKerf: null,
    };
  }

  /**
   * Fit gap actually left between the cut lid and the base, per side, after the
   * laser has removed its kerf. The drawn outline is moved by `off` (outline
   * compensation) and the beam then eats kerf/2 inward, so the cut part ends up
   * `off - kerf/2` larger than nominal per side. With 'auto' (off = kerf/2) the part
   * is cut at nominal size and the gap equals the clearance. For an OUTER cap the
   * part is larger than the body, so the sign flips (a bigger part = a tighter fit).
   */
  function netGap(clearance, kerf, off, inside) {
    const growth = off - kerf / 2;           // cut size minus nominal, per side
    return inside ? clearance - growth : clearance + growth;
  }

  function checkNumber(errors, v, label, min, max, unit) {
    if (!(typeof v === 'number' && isFinite(v) && v >= min && v <= max)) {
      errors.push({ code: 'lid-param', message: `${label} must be between ${min} and ${max}${unit || 'mm'} (got ${v}).` });
      return false;
    }
    return true;
  }

  /** mm of interior headroom taken by a plug under a flat lid (so dividers can avoid it). */
  function plugBlock(p, material) {
    if (p.liftLidStyle === 'flat' && p.liftLidLocator === 'plug') return material.thickness;
    return 0;
  }

  function engraveLid(panel, p, w, d) {
    const txt = (p.liftLidEngraveText || '').trim();
    if (!txt) return;
    panel.engravings.push({ type: 'text', x: w / 2, y: d / 2, size: p.liftLidEngraveSize || 8, anchor: 'middle', text: txt, layer: 'engrave' });
  }

  /**
   * Flat lift-off lid. Used for liftLidStyle 'flat' and (with the cover
   * material and assembly 'cover') for an acrylic top without sidewalls.
   * @param {object} ctx { L, W, H, tb, bo, outlineMode, material, assemblyId, idPrefix, nameBase }
   */
  function buildFlatLid(p, ctx) {
    const errors = [], warnings = [];
    const mat = ctx.material, lt = mat.thickness;
    const bo = ctx.bo || [0, 0, 0];
    const oh = p.liftLidOverhang, c = p.liftLidClearance;
    const assemblyId = ctx.assemblyId || 'lid', idPrefix = ctx.idPrefix || 'lid';
    const nameBase = ctx.nameBase || 'Lid';

    if (!(lt > 0) || !isFinite(lt)) errors.push({ code: 'lid-thickness', message: `Lid material thickness must be positive (got ${lt}).` });
    checkNumber(errors, oh, 'Lid overhang', 0, 50);
    checkNumber(errors, c, 'Lid clearance', 0, 3);
    if (p.liftLidLocator !== 'plug' && p.liftLidLocator !== 'none') errors.push({ code: 'lid-locator', message: `Unknown lid locator "${p.liftLidLocator}" (use "plug" or "none").` });
    if (errors.length) return { panels: [], errors, warnings, info: {} };

    const lidL = ctx.L + 2 * oh, lidW = ctx.W + 2 * oh;
    const off = Kerf.resolveOutlineOffset(ctx.outlineMode, mat.kerf);
    const flat = () => ({ type: 'flat', outlineOffset: off });
    const e4 = () => ({ bottom: flat(), top: flat(), left: flat(), right: flat() });
    const panels = [];

    const top = BoxGenerator.makePanel(`${idPrefix}-top`, `${nameBase} Top`, lidL, lidW, e4());
    Assembly.tagPanel(top, {
      assemblyId, componentType: 'lid-top', material: mat,
      frame3d: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], origin: [bo[0] - oh, bo[1] - oh, bo[2] + ctx.H] },
      explodeDir: [0, 0, 1], joint: 'none (lift-off)', notes: 'Rests on the body rim; lift straight up to remove.',
    });
    engraveLid(top, p, lidL, lidW);
    panels.push(top);

    let plugInfo = null;
    if (p.liftLidLocator === 'plug') {
      const pl = ctx.L - 2 * ctx.tb - 2 * c, pw = ctx.W - 2 * ctx.tb - 2 * c;
      if (pl < 5 || pw < 5) {
        errors.push({ code: 'lid-plug-size', message: `The lid's locating plug would be ${pl.toFixed(1)} × ${pw.toFixed(1)}mm — too small. Reduce the clearance or use locator "none".` });
        return { panels: [], errors, warnings, info: {} };
      }
      const plug = BoxGenerator.makePanel(`${idPrefix}-plug`, `${nameBase} Locating Plug`, pl, pw, e4());
      Assembly.tagPanel(plug, {
        assemblyId, componentType: 'lid-plug', material: mat,
        frame3d: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], origin: [bo[0] + ctx.tb + c, bo[1] + ctx.tb + c, bo[2] + ctx.H - lt] },
        explodeDir: [0, 0, 1], joint: 'glued to lid underside', notes: 'Glue centred under the lid top; it drops inside the body opening.',
      });
      panels.push(plug);
      plugInfo = { length: pl, width: pw, thickness: lt, clearancePerSide: c };
    }
    BoxGenerator.computeOutlines(panels);

    if (c < 0.1 && p.liftLidLocator === 'plug') warnings.push(`Lid clearance of ${c}mm is very tight — the plug may bind after kerf variation. Cut a test piece first.`);
    if (c > 1.5 && p.liftLidLocator === 'plug') warnings.push(`Lid clearance of ${c}mm per side is loose — the lid will rattle.`);

    return {
      panels, errors, warnings,
      info: { style: 'flat', top: { length: lidL, width: lidW, thickness: lt }, overhang: oh, plug: plugInfo, assembledHeightAboveBody: lt },
    };
  }

  /**
   * Build the 5-panel shell (top + 4 walls) for a cap or an inner collar.
   * `top` is the Z of the shell's top face; the shell hangs DOWN from there.
   */
  function buildShell(p, mat, o) {
    const { L, W, H, ox, oy, zTop, outlineMode, useButt, idTop } = o;
    const lt = mat.thickness, warn = [];
    let panels;
    if (useButt) {
      panels = DisplayCover.buildButtShell({
        idPrefix: 'cap', nameBase: 'Cap', L, W, H, t: lt, material: mat, assemblyId: 'lid',
        origin: [ox, oy, zTop - H], outlineMode, explodeDir: [0, 0, 1],
      });
      if (H - lt < lt) warn.push(`Skirt depth ${(H - lt).toFixed(1)}mm is thinner than the lid material — the skirt walls will be very short.`);
      if (idTop !== 'cap-top') panels.forEach(pn => { if (pn.id === 'cap-top') { pn.id = idTop; pn.name = 'Cap Plug'; pn.componentType = 'lid-plug'; } });
    } else {
      if (mat.transparent) warn.push('Finger joints in acrylic are brittle and unforgiving of kerf variation — consider joint "butt" with solvent cement.');
      const capParams = Object.assign({}, p, {
        length: L, width: W, height: H, thickness: lt, kerf: mat.kerf,
        lidStyle: 'none', bottomStyle: 'flat', boxType: 'finger5open',
      });
      const res = BoxGenerator.BoxTypes.finger5open.build(capParams);
      res.warnings.forEach(w => warn.push(`[lid] ${w}`));
      const frames = Assembly.boxFrames(L, W, H, lt, [0, 0, 0]);
      const rename = { left: 'cap-left', right: 'cap-right', front: 'cap-front', back: 'cap-back', bottom: idTop };
      const names = { left: 'Cap Left', right: 'Cap Right', front: 'Cap Front', back: 'Cap Back', bottom: idTop === 'cap-top' ? 'Cap Top' : 'Cap Plug' };
      panels = res.panels.map(pn => {
        const key = pn.id;
        pn.id = rename[key]; pn.name = names[key];
        Assembly.tagPanel(pn, {
          assemblyId: 'lid', componentType: key === 'bottom' ? (idTop === 'cap-top' ? 'cap-top' : 'lid-plug') : 'cap-skirt', material: mat,
          frame3d: Assembly.rigidFrame(frames[key], 'flipX', [ox, oy + W, zTop]),
          explodeDir: [0, 0, 1], joint: 'finger joint',
        });
        return pn;
      });
      BoxGenerator.computeOutlines(panels);
    }
    return { panels, warn };
  }

  /**
   * Cap-style lid.
   *   effective skirt > 0 : top + skirt around the OUTSIDE of the body
   *   effective skirt < 0 : flat plate + collar hanging INSIDE the body
   * @param {object} ctx { L, W, H, Hi, tb, bo, outlineMode, material, hasBottom }
   */
  function buildCapLid(p, ctx) {
    const errors = [], warnings = [];
    const mat = ctx.material, lt = mat.thickness;
    const bo = ctx.bo || [0, 0, 0];
    const cl = p.liftLidClearance;
    const base = p.liftLidSkirtDepth;
    const offset = p.liftLidSkirtOffset === null || p.liftLidSkirtOffset === undefined ? 0 : p.liftLidSkirtOffset;
    const isN = (v) => typeof v === 'number' && isFinite(v);

    if (!(lt > 0) || !isFinite(lt)) errors.push({ code: 'lid-thickness', message: `Lid material thickness must be positive (got ${lt}).` });
    if (!checkNumber(errors, cl, 'Cap lid clearance', 0, 2)) errors[errors.length - 1].message = `The selected lid clearance (${cl}mm) produces an incompatible fit — use between 0 and 2mm per side.`;
    let sd = NaN;
    if (!isN(base)) errors.push({ code: 'lid-skirt', message: `Lid skirt depth must be a number (got ${base}).` });
    else if (!isN(offset)) errors.push({ code: 'lid-skirt', message: `Lid skirt offset must be a number (got ${offset}).` });
    else {
      sd = base + offset;
      if (Math.abs(sd) < 1e-9) errors.push({ code: 'lid-skirt', message: `The effective lid skirt depth is 0 (depth ${base} + offset ${offset}). Use a positive value for an outer skirt or a negative value for an inner collar.` });
      else if (Math.abs(sd) > 1000) errors.push({ code: 'lid-skirt-deep', message: `The lid skirt (${sd}mm) is too deep — keep it within ±1000mm.` });
    }
    if (['auto', 'finger', 'butt'].indexOf(p.liftLidJoint) < 0) errors.push({ code: 'lid-joint', message: `Unknown lid joint "${p.liftLidJoint}" (use auto, finger or butt).` });

    const inward = isN(sd) && sd < 0;
    const depth = Math.abs(sd);
    if (!errors.length && inward) {
      const Hi = ctx.Hi !== undefined ? ctx.Hi : ctx.H - ctx.tb;
      if (depth + lt > Hi + 1e-6) errors.push({ code: 'lid-collar-deep', message: `The inner collar (${depth}mm + ${lt}mm plate) is deeper than the ${Hi}mm internal height — it would hit the floor of the box. Reduce the skirt depth/offset.` });
      const sL = ctx.L - 2 * ctx.tb - 2 * cl, sW = ctx.W - 2 * ctx.tb - 2 * cl;
      if (sL < 10 || sW < 10) errors.push({ code: 'lid-collar-size', message: `The inner collar would be only ${sL.toFixed(1)} × ${sW.toFixed(1)}mm — too small. Use a positive (outer) skirt for this box.` });
    }
    if (errors.length) return { panels: [], errors, warnings, info: {} };

    const useButt = p.liftLidJoint === 'butt' || (p.liftLidJoint === 'auto' && mat.transparent);
    const warn = [];
    let panels, info;

    if (!inward) {
      const capL = ctx.L + 2 * cl + 2 * lt, capW = ctx.W + 2 * cl + 2 * lt, capH = sd + lt;
      const ox = bo[0] - cl - lt, oy = bo[1] - cl - lt, zTop = bo[2] + ctx.H + lt;
      const sh = buildShell(p, mat, { L: capL, W: capW, H: capH, ox, oy, zTop, outlineMode: ctx.outlineMode, useButt, idTop: 'cap-top' });
      panels = sh.panels; sh.warn.forEach(w => warn.push(w));
      const top = panels.find(x => x.id === 'cap-top');
      if (top) engraveLid(top, p, top.W, top.H);
      if (sd > ctx.H + 1e-6) warn.push(`The lid skirt (${sd}mm) is deeper than the ${ctx.H}mm body — it hangs ${(sd - ctx.H).toFixed(1)}mm below the body's base.`);
      info = {
        style: 'cap', joint: useButt ? 'butt' : 'finger', inward: false,
        outer: { length: capL, width: capW, height: capH },
        inner: { length: capL - 2 * lt, width: capW - 2 * lt, height: sd },
        skirtDepth: sd, skirtBelowBase: Math.max(0, sd - ctx.H), clearancePerSide: cl, thickness: lt, assembledHeightAboveBody: lt,
        kerf: mat.kerf, netGapPerSide: netGap(cl, mat.kerf, Kerf.resolveOutlineOffset(ctx.outlineMode, mat.kerf), false),
      };
    } else {
      // Flat lid plate on the rim + collar frame hanging inside the body.
      const plateRes = buildFlatLid(Object.assign({}, p, { liftLidLocator: 'none' }), Object.assign({}, ctx, { material: mat, assemblyId: 'lid', idPrefix: 'lid', nameBase: 'Lid' }));
      if (plateRes.errors.length) return { panels: [], errors: plateRes.errors, warnings, info: {} };
      const sL = ctx.L - 2 * ctx.tb - 2 * cl, sW = ctx.W - 2 * ctx.tb - 2 * cl, sH = depth + lt;
      const ox = bo[0] + ctx.tb + cl, oy = bo[1] + ctx.tb + cl, zTop = bo[2] + ctx.H;
      const sh = buildShell(p, mat, { L: sL, W: sW, H: sH, ox, oy, zTop, outlineMode: ctx.outlineMode, useButt, idTop: 'cap-plug' });
      sh.warn.forEach(w => warn.push(w));
      panels = plateRes.panels.concat(sh.panels);
      BoxGenerator.computeOutlines(panels);
      info = {
        style: 'cap', joint: useButt ? 'butt' : 'finger', inward: true,
        outer: { length: sL, width: sW, height: sH },
        inner: { length: sL - 2 * lt, width: sW - 2 * lt, height: depth },
        plate: plateRes.info.top,
        skirtDepth: sd, collarDepth: depth, clearancePerSide: cl, thickness: lt, assembledHeightAboveBody: lt,
        kerf: mat.kerf, netGapPerSide: netGap(cl, mat.kerf, Kerf.resolveOutlineOffset(ctx.outlineMode, mat.kerf), true),
        collarBottomAboveFloor: (ctx.Hi !== undefined ? ctx.Hi : ctx.H - ctx.tb) - sH,
      };
      warn.push(...plateRes.warnings);
    }

    if (cl < 0.1) warn.push(`Cap clearance of ${cl}mm is very tight — the ${inward ? 'collar may not enter the body' : 'cap may be impossible to remove'} after kerf variation. Cut a test piece first.`);
    if (cl > 1.2) warn.push(`Cap clearance of ${cl}mm per side is loose — the ${inward ? 'collar' : 'cap'} will rattle.`);

    return { panels, errors, warnings: warn, info };
  }

  /**
   * Inset lid: a smaller open-box cover that sits inside the base and stands
   * `liftLidRise` above its rim. Flat top; walls hang `liftLidInsetDepth` into the base.
   * @param {object} ctx { L, W, H, Hi, tb, bo, outlineMode, material }
   */
  function buildInsetLid(p, ctx) {
    const errors = [], warnings = [];
    const mat = ctx.material, lt = mat.thickness;
    const bo = ctx.bo || [0, 0, 0];
    const cl = p.liftLidClearance, depth = p.liftLidInsetDepth, rise = p.liftLidRise;
    const isN = (v) => typeof v === 'number' && isFinite(v);
    const Hi = ctx.Hi !== undefined ? ctx.Hi : ctx.H - ctx.tb;

    if (!(lt > 0) || !isFinite(lt)) errors.push({ code: 'lid-thickness', message: `Lid material thickness must be positive (got ${lt}).` });
    if (!checkNumber(errors, cl, 'Inset lid clearance', 0, 2)) errors[errors.length - 1].message = `The selected lid clearance (${cl}mm) produces an incompatible fit — use between 0 and 2mm per side.`;
    if (!(isN(depth) && depth > 0)) errors.push({ code: 'lid-inset-depth', message: `Inset depth (how far the lid goes into the base) must be a positive number (got ${depth}).` });
    else if (depth > Hi + 1e-6) errors.push({ code: 'lid-inset-deep', message: `The inset depth (${depth}mm) is deeper than the ${Hi}mm internal height of the base — the lid would hit the floor. Reduce the inset depth.` });
    if (!(isN(rise) && rise >= 0 && rise <= 500)) errors.push({ code: 'lid-rise', message: `Lid rise above the rim must be between 0 and 500mm (got ${rise}).` });
    if (['auto', 'finger', 'butt'].indexOf(p.liftLidJoint) < 0) errors.push({ code: 'lid-joint', message: `Unknown lid joint "${p.liftLidJoint}" (use auto, finger or butt).` });
    const sL = ctx.L - 2 * ctx.tb - 2 * cl, sW = ctx.W - 2 * ctx.tb - 2 * cl;
    if (!errors.length && (sL < 10 || sW < 10)) errors.push({ code: 'lid-inset-size', message: `The inset lid would be only ${sL.toFixed(1)} × ${sW.toFixed(1)}mm — too small. Enlarge the base or reduce the clearance.` });
    if (!errors.length && depth + rise < 2 * lt) errors.push({ code: 'lid-inset-short', message: `The lid is only ${(depth + rise).toFixed(1)}mm tall in total — it must be at least ${(2 * lt).toFixed(1)}mm (two material thicknesses).` });
    if (errors.length) return { panels: [], errors, warnings, info: {} };

    const total = depth + rise;
    const useButt = p.liftLidJoint === 'butt' || (p.liftLidJoint === 'auto' && mat.transparent);
    const ox = bo[0] + ctx.tb + cl, oy = bo[1] + ctx.tb + cl, zTop = bo[2] + ctx.H + rise;
    const sh = buildShell(p, mat, { L: sL, W: sW, H: total, ox, oy, zTop, outlineMode: ctx.outlineMode, useButt, idTop: 'cap-top' });
    const top = sh.panels.find(x => x.id === 'cap-top');
    if (top) engraveLid(top, p, top.W, top.H);
    const warn = sh.warn.slice();
    const ng = netGap(cl, mat.kerf, Kerf.resolveOutlineOffset(ctx.outlineMode, mat.kerf), true);
    if (ng < 0.05) warn.push(`After kerf (${mat.kerf}mm, outline "${ctx.outlineMode}") the inset lid is only ${ng.toFixed(2)}mm per side from the base walls — it will bind. Increase the clearance or use outline compensation "auto"/"outside".`);
    if (cl < 0.1) warn.push(`Inset clearance of ${cl}mm is very tight — the lid may not enter the base after kerf variation. Cut a test piece first.`);
    if (cl > 1.2) warn.push(`Inset clearance of ${cl}mm per side is loose — the lid will rattle in the base.`);
    return {
      panels: sh.panels, errors, warnings: warn,
      info: {
        style: 'inset', joint: useButt ? 'butt' : 'finger', inward: true, inset: true,
        outer: { length: sL, width: sW, height: total },
        inner: { length: sL - 2 * lt, width: sW - 2 * lt, height: total - lt },
        insetDepth: depth, rise, clearancePerSide: cl, thickness: lt, assembledHeightAboveBody: rise,
        kerf: mat.kerf, outlineOffset: Kerf.resolveOutlineOffset(ctx.outlineMode, mat.kerf),
        netGapPerSide: netGap(cl, mat.kerf, Kerf.resolveOutlineOffset(ctx.outlineMode, mat.kerf), true),
        bottomAboveFloor: Hi - depth,
      },
    };
  }

  const LiftOffLid = { lidDefaults, buildFlatLid, buildCapLid, buildInsetLid, plugBlock, STYLES };
  if (isNode) module.exports = LiftOffLid;
  else root.LiftOffLid = LiftOffLid;
})(typeof window !== 'undefined' ? window : globalThis);
