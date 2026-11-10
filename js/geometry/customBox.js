/**
 * customBox.js — composes a box BODY with optional internal DIVIDERS and an
 * optional DETACHED lid / acrylic display cover. Registered as box type
 * `customBox`; the two requested presets ("Box with Dividers" and "Box with
 * Detached Lid") are just parameter sets for this one builder, so the features
 * combine freely (e.g. a lift-off-lid gift box with four compartments).
 *
 * Pipeline (each step is its own module and testable on its own):
 *   1. normalise + validate parameters, resolve per-component materials
 *   2. displayCover.js  (only for the acrylic cover with sidewalls: it decides
 *                         where the body sits — on a base plate, inside a ring)
 *   3. body             (existing finger6 / finger5open generators, unchanged)
 *   4. dividerGrid.js   (cross-lap dividers + optional wall slots)
 *   5. liftOffLidBox.js (flat / cap) or displayCover.js (acrylic cover)
 *   6. assembly metadata, 3D frames, collision check, assembled bounds
 *
 * Dimension conventions (all external/outer, like every other box type):
 *   length × width × height  = the BODY's external size (without lid).
 *   Lid / cover sizes are DERIVED from the body size, the clearance and the
 *   lid material thickness — see liftOffLidBox.js and displayCover.js.
 *   Internal usable space = external − 2·bodyThickness (X, Y) and
 *   height − bottom − (fixed top if any) (Z).
 *
 * Body top: if no detached lid is chosen and the legacy "Lid" control is
 * "Flat panel", the body is the normal closed 6-panel finger box; otherwise
 * it is the open-top finger box that the detached lid / cover goes onto.
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const BoxGenerator = isNode ? require('./boxGenerator.js') : root.BoxGenerator;
  const Assembly = isNode ? require('./assembly.js') : root.Assembly;
  const DividerGrid = isNode ? require('./dividerGrid.js') : root.DividerGrid;
  const LiftOffLid = isNode ? require('./liftOffLidBox.js') : root.LiftOffLid;
  const DisplayCover = isNode ? require('./displayCover.js') : root.DisplayCover;
  const InnerBed = isNode ? require('./innerBed.js') : root.InnerBed;

  const BODY_EXPLODE = { left: [-1, 0, 0], right: [1, 0, 0], front: [0, -1, 0], back: [0, 1, 0], bottom: [0, 0, -1], top: [0, 0, 1] };

  function featureDefaults() {
    return Object.assign({ bodyHeightOffset: 0, shapeType: 'heart', shapeWall: 9, shapeLidClearance: 0.3, shapeEngraveText: '' }, DividerGrid.dividerDefaults(), InnerBed.bedDefaults(), LiftOffLid.lidDefaults(), DisplayCover.coverDefaults());
  }

  function err(list, code, message) { list.push({ code, message }); }

  function buildCustomBox(raw) {
    let p = Object.assign({}, featureDefaults(), raw);
    const errors = [], warnings = [];

    // ---- 1. parameters & materials ------------------------------------
    for (const k of ['length', 'width', 'height', 'thickness']) {
      if (!(typeof p[k] === 'number' && isFinite(p[k]) && p[k] > 0)) err(errors, 'param-' + k, `${k[0].toUpperCase() + k.slice(1)} must be a positive number (got ${p[k]}).`);
    }
    // Body height offset (±mm): effective body height = height + offset. Lets the
    // body go taller or shorter than the nominal height without touching it.
    const hOff = p.bodyHeightOffset === null || p.bodyHeightOffset === undefined ? 0 : p.bodyHeightOffset;
    if (!(typeof hOff === 'number' && isFinite(hOff))) err(errors, 'param-bodyHeightOffset', `Body height offset must be a number (got ${p.bodyHeightOffset}).`);
    if (LiftOffLid.STYLES.indexOf(p.liftLidStyle) < 0) err(errors, 'lid-style', `Unknown lid style "${p.liftLidStyle}" (use none, flat, cap, inset or acrylicCover).`);
    if (errors.length) return { panels: [], warnings, errors, info: {} };

    const mats = {
      body: Assembly.resolveMaterial(p, 'body'),
      bed: Assembly.resolveMaterial(p, 'bed'),
      divider: Assembly.resolveMaterial(p, 'divider'),
      lid: Assembly.resolveMaterial(p, 'lid'),
      cover: Assembly.resolveMaterial(p, 'cover'),
    };
    const L = p.length, W = p.width, H = p.height + hOff, tb = p.thickness;
    if (!(H > 0)) err(errors, 'param-height', `The effective body height is ${H}mm (height ${p.height} + offset ${hOff}) — it must be positive.`);
    if (errors.length) return { panels: [], warnings, errors, info: {} };
    const style = p.liftLidStyle;
    const closedTop = style === 'none' && p.lidStyle !== 'none';
    const hasBottom = p.bottomStyle !== 'none';
    const outlineMode = p.outlineCompensation;
    const Li = L - 2 * tb, Wi = W - 2 * tb;
    const Hi = H - (hasBottom ? tb : 0) - (closedTop ? tb : 0);
    if (!(Li > 0 && Wi > 0 && Hi > 0)) err(errors, 'internal-space', `The ${L} × ${W} × ${H}mm body has no internal space with ${tb}mm material. Increase its size or reduce the thickness.`);
    if (errors.length) return { panels: [], warnings, errors, info: {} };

    // ---- 2. display cover decides where the body sits ------------------
    let bo = [0, 0, 0];
    let coverRes = null;
    if (style === 'acrylicCover' && p.coverSidewalls) {
      coverRes = DisplayCover.buildDisplayCover(p, { L, W, H, tb, outlineMode, coverMat: mats.cover, baseMat: mats.lid });
      coverRes.errors.forEach(e => errors.push(e));
      bo = coverRes.bo;
    }

    // ---- 3. body (existing generators, unchanged) ----------------------
    const bodyParams = Object.assign({}, p, { height: H, lidStyle: closedTop ? p.lidStyle : 'none' });
    const bodyRes = BoxGenerator.BoxTypes[closedTop ? 'finger6' : 'finger5open'].build(bodyParams);
    bodyRes.warnings.forEach(w => warnings.push(w));
    const frames = Assembly.boxFrames(L, W, H, tb, bo);
    for (const panel of bodyRes.panels) {
      Assembly.tagPanel(panel, {
        assemblyId: 'body', componentType: panel.id === 'bottom' ? 'bottom' : panel.id === 'top' ? 'top' : 'wall',
        material: mats.body, frame3d: frames[panel.id], explodeDir: BODY_EXPLODE[panel.id],
        joint: 'finger joint',
      });
    }
    const bodyById = {};
    bodyRes.panels.forEach(pn => { bodyById[pn.id] = pn; });

    // ---- 4. dividers ---------------------------------------------------
    let dividerRes = null;
    const plugBlock = style === 'flat' ? LiftOffLid.plugBlock(p, mats.lid)
      : (style === 'acrylicCover' && !p.coverSidewalls && p.liftLidLocator === 'plug' ? mats.cover.thickness : 0);
    if (p.dividersEnabled) {
      dividerRes = DividerGrid.buildDividers(p, {
        L, W, H, tb, bodyKerf: mats.body.kerf, outlineMode, bo, closedTop, hasBottom,
        plugBlock, material: mats.divider,
      });
      dividerRes.errors.forEach(e => errors.push(e));
      dividerRes.warnings.forEach(w => warnings.push(w));
      if (!dividerRes.errors.length) {
        for (const id of Object.keys(dividerRes.wallCutouts)) {
          if (bodyById[id]) bodyById[id].cutouts.push(...dividerRes.wallCutouts[id]);
        }
      }
    }

    // ---- 4a. supported sizing: nothing floats ---------------------------
    // bedOnFloor: the bed stands on the internal floor (upside-down tray / platform,
    // elevation 0) and its height is measured FROM THE FLOOR.
    // Inset lid with a blank depth: it rests on the part below it, so
    //   depth = internal height - top of the bed (or the floor if there is no bed).
    if (p.bedEnabled && p.bedOnFloor) p = Object.assign({}, p, { bedElevation: 0, bedFlipped: p.bedStyle === 'tray' });
    if (style === 'inset' && (p.liftLidInsetDepth === null || p.liftLidInsetDepth === undefined || p.liftLidInsetDepth === '')) {
      const bedTop = p.bedEnabled ? (p.bedStyle === 'plate' ? p.bedElevation + mats.bed.thickness : (p.bedHeight === null || p.bedHeight === undefined || p.bedHeight === '' ? NaN : p.bedElevation + p.bedHeight)) : 0;
      if (!isFinite(bedTop)) { warnings.push('The inset lid is set to rest on the bed, but the bed height is blank, so a 15mm inset depth is used. Enter a bed height (from the floor) to make the lid rest on the bed.'); p = Object.assign({}, p, { liftLidInsetDepth: Math.min(15, Hi) }); }
      else p = Object.assign({}, p, { liftLidInsetDepth: Hi - bedTop, liftLidInsetAuto: true });
    }

    // An inset lid must never hang in mid-air. Whatever depth is typed in:
    //  - bed with a set height: the lid is snapped down to rest on the bed top;
    //  - no bed: a support ledge (frame glued to the base walls) is generated under it.
    let insetLedge = null;
    if (style === 'inset' && typeof p.liftLidInsetDepth === 'number' && p.liftLidInsetDepth > 0) {
      const bh = p.bedHeight, hasH = !(bh === null || bh === undefined || bh === '');
      const supportTop = p.bedEnabled ? (p.bedStyle === 'plate' ? p.bedElevation + mats.bed.thickness : (hasH ? p.bedElevation + bh : null)) : 0;
      const lidBottom = Hi - p.liftLidInsetDepth;
      if (supportTop !== null && lidBottom - supportTop > 0.2) {
        if (p.bedEnabled) {
          warnings.push(`The inset lid would have hung ${(lidBottom - supportTop).toFixed(1)}mm above the bed. Its depth was increased to ${(Hi - supportTop).toFixed(1)}mm so it rests on the bed.`);
          p = Object.assign({}, p, { liftLidInsetDepth: Hi - supportTop });
        } else if (lidBottom >= mats.body.thickness) {
          insetLedge = { z: lidBottom };
        } else {
          p = Object.assign({}, p, { liftLidInsetDepth: Hi });
        }
      }
    }

    // ---- 4b. inner bed ---------------------------------------------------
    let bedRes = null;
    if (p.bedEnabled) {
      // Highest point (above the internal floor) the bed may reach before it hits
      // whatever hangs inside the opening: an inset lid, an inner collar or a lid plug.
      let bedCeiling = Hi;
      const lidT = mats.lid.thickness, num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
      if (style === 'inset') bedCeiling = Hi - num(p.liftLidInsetDepth);
      else if (style === 'cap') { const sd = num(p.liftLidSkirtDepth) + num(p.liftLidSkirtOffset); if (sd < 0) bedCeiling = Hi - (Math.abs(sd) + lidT); }
      else if (style === 'flat') bedCeiling = Hi - plugBlock;
      bedRes = InnerBed.buildBed(p, { L, W, H, tb, bo, Hi, hasBottom, outlineMode, material: mats.bed, bedCeiling });
      bedRes.errors.forEach(e => errors.push(e));
      bedRes.warnings.forEach(w => warnings.push(w));
    }

    // ---- 5. lid / cover ------------------------------------------------
    let lidRes = null;
    const lidCtx = { L, W, H, Hi, tb, bo, outlineMode, hasBottom };
    if (style === 'flat') {
      lidRes = LiftOffLid.buildFlatLid(p, Object.assign({}, lidCtx, { material: mats.lid, assemblyId: 'lid', idPrefix: 'lid', nameBase: 'Lid' }));
    } else if (style === 'inset') {
      lidRes = LiftOffLid.buildInsetLid(p, Object.assign({}, lidCtx, { material: mats.lid }));
    } else if (style === 'cap') {
      lidRes = LiftOffLid.buildCapLid(p, Object.assign({}, lidCtx, { material: mats.lid }));
    } else if (style === 'acrylicCover') {
      if (p.coverSidewalls) lidRes = coverRes;
      else lidRes = LiftOffLid.buildFlatLid(p, Object.assign({}, lidCtx, { material: mats.cover, assemblyId: 'cover', idPrefix: 'cover', nameBase: 'Cover' }));
      if (!p.coverSidewalls) lidRes.errors.forEach(e => errors.push(e));
    }
    if (lidRes && style !== 'acrylicCover') lidRes.errors.forEach(e => errors.push(e));
    if (lidRes) lidRes.warnings.forEach(w => warnings.push(w));

    // ---- 6. assemble ---------------------------------------------------
    const panels = bodyRes.panels.slice();
    const divPanels = dividerRes && !dividerRes.errors.length ? dividerRes.panels : [];
    divPanels.forEach(pn => panels.push(pn));
    if (bedRes && !bedRes.errors.length) bedRes.panels.forEach(pn => panels.push(pn));
    if (insetLedge && lidRes && !lidRes.errors.length) {
      const cl = p.liftLidClearance, lt = mats.lid.thickness, t = mats.body.thickness;
      const w = Math.max(6, cl + lt + 3), LL = L - 2 * tb - 0.4, LW = W - 2 * tb - 0.4;
      const ring = BoxGenerator.makePanel('lid-ledge', 'Lid Support Ledge', LL, LW, {});
      ring.fixedOutline = true;
      ring.outline = [{ x: 0, y: 0 }, { x: LL, y: 0 }, { x: LL, y: LW }, { x: 0, y: LW }];
      ring.cutouts.push({ type: 'rect', x: LL / 2, y: LW / 2, w: LL - 2 * w, h: LW - 2 * w, layer: 'cut' });
      Assembly.tagPanel(ring, {
        assemblyId: 'body', componentType: 'lid-ledge', material: mats.body,
        frame3d: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], origin: [bo[0] + tb + 0.2, bo[1] + tb + 0.2, bo[2] + (hasBottom ? tb : 0) + insetLedge.z - t] },
        explodeDir: [0, 0, 0.3], joint: 'glued to base walls', notes: `Glue ${w.toFixed(0)}mm ring flush under the inset lid's rim line so the lid rests on it.`,
      });
      panels.push(ring);
      lidRes.info.ledge = { z: insetLedge.z, width: w };
      warnings.push(`A ${w.toFixed(0)}mm support ledge (\"Lid Support Ledge\") is added so the inset lid rests ${insetLedge.z.toFixed(1)}mm above the base floor instead of floating. Glue it to the inner walls.`);
    }
    if (lidRes && !lidRes.errors.length) lidRes.panels.forEach(pn => panels.push(pn));

    // Panel-id uniqueness (assemblies must stay separate and addressable)
    const seen = {};
    for (const pn of panels) {
      if (seen[pn.id]) err(errors, 'duplicate-panel-id', `Panel id "${pn.id}" is generated twice — assemblies must stay separate.`);
      seen[pn.id] = true;
    }

    // Outlines are needed for bounds/collision checks (generate() recomputes them identically afterwards).
    BoxGenerator.computeOutlines(panels);
    const collisions = Assembly.findCollisions(panels);
    for (const c of collisions) {
      const asms = [c.aAssembly, c.bAssembly];
      const has = (a) => asms.indexOf(a) >= 0;
      const hasLid = has('lid') || has('cover');
      let msg;
      if (has('bed') && has('dividers')) msg = `The inner bed collides with the dividers: "${c.aName}" intersects "${c.bName}". Lower the divider height, raise the bed above the dividers, or turn the dividers off.`;
      else if (has('bed') && hasLid) msg = `The inner bed collides with the lid: "${c.aName}" intersects "${c.bName}". Lower the bed (elevation/height) or use a deeper lid.`;
      else if (has('dividers') && hasLid) msg = `Divider geometry collides with the lid/cover: "${c.aName}" intersects "${c.bName}". Lower the divider height or remove the lid plug.`;
      else msg = `Unintended collision between "${c.aName}" (${c.aAssembly}) and "${c.bName}" (${c.bAssembly}).`;
      err(errors, 'collision', msg);
    }

    const bounds = Assembly.assembledBounds(panels);
    const info = Object.assign({}, bodyRes.info, {
      customBox: true,
      dims: {
        bodyExternal: { length: L, width: W, height: H },
        bodyInternal: { length: Li, width: Wi, height: Hi },
        assembled: bounds ? { length: bounds.size[0], width: bounds.size[1], height: bounds.size[2] } : null,
      },
      bodyOrigin: bo,
      closedTop,
      materials: mats,
      dividers: dividerRes ? dividerRes.info : null,
      bed: bedRes && !bedRes.errors.length ? bedRes.info : null,
      bodyHeightOffset: hOff,
      lid: lidRes ? lidRes.info : null,
      collisions,
      assembledBounds: bounds,
    });
    if (coverRes && coverRes.info) { info.cover = coverRes.info.cover; info.seat = coverRes.info.seat; }

    return { panels, warnings, errors, info };
  }

  function register() {
    BoxGenerator.BoxTypes.customBox = {
      label: 'Box with Dividers / Detached Lid',
      build: buildCustomBox,
      defaults: featureDefaults(),
    };
  }
  register();

  const CustomBox = { buildCustomBox, featureDefaults, BODY_EXPLODE };
  if (isNode) module.exports = CustomBox;
  else root.CustomBox = CustomBox;
})(typeof window !== 'undefined' ? window : globalThis);
