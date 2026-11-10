/**
 * preview3d.js — assembles the SAME panel outlines used for 2D/export into
 * an accurate 3D scene. Each panel is extruded by the material thickness
 * and placed with the transform its construction role implies (see
 * boxGenerator.js for the axis convention). This is not a stylized
 * placeholder box — the finger joints you see in 3D are the real cut
 * geometry, extruded.
 */
(function (root) {
  'use strict';

  const THREE = root.THREE;

  // Per-panel-id local->global basis + origin function, matching the
  // "endcap" construction convention in boxGenerator.js. xAxis/yAxis map the
  // panel's local (outline) x/y; zAxis is the extrusion (thickness) direction.
  function panelFrame(id, p) {
    const t = p.thickness, L = p.length, W = p.width, H = p.height;
    switch (id) {
      case 'left': return { x: [0, 1, 0], y: [0, 0, 1], z: [1, 0, 0], origin: [0, 0, 0] };
      case 'right': return { x: [0, 1, 0], y: [0, 0, 1], z: [1, 0, 0], origin: [L - t, 0, 0] };
      case 'front': return { x: [1, 0, 0], y: [0, 0, 1], z: [0, 1, 0], origin: [t, 0, 0] };
      case 'back': return { x: [1, 0, 0], y: [0, 0, 1], z: [0, 1, 0], origin: [t, W - t, 0] };
      case 'bottom': case 'base': return { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], origin: [t, 0, 0] };
      case 'top': return { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], origin: [t, 0, H - t] };
      // Sliding-lid mechanism parts (js/geometry/slidingLidBox.js) — glued
      // to the inside faces of Left/Right, near the top. Positions here are
      // a representative assembly view, not laser-measured to the micron.
      case 'runner-left': return { x: [0, 1, 0], y: [0, 0, 1], z: [1, 0, 0], origin: [t, 0, 0] };
      case 'runner-right': return { x: [0, 1, 0], y: [0, 0, 1], z: [1, 0, 0], origin: [L - 2 * t, 0, 0] };
      case 'rail-left': {
        const railLen = p.width - (p.railSetbackFromFront || 24);
        const railW = p.railWidth != null ? p.railWidth : t;
        return { x: [0, 1, 0], y: [0, 0, 1], z: [1, 0, 0], origin: [t, Math.max(W - railLen, 0), H - railW] };
      }
      case 'rail-right': {
        const railLen = p.width - (p.railSetbackFromFront || 24);
        const railW = p.railWidth != null ? p.railWidth : t;
        return { x: [0, 1, 0], y: [0, 0, 1], z: [1, 0, 0], origin: [L - 2 * t, Math.max(W - railLen, 0), H - railW] };
      }
      case 'lid': {
        const runnerH = H - (t + (p.lidClearance != null ? p.lidClearance : 0.2));
        return { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], origin: [t + (p.horizontalClearance || 0) / 2, t / 2, runnerH] };
      }
      // Hinged-box lid/back combined panels (js/geometry/hingedBox.js) are
      // tall single pieces that fold — shown flat (pre-fold) at the Back
      // panel's position, since a true fold animation is out of scope here.
      case 'lid-front': return { x: [1, 0, 0], y: [0, 0, 1], z: [0, 1, 0], origin: [t, 0, 0] };
      case 'lid-back': return { x: [1, 0, 0], y: [0, 0, 1], z: [0, 1, 0], origin: [t, W - t, 0] };
      default: return { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], origin: [0, 0, 0] };
    }
  }

  function explodeDirection(id) {
    switch (id) {
      case 'left': return [-1, 0, 0];
      case 'right': return [1, 0, 0];
      case 'front': return [0, -1, 0];
      case 'back': case 'lid-back': return [0, 1, 0];
      case 'bottom': case 'base': return [0, 0, -1];
      case 'top': case 'lid': return [0, 0, 1];
      case 'runner-left': return [-1, 0, 0];
      case 'runner-right': return [1, 0, 0];
      case 'rail-left': return [-1, 0, 0.5];
      case 'rail-right': return [1, 0, 0.5];
      case 'lid-front': return [0, -1, 0];
      default: return [0, 0, 0];
    }
  }

  // Panels generated with an explicit frame3d (customBox: dividers, lids,
  // covers, plates) carry their own placement, thickness and explode data;
  // legacy panels fall back to the id-based table above.
  function frameFor(panel, params) { return panel.frame3d || panelFrame(panel.id, params); }
  function thicknessFor(panel, params) { return panel.thickness !== undefined && panel.thickness !== null ? panel.thickness : params.thickness; }
  function explodeFor(panel) { return panel.explodeDir || explodeDirection(panel.id); }
  const LIFTED_ASSEMBLIES = { lid: true, cover: true };

  function buildPanelMesh(panel, params, material) {
    const shape = new THREE.Shape();
    const pts = panel.outline;
    shape.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, pts[i].y);
    shape.closePath();
    for (const c of panel.cutouts || []) {
      // Only real through-cuts punch a hole in the 3D solid. Score passes
      // (laser traces the line but doesn't cut through) and open paths
      // can't validly form a hole, so they're drawn as overlays instead —
      // see buildOverlayMeshes().
      if (c.layer === 'score' || c.closed === false) continue;
      const poly = root.Panel.buildCutout(c);
      const hole = new THREE.Path();
      hole.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) hole.lineTo(poly[i].x, poly[i].y);
      hole.closePath();
      shape.holes.push(hole);
    }

    const geo = new THREE.ExtrudeGeometry(shape, { depth: thicknessFor(panel, params), bevelEnabled: false, curveSegments: 1 });
    const mesh = new THREE.Mesh(geo, material);

    const f = frameFor(panel, params);
    const m = new THREE.Matrix4();
    m.makeBasis(new THREE.Vector3(...f.x), new THREE.Vector3(...f.y), new THREE.Vector3(...f.z));
    m.setPosition(new THREE.Vector3(...f.origin));
    mesh.applyMatrix4(m);
    mesh.userData.panelId = panel.id;
    mesh.userData.explodeDir = explodeFor(panel);
    mesh.userData.liftable = !!LIFTED_ASSEMBLIES[panel.assemblyId];
    mesh.userData.baseMatrix = m.clone();
    return mesh;
  }

  /**
   * Builds visual-only overlays for things that aren't through-cuts:
   *  - engraved artwork fills -> a thin black flat shape at the panel's
   *    outer face (z = thickness, i.e. the face away from the box interior
   *    for most panels), matching the ENGRAVE colour used in export.
   *  - score-layer cutouts / open artwork paths -> a thin blue line at the
   *    same face, matching the SCORE colour used in export.
   * These use the exact same panel-local coordinates as everything else —
   * only the material/geometry differs (flat, not extruded).
   */
  function buildOverlayMeshes(panel, params) {
    const f = frameFor(panel, params);
    const m = new THREE.Matrix4();
    m.makeBasis(new THREE.Vector3(...f.x), new THREE.Vector3(...f.y), new THREE.Vector3(...f.z));
    m.setPosition(new THREE.Vector3(...f.origin));
    const zOffset = thicknessFor(panel, params) + 0.05; // sit just above the outer face to avoid z-fighting

    const group = new THREE.Group();
    group.applyMatrix4(m);
    group.userData.panelId = panel.id;
    group.userData.explodeDir = explodeFor(panel);
    group.userData.liftable = !!LIFTED_ASSEMBLIES[panel.assemblyId];
    group.userData.baseMatrix = m.clone();

    for (const e of panel.engravings || []) {
      if (e.type !== 'artworkFill' || !e.points || e.points.length < 3) continue;
      const shape = new THREE.Shape();
      shape.moveTo(e.points[0].x, e.points[0].y);
      for (let i = 1; i < e.points.length; i++) shape.lineTo(e.points[i].x, e.points[i].y);
      shape.closePath();
      const geo = new THREE.ShapeGeometry(shape);
      const mat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.z = zOffset;
      group.add(mesh);
    }
    for (const c of panel.cutouts || []) {
      if (c.layer !== 'score' && c.closed !== false) continue; // real cuts are already holes in the solid
      const poly = root.Panel.buildCutout(c);
      const positions = [];
      for (const p of poly) positions.push(p.x, p.y, zOffset);
      if (c.closed !== false) positions.push(poly[0].x, poly[0].y, zOffset);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x0000ff }));
      group.add(line);
    }
    return group.children.length ? group : null;
  }

  function createScene(canvas) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x14161b);

    const camera = new THREE.PerspectiveCamera(45, 1, 1, 10000);
    camera.position.set(400, -500, 350);
    camera.up.set(0, 0, 1);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const hemi = new THREE.HemisphereLight(0xffffff, 0x33363f, 1.1);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(300, -200, 500);
    scene.add(dir);

    const grid = new THREE.GridHelper(1000, 25, 0xffffff, 0xffffff);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);

    let controls = null;
    if (THREE.OrbitControls) {
      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.target.set(150, 100, 50);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08; controls.autoRotateSpeed = 1.6; controls.maxPolarAngle = Math.PI * 0.96; controls.zoomSpeed = 0.9;
    }

    const group = new THREE.Group();
    scene.add(group);

    let raf = null;
    const cur = { ex: 0, lift: 0 }, tgt = { ex: 0, lift: 0 }, ease = { amount: 60 };
    let camAnim = null;
    function applyOffsets() {
      for (const mesh of group.children) {
        const d = mesh.userData.explodeDir; if (!d) continue;
        const lift = mesh.userData.liftable ? cur.lift : 0;
        const t = new THREE.Matrix4().makeTranslation(d[0] * cur.ex, d[1] * cur.ex, d[2] * cur.ex + lift);
        mesh.matrix.identity(); mesh.matrixAutoUpdate = false;
        mesh.matrix.multiplyMatrices(t, mesh.userData.baseMatrix);
      }
    }
    function animate() {
      raf = requestAnimationFrame(animate);
      const de = tgt.ex - cur.ex, dl = tgt.lift - cur.lift;
      if (Math.abs(de) > 0.05 || Math.abs(dl) > 0.05) { cur.ex += de * 0.12; cur.lift += dl * 0.12; applyOffsets(); }
      else if (de || dl) { cur.ex = tgt.ex; cur.lift = tgt.lift; applyOffsets(); }
      if (camAnim) { const k = Math.min(1, (performance.now() - camAnim.t0) / 600), e = 1 - Math.pow(1 - k, 3);
        camera.position.lerpVectors(camAnim.from, camAnim.to, e); if (k >= 1) camAnim = null; }
      if (controls) controls.update();
      renderer.render(scene, camera);
    }
    animate();

    function resize() {
      const rect = canvas.parentElement.getBoundingClientRect();
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / Math.max(rect.height, 1);
      camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize);
    resize();

    function clearGroup() { while (group.children.length) group.remove(group.children[0]); }

    function materialFor(panel, params, opts) {
      const transparent = !!panel.transparent;
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color(panel.materialColor || params.materialColor || '#c69a63'),
        roughness: transparent ? 0.15 : 0.85, metalness: transparent ? 0.0 : 0.05, side: THREE.DoubleSide,
        // Clear acrylic is drawn translucent so the product inside stays visible.
        transparent: transparent || !!opts.transparent,
        opacity: transparent ? 0.28 : (opts.transparent ? 0.55 : 1),
        depthWrite: !transparent,
      });
    }

    function buildFromResult(result, params, opts) {
      opts = opts || {};
      clearGroup();
      for (const panel of result.panels) {
        if (opts.hidden && opts.hidden[panel.id]) continue;
        const mesh = buildPanelMesh(panel, params, materialFor(panel, params, opts));
        mesh.userData.panelName = panel.name || panel.id;
        if (panel.transparent) mesh.renderOrder = 2; // draw after opaque parts
        group.add(mesh);
        const overlay = buildOverlayMeshes(panel, params);
        if (overlay) group.add(overlay);
      }
      lastParams = params; lastResult = result; setTimeout(applyWire, 0);
      lastLift = { on: !!opts.lidLifted, amount: opts.liftAmount || Math.max(params.height * 0.9, 40) };
      setExploded(!!opts.exploded, opts.explodeAmount || 60);
      const sig = [params.length, params.width, params.height, result.panels.length].join();
      if (sig !== lastSig) { lastSig = sig; frameCamera(params, result); }
    }
    let lastSig = '';

    let lastLift = { on: false, amount: 60 };
    const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(); let hov = null;
    const tip = document.createElement('div'); tip.className = 'tip3d'; canvas.parentElement.appendChild(tip);
    function setHover(m) {
      if (hov && hov.material.emissive) hov.material.emissive.setHex(0x000000);
      hov = m; canvas.style.cursor = m ? 'pointer' : 'grab';
      if (m && m.material.emissive) m.material.emissive.setHex(0x1a4f9c);
      tip.style.opacity = m ? 1 : 0; if (m) tip.textContent = m.userData.panelName;
    }
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(mouse, camera);
      const hit = ray.intersectObjects(group.children.filter(c => c.userData.panelName), false)[0];
      setHover(hit ? hit.object : null); tip.style.transform = `translate(${e.clientX - r.left + 14}px,${e.clientY - r.top + 14}px)`;
    });
    canvas.addEventListener('pointerleave', () => setHover(null));
    canvas.addEventListener('dblclick', () => frameCamera(lastParams, lastResult));
    let lastParams = null, lastResult = null;
    function setTheme(isDark) {
      dark = !!isDark; applyWire();
      scene.background = new THREE.Color(isDark ? 0x111113 : 0xf7f7f9);
      grid.material.color && grid.material.color.setHex(isDark ? 0x2e2e33 : 0xdcdee3);
      hemi.groundColor.setHex(isDark ? 0x33363f : 0xb8bcc6);
    }
    function setView(name) {
      const t = controls ? controls.target.clone() : new THREE.Vector3(), d = camera.position.distanceTo(t);
      const v = { iso: [0.55, -0.7, 0.45], top: [0, -0.001, 1], front: [0, -1, 0.12], side: [1, 0, 0.12] }[name] || [0.55, -0.7, 0.45];
      const dir = new THREE.Vector3(...v).normalize().multiplyScalar(d).add(t);
      camAnim = { from: camera.position.clone(), to: dir, t0: performance.now() };
    }
    function setAutoRotate(on) { if (controls) controls.autoRotate = !!on; }
    function setGrid(on) { grid.visible = !!on; }
    let wire = false, dark = true;
    function applyWire() {
      for (const m of group.children) {
        if (!m.userData.panelName) continue;
        let e = m.userData.edges;
        if (wire && !e) {
          e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 12), new THREE.LineBasicMaterial({ color: 0xffffff }));
          m.add(e); m.userData.edges = e;
        }
        if (e) { e.visible = wire; e.material.color.setHex(dark ? 0x6cb4ff : 0x0a5fd0); }
        const mt = m.material; if (m.userData.wasT === undefined) { m.userData.wasT = mt.transparent; m.userData.wasO = mt.opacity; m.userData.wasW = mt.depthWrite; }
        mt.transparent = wire ? true : m.userData.wasT; mt.opacity = wire ? 0.07 : m.userData.wasO; mt.depthWrite = wire ? false : m.userData.wasW; mt.needsUpdate = true;
      }
    }
    function setWireframe(on) { wire = !!on; applyWire(); }

    function setExploded(on, amount) {
      tgt.ex = on ? amount : 0; tgt.lift = lastLift.on ? lastLift.amount : 0; applyOffsets(); return;
      for (const mesh of group.children) {
        const d = mesh.userData.explodeDir;
        const offset = on ? amount : 0;
        const lift = mesh.userData.liftable && lastLift.on ? lastLift.amount : 0; // detached lid/cover lifted off the body
        const m = mesh.userData.baseMatrix.clone();
        const translate = new THREE.Matrix4().makeTranslation(d[0] * offset, d[1] * offset, d[2] * offset + lift);
        mesh.matrix.identity();
        mesh.matrixAutoUpdate = false;
        mesh.matrix.multiplyMatrices(translate, m);
      }
    }

    function frameCamera(params, result) {
      let cx = params.length / 2, cy = params.width / 2, cz = params.height / 2;
      let sx = params.length, sy = params.width, sz = params.height;
      const ab = result && result.info && result.info.assembledBounds;
      if (ab) { // customBox: frame the whole assembly (lid, cover, base plate included)
        cx = (ab.min[0] + ab.max[0]) / 2; cy = (ab.min[1] + ab.max[1]) / 2; cz = (ab.min[2] + ab.max[2]) / 2;
        sx = ab.size[0]; sy = ab.size[1]; sz = ab.size[2] + (lastLift.on ? lastLift.amount : 0);
      }
      if (controls) controls.target.set(cx, cy, cz);
      const diag = Math.sqrt(sx ** 2 + sy ** 2 + sz ** 2);
      // narrow / portrait viewports see less horizontally: back the camera off so the whole box fits
      const aspect = camera.aspect || 1.6, k = aspect < 1.4 ? Math.min(2.4, 1.4 / aspect) : 1;
      camera.position.set(cx + diag * 0.9 * k, cy - diag * 1.1 * k, cz + diag * 0.7 * k);
      camera.near = diag * 0.01; camera.far = diag * 20;
      camera.updateProjectionMatrix();
    }

    function dispose() {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      renderer.dispose();
    }

    return { scene, camera, renderer, controls, group, buildFromResult, setExploded, resize, dispose, setTheme, setView, setAutoRotate, setGrid, setWireframe };
  }

  const Preview3D = { createScene, buildPanelMesh, panelFrame, frameFor, thicknessFor, explodeFor };

  if (typeof module !== 'undefined' && module.exports) module.exports = Preview3D;
  else root.Preview3D = Preview3D;
})(typeof window !== 'undefined' ? window : globalThis);
