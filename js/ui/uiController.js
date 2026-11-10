/**
 * uiController.js — wires the DOM in index.html to State, and drives the
 * 2D / 3D / sheet-layout viewports. This file is the only one that touches
 * `document` directly for app chrome (preview2d.js/preview3d.js own their
 * own sub-DOM, i.e. the <svg>/<canvas> contents).
 */
(function () {
  'use strict';

  const State = window.State;
  const Presets = window.Presets;
  const ProjectIO = window.ProjectIO;
  const Preview2D = window.Preview2D;
  const Preview3D = window.Preview3D;
  const SvgExporter = window.SvgExporter;
  const DxfExporter = window.DxfExporter;
  const KerfTest = window.KerfTest;
  const Vec2 = window.Vec2;

  const $ = (id) => document.getElementById(id);

  let unit = 'mm';
  const UNIT_FACTOR = { mm: 1, cm: 10, in: 25.4 };
  const UNIT_DECIMALS = { mm: 2, cm: 3, in: 3 };
  function toDisplay(mm) { return mm / UNIT_FACTOR[unit]; }
  function toMM(v) { return v * UNIT_FACTOR[unit]; }
  function fmt(mm, decimals) {
    const v = toDisplay(mm);
    return v.toFixed(decimals !== undefined ? decimals : UNIT_DECIMALS[unit]) + ' ' + unit;
  }

  // id -> { group: 'params'|'sheet'|'machine', key, dimension: bool, type: 'number'|'int'|'text'|'checkbox'|'color'|'select' }
  const BINDINGS = [
    { id: 'length', group: 'params', key: 'length', dimension: true },
    { id: 'width', group: 'params', key: 'width', dimension: true },
    { id: 'height', group: 'params', key: 'height', dimension: true },
    { id: 'thickness', group: 'params', key: 'thickness', dimension: true },
    { id: 'kerf', group: 'params', key: 'kerf', dimension: true },
    { id: 'fingerCount', group: 'params', key: 'fingerCount', dimension: false, type: 'int' },
    { id: 'fingerWidth', group: 'params', key: 'fingerWidth', dimension: true },
    { id: 'minFingerWidth', group: 'params', key: 'minFingerWidth', dimension: true },
    { id: 'maxFingerWidth', group: 'params', key: 'maxFingerWidth', dimension: true },
    { id: 'boxType', group: 'params', key: 'boxType', type: 'select' },
    { id: 'lidStyle', group: 'params', key: 'lidStyle', type: 'select' },
    { id: 'bottomStyle', group: 'params', key: 'bottomStyle', type: 'select' },
    { id: 'fingerMode', group: 'params', key: 'fingerMode', type: 'select' },
    { id: 'outlineCompensation', group: 'params', key: 'outlineCompensation', type: 'select' },
    { id: 'materialColor', group: 'params', key: 'materialColor', type: 'color' },
    { id: 'sheetWidth', group: 'sheet', key: 'width', dimension: true },
    { id: 'sheetHeight', group: 'sheet', key: 'height', dimension: true },
    { id: 'sheetMargin', group: 'sheet', key: 'margin', dimension: true },
    { id: 'sheetSpacing', group: 'sheet', key: 'spacing', dimension: true },
    { id: 'allowRotation', group: 'sheet', key: 'allowRotation', type: 'checkbox' },
    { id: 'groupByMaterial', group: 'sheet', key: 'groupByMaterial', type: 'checkbox' },
    { id: 'machineCutSpeed', group: 'machine', key: 'speedCutMmPerMin', type: 'number' },
    { id: 'machinePasses', group: 'machine', key: 'passes', type: 'int' },
    // Sliding lid box
    { id: 'lidClearance', group: 'params', key: 'lidClearance', dimension: true },
    { id: 'horizontalClearance', group: 'params', key: 'horizontalClearance', dimension: true },
    { id: 'railSetbackFromFront', group: 'params', key: 'railSetbackFromFront', dimension: true },
    // Hinged box
    { id: 'hingeStyle', group: 'params', key: 'hingeStyle', type: 'select' },
    { id: 'lidOpening', group: 'params', key: 'lidOpening', type: 'select' },
    { id: 'hingeSegments', group: 'params', key: 'hingeSegments', type: 'select' },
    { id: 'hingeSegmentCount', group: 'params', key: 'hingeSegmentCount', type: 'int' },
    { id: 'hingeBandHeight', group: 'params', key: 'hingeBandHeight', dimension: true },
    { id: 'hingeSlitPitch', group: 'params', key: 'hingeSlitPitch', dimension: true },
    { id: 'knuckleCount', group: 'params', key: 'knuckleCount', type: 'int' },
    { id: 'pinHoleDiameter', group: 'params', key: 'pinHoleDiameter', dimension: true },
  ];

  // Params that can be null ("auto") and/or are nested objects — handled
  // outside the generic BINDINGS loop above.
  function bindNullableAndNestedParams() {
    const frontLowerEl = $('frontLowerAmount');
    frontLowerEl.addEventListener('input', () => {
      const v = frontLowerEl.value.trim();
      State.updateParams({ frontLowerAmount: v === '' ? null : toMM(parseFloat(v) || 0) });
    });
    const railWidthEl = $('railWidth');
    railWidthEl.addEventListener('input', () => {
      const v = railWidthEl.value.trim();
      State.updateParams({ railWidth: v === '' ? null : toMM(parseFloat(v) || 0) });
    });
    $('thumbPullEnabled').addEventListener('change', () => {
      const p = State.current.params;
      State.updateParams({ thumbPull: Object.assign({}, p.thumbPull, { enabled: $('thumbPullEnabled').checked }) });
    });
    $('thumbPullRadius').addEventListener('input', () => {
      const p = State.current.params;
      State.updateParams({ thumbPull: Object.assign({}, p.thumbPull, { radius: toMM(parseFloat($('thumbPullRadius').value) || 10) }) });
    });
  }

  function updateGroup(group, key, value) {
    if (group === 'params') State.updateParams({ [key]: value });
    else if (group === 'sheet') State.updateSheet({ [key]: value });
    else if (group === 'machine') State.update({ machine: Object.assign({}, State.current.machine, { [key]: value }) });
  }

  function refreshInputsFromState() {
    const s = State.current;
    for (const b of BINDINGS) {
      const el = $(b.id);
      if (!el) continue;
      const raw = s[b.group][b.key];
      if (b.type === 'checkbox') el.checked = !!raw;
      else if (b.type === 'color' || b.type === 'select') el.value = raw;
      else if (b.dimension) el.value = round(toDisplay(raw), UNIT_DECIMALS[unit]);
      else el.value = raw;
    }
    $('colorCut').value = s.layerColors.cut;
    $('colorEngrave').value = s.layerColors.engrave;
    $('debugMode').checked = s.ui.debugMode;
    document.title = `${s.project.name} — LaserBox Studio`;
    $('projectName').value = s.project.name;
    $('fingerCountField').hidden = s.params.fingerMode !== 'count';
    $('fingerWidthField').hidden = s.params.fingerMode !== 'width';

    // Nullable ("auto") + nested params
    $('frontLowerAmount').value = s.params.frontLowerAmount == null ? '' : round(toDisplay(s.params.frontLowerAmount), UNIT_DECIMALS[unit]);
    $('railWidth').value = s.params.railWidth == null ? '' : round(toDisplay(s.params.railWidth), UNIT_DECIMALS[unit]);
    $('thumbPullEnabled').checked = !!(s.params.thumbPull && s.params.thumbPull.enabled);
    $('thumbPullRadius').value = round(toDisplay((s.params.thumbPull && s.params.thumbPull.radius) || 10), UNIT_DECIMALS[unit]);

    refreshFeatureInputs();
    updateSectionVisibility();
  }

  // Cheap, side-effect-free visibility toggling — safe to call on EVERY
  // state change (unlike refreshInputsFromState, which re-writes input
  // values and would fight the user while they're actively typing).
  function updateSectionVisibility() {
    const s = State.current;
    $('slidingLidSection').hidden = s.params.boxType !== 'slidingLid';
    $('hingeSection').hidden = s.params.boxType !== 'hingedBox';
    updateFeatureVisibility();
    if (!$('slidingLidSection').hidden) $('slidingLidSection').open = true;
    if (!$('hingeSection').hidden) $('hingeSection').open = true;
    $('livingHingeFields').hidden = s.params.hingeStyle !== 'living';
    $('nodeHingeFields').hidden = s.params.hingeStyle !== 'node';
  }

  function round(v, d) { const f = Math.pow(10, d); return Math.round(v * f) / f; }

  function bindInputs() {
    for (const b of BINDINGS) {
      const el = $(b.id);
      if (!el) continue;
      el.addEventListener(b.type === 'select' || b.type === 'color' ? 'change' : 'input', () => {
        let value;
        if (b.type === 'checkbox') value = el.checked;
        else if (b.type === 'color' || b.type === 'select') value = el.value;
        else if (b.type === 'int') value = parseInt(el.value, 10) || 0;
        else if (b.dimension) value = toMM(parseFloat(el.value) || 0);
        else value = parseFloat(el.value) || 0;
        updateGroup(b.group, b.key, value);
      });
    }

    $('colorCut').addEventListener('change', () => State.update({ layerColors: Object.assign({}, State.current.layerColors, { cut: $('colorCut').value }) }));
    $('colorEngrave').addEventListener('change', () => State.update({ layerColors: Object.assign({}, State.current.layerColors, { engrave: $('colorEngrave').value }) }));
    $('debugMode').addEventListener('change', () => State.update({ ui: Object.assign({}, State.current.ui, { debugMode: $('debugMode').checked }) }));

    $('projectName').addEventListener('input', () => State.update({ project: Object.assign({}, State.current.project, { name: $('projectName').value }) }));

    document.querySelectorAll('.unit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        unit = btn.getAttribute('data-unit');
        document.querySelectorAll('.unit-btn').forEach(b => b.classList.toggle('active', b === btn));
        refreshInputsFromState();
        renderAll();
      });
    });
  }

  // ---------------- Presets ----------------
  function populatePresetSelects() {
    const matSel = $('materialPreset');
    matSel.innerHTML = Presets.materials.list().map(m => `<option value="${m.id}">${m.name}</option>`).join('');
    matSel.value = State.current.params.materialId;
    matSel.addEventListener('change', () => {
      const m = Presets.materials.list().find(x => x.id === matSel.value);
      if (!m) return;
      State.updateParams({ materialId: m.id, materialName: m.name, thickness: m.thickness, kerf: m.kerf, materialColor: m.color });
      refreshInputsFromState();
    });

    const machSel = $('machinePreset');
    machSel.innerHTML = Presets.machines.list().map(m => `<option value="${m.id}">${m.name}</option>`).join('');
    machSel.value = State.current.machine.id;
    machSel.addEventListener('change', () => {
      const m = Presets.machines.list().find(x => x.id === machSel.value);
      if (!m) return;
      State.update({ machine: Object.assign({}, State.current.machine, { id: m.id, name: m.name, speedCutMmPerMin: m.speedCutMmPerMin, speedEngraveMmPerMin: m.speedEngraveMmPerMin, passes: m.passes }) });
      refreshInputsFromState();
    });

    const boxSel = $('boxPreset');
    const _g = {}; Presets.boxes.list().forEach(b => { const k = b.id.indexOf('occ-') === 0 ? b.name.split(':')[0].split(' / ')[0] + ' & occasions' : (b.builtin ? 'Engineering' : 'My presets'); (_g[k] = _g[k] || []).push(b); });
    boxSel.innerHTML = '<option value="">Choose a preset…</option>' + Object.keys(_g).map(k => `<optgroup label="${k}">` + _g[k].map(b => `<option value="${b.id}">${b.name}</option>`).join('') + '</optgroup>').join('');
    if (activePresetId && !Presets.boxes.list().some(b => b.id === activePresetId)) activePresetId = null;
    boxSel.value = activePresetId || '';
    if (!boxSel.dataset.bound) {
      boxSel.dataset.bound = '1';
      boxSel.addEventListener('change', () => {
        if (!boxSel.value) { activePresetId = null; updatePresetIndicator(); return; }
        const b = Presets.boxes.list().find(x => x.id === boxSel.value);
        if (!b) return;
        activePresetId = b.id;
        const bedReset = window.InnerBed ? window.InnerBed.bedDefaults() : {};
        State.updateParams(Object.assign({ bodyHeightOffset: 0 }, bedReset, b.params));
        refreshInputsFromState();
        updatePresetIndicator();
      });
      $('btnSavePreset').addEventListener('click', () => {
        const name = prompt('Name this box preset:', State.current.project.name);
        if (!name) return;
        const id = 'user-' + Date.now();
        Presets.boxes.save({ id, name, params: Object.assign({}, State.current.params) });
        activePresetId = id;
        populatePresetSelects();
        toast('Preset saved.');
      });
    }
    updatePresetIndicator();
  }

  // The preset the user loaded stays shown (dropdown + header badge). It is
  // flagged "modified" as soon as any of the preset's parameters is edited.
  let activePresetId = null;
  function presetIsModified(b) {
    const cur = State.current.params;
    return Object.keys(b.params).some(k => JSON.stringify(cur[k]) !== JSON.stringify(b.params[k]));
  }
  function updatePresetIndicator() {
    const badge = $('presetBadge'), sel = $('boxPreset');
    if (!badge || !sel) return;
    const b = activePresetId ? Presets.boxes.list().find(x => x.id === activePresetId) : null;
    const opt = b ? [...sel.options].find(o => o.value === b.id) : null;
    // restore every label, then decorate the active one
    for (const o of sel.options) { const x = Presets.boxes.list().find(y => y.id === o.value); if (x) o.textContent = x.name; }
    if (!b) { badge.hidden = true; sel.value = ''; return; }
    const mod = presetIsModified(b);
    if (opt) { opt.textContent = (mod ? '● ' : '✓ ') + b.name + (mod ? ' (modified)' : ''); sel.value = b.id; }
    badge.hidden = false;
    badge.textContent = 'Preset: ' + b.name + (mod ? ' (modified)' : '');
    badge.title = mod ? 'Parameters were changed after loading this preset' : 'Box preset in use';
    badge.classList.toggle('modified', mod);
  }

  // ---------------- Viewport ----------------
  let scene3d = null;
  let viewer2d = null, viewerSheet = null;
  let currentSheetIndex = 0;

  function initViewports() {
    scene3d = Preview3D.createScene($('canvas3d')); window.LaserScene = scene3d;
    viewer2d = Preview2D.makeViewer($('svg2d'));
    viewerSheet = Preview2D.makeViewer($('svgSheet'));

    $('svg2d').addEventListener('click', onPanelClick);
    $('svgSheet').addEventListener('click', onPanelClick);
  }

  function onPanelClick(e) {
    const g = e.target.closest('.panel');
    if (!g) return;
    const id = g.getAttribute('data-part');
    selectPanel(id);
  }

  function currentView() { return document.querySelector('.view-tab.active').getAttribute('data-view'); }

  function switchView(view) {
    document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.getAttribute('data-view') === view));
    $('stage3d').hidden = view !== '3d';
    $('stage2d').hidden = view !== '2d';
    $('stageSheet').hidden = view !== 'sheet';
    renderAll();
  }

  function renderAll() {
    const { result, layout } = State.derived;
    const p = State.current.params;
    const ui = State.current.ui;
    const colors = State.current.layerColors;

    if (currentView() === '3d') {
      scene3d.buildFromResult(result, p, { exploded: ui.exploded, lidLifted: ui.lidLifted, hidden: {}, transparent: false });
      scene3d.resize();
    } else if (currentView() === '2d') {
      const bounds = Preview2D.renderPanelsGrid($('svg2d'), result.panels, { colors, showLabels: ui.showLabels, showGrid: ui.showGrid });
      if (!viewer2d._fitted) { viewer2d.fitTo(bounds); viewer2d._fitted = true; }
    } else if (currentView() === 'sheet') {
      currentSheetIndex = Math.min(currentSheetIndex, Math.max(layout.sheets.length - 1, 0));
      const sheetData = layout.sheets[currentSheetIndex];
      $('sheetLabel').textContent = `Sheet ${currentSheetIndex + 1} / ${layout.sheets.length}` + (sheetData ? ` · ${(sheetData.utilization * 100).toFixed(1)}% used` : '') + (sheetData && sheetData.groupLabel && layout.materialKeys && layout.materialKeys.length > 1 ? ' — ' + sheetData.groupLabel : '');
      if (sheetData) {
        const bounds = Preview2D.renderSheetLayout($('svgSheet'), result.panels, sheetData.placements, State.current.sheet, { colors, showLabels: ui.showLabels, showGrid: ui.showGrid });
        if (!viewerSheet._fitted) { viewerSheet.fitTo(bounds, 30); viewerSheet._fitted = true; }
      }
    }

    renderStats();
    renderWarnings();
    renderSelectedPanel();
    renderArtworkUI();
    highlightSelection();
  }

  function highlightSelection() {
    const sel = State.current.ui.selectedPanelId;
    document.querySelectorAll('.panel').forEach(g => {
      g.classList.toggle('selected', g.getAttribute('data-part') === sel);
    });
  }

  // ---------------- Stats / Warnings ----------------
  function renderStats() {
    const { info, layout } = State.derived;
    const p = State.current.params;
    const resEarly = State.derived.result;
    const effH = resEarly.info && resEarly.info.customBox ? resEarly.info.dims.bodyExternal.height : p.height;
    const rows = [
      ['Finished size', `${fmt(p.length,1)} × ${fmt(p.width,1)} × ${fmt(effH,1)}`],
      ['Material', `${p.materialName || 'Custom'} (${fmt(p.thickness)})`],
      ['Kerf', fmt(p.kerf, 3)],
      ['Parts', info.partCount],
      ['Total cut length', fmt(info.totalCutLength, 0)],
      ['Sheets needed', layout.totalSheets],
      ['Sheet utilization', (layout.utilization * 100).toFixed(1) + '%'],
      ['Est. waste area', fmt(layout.wasteArea, 0) + '²'],
    ];
    if (info.cutTimeMin !== null) rows.push(['Est. cut time', info.cutTimeMin.toFixed(1) + ' min']);
    const res = State.derived.result;
    if (res.info && res.info.customBox) {
      const d = res.info.dims;
      rows.push(['Internal space', `${fmt(d.bodyInternal.length, 1)} × ${fmt(d.bodyInternal.width, 1)} × ${fmt(d.bodyInternal.height, 1)}`]);
      if (d.assembled) rows.push(['Assembled (all parts)', `${fmt(d.assembled.length, 1)} × ${fmt(d.assembled.width, 1)} × ${fmt(d.assembled.height, 1)}`]);
      if (res.info.bed) rows.push(['Inner bed', `${fmt(res.info.bed.length, 1)} × ${fmt(res.info.bed.width, 1)} × ${fmt(res.info.bed.height, 1)} @ +${fmt(res.info.bed.elevation, 1)}`]);
      if (res.info.dividers && res.info.dividers.compartmentCount) rows.push(['Compartments', res.info.dividers.compartmentCount]);
      for (const a of Object.values(info.byAssembly)) rows.push([`Parts: ${a.assemblyId}`, a.parts]);
      for (const m of Object.values(info.byMaterial)) rows.push([`${m.materialName} ${m.thickness}mm`, `${(m.partArea / 100).toFixed(0)} cm² · ${m.sheets} sheet(s)`]);
    }
    // "294 mm × 194 mm × 94 mm" -> "294 × 194 × 94 mm" so dimensions never break mid-value
    $('statGrid').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${String(v).replace(/ (mm|cm|in) ×/g, ' ×')}</dd></div>`).join('');
  }

  function renderWarnings() {
    const issues = State.derived.issues;
    $('warnCount').textContent = issues.length;
    $('warnCount').classList.toggle('zero', issues.length === 0);
    if (!issues.length) {
      $('warningsList').innerHTML = '<li class="empty">No issues detected — geometry looks manufacturable.</li>';
      return;
    }
    $('warningsList').innerHTML = issues.map(i => `<li class="${i.severity}">${escapeHtml(i.message)}</li>`).join('');
  }

  function escapeHtml(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

  // ---------------- Panel selection / editing ----------------
  function selectPanel(id) {
    State.update({ ui: Object.assign({}, State.current.ui, { selectedPanelId: id }) });
  }

  function renderSelectedPanel() {
    const id = State.current.ui.selectedPanelId;
    const section = $('selectedPanelSection');
    if (!id) { section.hidden = true; return; }
    const panel = State.derived.result.panels.find(p => p.id === id);
    if (!panel) { section.hidden = true; return; }
    section.hidden = false;
    $('selectedPanelName').textContent = panel.name;
    $('selectedPanelDims').textContent = `${fmt(panel.W)} × ${fmt(panel.H)}  ·  ${(panel.cutouts||[]).length} cutout(s)  ·  ${(panel.engravings||[]).length} label(s)`;

    const nonArtworkCutouts = (panel.cutouts || []).filter(c => !c.artworkId);
    const nonArtworkEngravings = (panel.engravings || []).filter(e => !e.artworkId);

    $('cutoutList').innerHTML = nonArtworkCutouts.map((c, i) =>
      `<li><span>${c.type} @ (${c.x.toFixed(0)},${c.y.toFixed(0)})</span><button data-i="${i}" class="btn-del-cutout">✕</button></li>`
    ).join('') || '<li class="empty" style="background:none;border:none">None yet</li>';

    $('engraveList').innerHTML = nonArtworkEngravings.map((e, i) =>
      `<li><span>"${escapeHtml(e.text)}"</span><button data-i="${i}" class="btn-del-engrave">✕</button></li>`
    ).join('') || '<li class="empty" style="background:none;border:none">None yet</li>';

    section.querySelectorAll('.btn-del-cutout').forEach(btn => btn.addEventListener('click', () => {
      const removed = nonArtworkCutouts[parseInt(btn.dataset.i, 10)];
      const list = (panel.cutouts || []).filter(c => c !== removed);
      State.updatePanelOverride(id, { cutouts: list });
    }));
    section.querySelectorAll('.btn-del-engrave').forEach(btn => btn.addEventListener('click', () => {
      const removed = nonArtworkEngravings[parseInt(btn.dataset.i, 10)];
      const list = (panel.engravings || []).filter(e => e !== removed);
      State.updatePanelOverride(id, { engravings: list });
    }));
  }

  function addCutoutToSelected() {
    const id = State.current.ui.selectedPanelId;
    if (!id) { toast('Select a panel first (click one in 2D Panels view).'); return; }
    const panel = State.derived.result.panels.find(p => p.id === id);
    const type = $('cutoutType').value;
    const cx = panel.W / 2, cy = panel.H / 2;
    let cutout;
    if (type === 'circle') cutout = { type: 'circle', x: cx, y: cy, r: Math.min(panel.W, panel.H) * 0.15, layer: 'cut' };
    else if (type === 'rect') cutout = { type: 'rect', x: cx, y: cy, w: panel.W * 0.3, h: panel.H * 0.2, layer: 'cut' };
    else cutout = { type: 'slot', x: cx, y: cy, length: panel.W * 0.3, width: Math.min(panel.W, panel.H) * 0.08, layer: 'cut' };
    const list = (panel.cutouts || []).concat([cutout]);
    State.updatePanelOverride(id, { cutouts: list });
  }

  function addEngraveToSelected() {
    const id = State.current.ui.selectedPanelId;
    if (!id) { toast('Select a panel first (click one in 2D Panels view).'); return; }
    const panel = State.derived.result.panels.find(p => p.id === id);
    const text = $('engraveText').value || 'LABEL';
    const list = (panel.engravings || []).concat([{ type: 'text', x: 4, y: 4, text, size: 5 }]);
    State.updatePanelOverride(id, { engravings: list });
  }

  // ---------------- Toolbar ----------------
  function bindToolbar() {
    document.querySelectorAll('.view-tab').forEach(t => t.addEventListener('click', () => switchView(t.getAttribute('data-view'))));

    $('btnExploded').addEventListener('click', () => {
      const on = !State.current.ui.exploded;
      $('btnExploded').classList.toggle('active', on);
      State.update({ ui: Object.assign({}, State.current.ui, { exploded: on }) });
    });
    $('btnLiftLid').addEventListener('click', () => {
      const on = !State.current.ui.lidLifted;
      $('btnLiftLid').classList.toggle('active', on);
      State.update({ ui: Object.assign({}, State.current.ui, { lidLifted: on }) });
    });
    $('btnGrid').addEventListener('click', () => {
      const on = !State.current.ui.showGrid;
      $('btnGrid').classList.toggle('active', on);
      State.update({ ui: Object.assign({}, State.current.ui, { showGrid: on }) });
    });
    $('btnLabels').addEventListener('click', () => {
      const on = !State.current.ui.showLabels;
      $('btnLabels').classList.toggle('active', on);
      State.update({ ui: Object.assign({}, State.current.ui, { showLabels: on }) });
    });
    $('btnFit').addEventListener('click', () => {
      if (currentView() === '2d') { viewer2d._fitted = false; renderAll(); }
      else if (currentView() === 'sheet') { viewerSheet._fitted = false; renderAll(); }
      else { scene3d.resize(); $('canvas3d').dispatchEvent(new MouseEvent('dblclick')); } // re-frame the camera
    });
    $('btnPrevSheet').addEventListener('click', () => { currentSheetIndex = Math.max(0, currentSheetIndex - 1); viewerSheet._fitted = false; renderAll(); });
    $('btnNextSheet').addEventListener('click', () => { currentSheetIndex++; viewerSheet._fitted = false; renderAll(); });

    $('btnAddCutout').addEventListener('click', addCutoutToSelected);
    $('btnAddEngrave').addEventListener('click', addEngraveToSelected);
  }

  // ---------------- Project I/O ----------------
  function bindProjectActions() {
    $('btnNewProject').addEventListener('click', () => {
      if (confirm('Start a new project? Unsaved changes will be lost.')) {
        State.reset();
        activePresetId = null;
        refreshInputsFromState();
        populatePresetSelects();
        resetFitFlags();
        renderAll();
      }
    });

    $('btnSaveProject').addEventListener('click', () => {
      const json = JSON.stringify(ProjectIO.serialize(State.current), null, 2);
      ProjectIO.downloadText(sanitizeFilename(State.current.project.name) + '.json', json, 'application/json');
    });

    $('btnLoadProject').addEventListener('click', () => {
      ProjectIO.promptUploadJson((data) => {
        const newState = ProjectIO.deserialize(data);
        State.replaceState(newState);
        activePresetId = null;
        refreshInputsFromState();
        populatePresetSelects();
        resetFitFlags();
        renderAll();
        toast('Project loaded.');
      }, (err) => toast('Could not load project: ' + err.message));
    });

    $('btnResetProject').addEventListener('click', () => {
      if (confirm('Reset all parameters to defaults?')) {
        State.reset();
        refreshInputsFromState();
        resetFitFlags();
        renderAll();
      }
    });
  }

  function resetFitFlags() { if (viewer2d) viewer2d._fitted = false; if (viewerSheet) viewerSheet._fitted = false; currentSheetIndex = 0; }

  function sanitizeFilename(s) { return (s || 'project').replace(/[^a-z0-9_\- ]/gi, '').trim().replace(/\s+/g, '-') || 'project'; }


  // ---------------- Box features (dividers / detached lid / cover) ----------------
  // kind: num | nullnum (blank = null/auto) | int | text | bool | select
  const FEATURE_FIELDS = [
    ['shapeType', 'select'], ['shapeWall', 'num'], ['shapeLidClearance', 'num'], ['shapeEngraveText', 'text'],
    ['bodyHeightOffset', 'nullnum'], ['bedEnabled', 'bool'], ['bedStyle', 'select'], ['bedFlipped', 'bool'], ['bedOnFloor', 'bool'], ['bedHeight', 'nullnum'],
    ['bedElevation', 'num'], ['bedPocketFit', 'num'], ['bedLayers', 'int'], ['bedBacking', 'bool'], ['bedBackingMargin', 'num'], ['bedTallItemMin', 'num'], ['bedClearance', 'num'], ['bedThickness', 'nullnum'],
    ['dividersEnabled', 'bool'], ['dividerPattern', 'select'], ['dividerMount', 'select'],
    ['dividerCountX', 'int'], ['dividerCountY', 'int'], ['customColumnWidths', 'text'], ['customRowDepths', 'text'],
    ['dividerHeight', 'nullnum'], ['dividerThickness', 'nullnum'], ['dividerClearance', 'num'], ['dividerSlotFit', 'num'],
    ['liftLidStyle', 'select'], ['liftLidClearance', 'num'], ['liftLidOverhang', 'num'], ['liftLidSkirtDepth', 'num'], ['liftLidSkirtOffset', 'nullnum'], ['liftLidInsetDepth', 'nullnum'], ['lidKerf', 'nullnum'], ['bedKerf', 'nullnum'], ['dividerKerf', 'nullnum'], ['liftLidRise', 'num'],
    ['liftLidLocator', 'select'], ['liftLidJoint', 'select'], ['lidThickness', 'nullnum'], ['liftLidEngraveText', 'text'],
    ['coverThickness', 'num'], ['coverWidth', 'nullnum'], ['coverDepth', 'nullnum'], ['coverHeight', 'nullnum'],
    ['coverSeat', 'select'], ['coverClearance', 'num'], ['coverSidewalls', 'bool'],
  ];
  const MATERIAL_SELECTS = [['dividerMaterialSel', 'divider', true], ['bedMaterialSel', 'bed', true], ['lidMaterialSel', 'lid', true], ['coverMaterialSel', 'cover', false]];

  function bindFeatureControls() {
    for (const [key, kind] of FEATURE_FIELDS) {
      const el = $(key);
      if (!el) continue;
      el.addEventListener(kind === 'select' || kind === 'bool' ? 'change' : 'input', () => {
        let v;
        if (kind === 'bool') v = el.checked;
        else if (kind === 'select' || kind === 'text') v = el.value;
        else if (kind === 'int') v = parseInt(el.value, 10);
        else if (kind === 'nullnum') v = el.value.trim() === '' ? null : parseFloat(el.value);
        else v = parseFloat(el.value);
        if (v !== null && typeof v === 'number' && isNaN(v)) v = NaN; // surfaced by the validator, never silently replaced
        State.updateParams({ [key]: v });
      });
    }
    $('bedEnabled').addEventListener('change', () => {
      const p = State.current.params;
      if (p.bedEnabled && p.boxType !== 'customBox') {
        State.updateParams({ boxType: 'customBox' });
        refreshInputsFromState();
        toast('Switched to the "Box with Dividers / Detached Lid" type to support the inner bed.');
      }
    });
    for (const [selId, comp, allowSame] of MATERIAL_SELECTS) {
      const sel = $(selId);
      sel.innerHTML = (allowSame ? '<option value="">Same as body</option>' : '') +
        Presets.materials.list().map(m => `<option value="${m.id}">${m.name}</option>`).join('');
      sel.addEventListener('change', () => {
        const m = Presets.materials.list().find(x => x.id === sel.value);
        if (!m) {
          State.updateParams({ [comp + 'MaterialId']: null, [comp + 'MaterialName']: null, [comp + 'MaterialColor']: null, [comp + 'Thickness']: null, [comp + 'Kerf']: null });
        } else {
          State.updateParams({ [comp + 'MaterialId']: m.id, [comp + 'MaterialName']: m.name, [comp + 'MaterialColor']: m.color, [comp + 'Thickness']: m.thickness, [comp + 'Kerf']: m.kerf });
        }
        refreshInputsFromState();
      });
    }
    $('btnExportAsmSvg').addEventListener('click', () => exportAssembly('svg'));
    $('btnExportAsmDxf').addEventListener('click', () => exportAssembly('dxf'));
  }

  function refreshFeatureInputs() {
    const p = State.current.params;
    for (const [key, kind] of FEATURE_FIELDS) {
      const el = $(key);
      if (!el) continue;
      const v = p[key];
      if (kind === 'bool') el.checked = !!v;
      else el.value = v === null || v === undefined ? '' : v;
    }
    for (const [selId, comp] of MATERIAL_SELECTS) $(selId).value = p[comp + 'MaterialId'] || '';
    refreshExportSelect();
  }

  function refreshExportSelect() {
    const asm = window.AssemblyExport.listAssemblies(State.derived.result);
    const sel = $('exportAssemblySel');
    const sig = asm.join(',');
    if (sel.getAttribute('data-sig') === sig) return;
    const keep = sel.value;
    sel.innerHTML = '<option value="all">Whole design (all assemblies)</option>' + asm.map(a => `<option value="${a}">${window.Assembly.ASSEMBLIES[a] || a} only</option>`).join('');
    sel.setAttribute('data-sig', sig);
    sel.value = asm.indexOf(keep) >= 0 || keep === 'all' ? keep : 'all';
  }

  function updateBedUi(p) {
    $('bedFields').hidden = !p.bedEnabled;
    $('bedHeightField').hidden = p.bedStyle === 'plate';
    $('bedFlippedField').hidden = p.bedStyle === 'plate' || !!p.bedOnFloor;
    const bh = $('bedHint');
    const bi = p.bedEnabled ? State.derived.result.info && State.derived.result.info.bed : null;
    bh.textContent = bi ? `Bed ${bi.length.toFixed(1)} × ${bi.width.toFixed(1)}${bi.style === 'tray' ? ' × ' + bi.height.toFixed(1) + (bi.autoHeight ? ' (auto)' : '') : ''} mm${bi.flipped ? ', upside down' : ''}${bi.doubleLayer ? `, double layer on ${bi.backingCount} item${bi.backingCount === 1 ? '' : 's'} (${bi.backingThickness} mm backing patch${bi.backingCount === 1 ? '' : 'es'} glued underneath)` : ''}, top ${bi.topAboveFloor.toFixed(1)} mm above the floor (${bi.headroomAbove >= 0 ? bi.headroomAbove.toFixed(1) + ' mm below the rim' : (-bi.headroomAbove).toFixed(1) + ' mm ABOVE the rim'}).` : '';
  }

  function updateFeatureVisibility() {
    const p = State.current.params;
    const bedOk = ['customBox', 'finger6', 'finger5open'].indexOf(p.boxType) >= 0;
    $('bedSection').hidden = !bedOk;
    if (bedOk) updateBedUi(p);
    $('shapeSection').hidden = p.boxType !== 'shapeBox';
    $('featureSection').hidden = p.boxType !== 'customBox';
    if (p.boxType !== 'customBox') return;
    refreshExportSelect();
    $('dividerFields').hidden = !p.dividersEnabled;
    $('dividerCustomFields').hidden = p.dividerPattern !== 'custom';
    $('dividerCountX').closest('.field-row').hidden = p.dividerPattern === 'custom';
    const st = p.liftLidStyle;
    $('lidFields').hidden = st === 'none';
    $('coverFields').hidden = st !== 'acrylicCover';
    const skirtEff = (Number(p.liftLidSkirtDepth) || 0) + (Number(p.liftLidSkirtOffset) || 0);
    const inner = st === 'cap' && skirtEff < 0;
    $('lidOverhangField').hidden = !(st === 'flat' || inner);
    const lidHint = $('lidSkirtHint');
    lidHint.hidden = st !== 'cap' && st !== 'inset';
    const kh = $('lidKerfHint'), li = State.derived.result.info && State.derived.result.info.lid;
    kh.hidden = !(li && li.netGapPerSide !== undefined);
    if (!kh.hidden) {
      const where = li.inward ? 'between the lid and the base walls' : 'between the cap and the body';
      kh.textContent = `Lid kerf ${Number(li.kerf).toFixed(3)} mm (outline “${p.outlineCompensation}”): fit gap after cutting ≈ ${li.netGapPerSide.toFixed(2)} mm per side ${where}, clearance set to ${li.clearancePerSide} mm.`;
    }
    if (st === 'inset') {
      const Hi = (Number(p.height) || 0) + (Number(p.bodyHeightOffset) || 0) - 2 * (Number(p.thickness) || 0);
      lidHint.textContent = `Inset lid: smaller than the base, sits inside its opening ${p.liftLidInsetDepth === null ? 'on the bed (auto depth)' : p.liftLidInsetDepth + ' mm deep'} and stands ${p.liftLidRise} mm above the rim (internal height ${Hi.toFixed(1)} mm).`;
    }
    if (st === 'cap') {
      const H = (Number(p.height) || 0) + (Number(p.bodyHeightOffset) || 0);
      lidHint.textContent = skirtEff === 0 ? 'Effective skirt is 0 — use a positive value (outer skirt) or negative (inner collar).'
        : inner ? `Effective skirt ${skirtEff} mm: INNER collar ${Math.abs(skirtEff)} mm deep hangs inside the body under a flat plate.`
        : skirtEff > H ? `Effective skirt ${skirtEff} mm: outer skirt, ${(skirtEff - H).toFixed(1)} mm deeper than the body (hangs below the base).`
        : `Effective skirt ${skirtEff} mm: outer skirt around the body.`;
    }
    const eh = (Number(p.height) || 0) + (Number(p.bodyHeightOffset) || 0);
    $('bodyHeightHint').textContent = `Effective body height = ${eh} mm (Height + offset). Negative makes the body shorter; lid, dividers and bed follow.`;
    $('lidLocatorField').hidden = st !== 'flat' && !(st === 'acrylicCover' && !p.coverSidewalls);
    $('lidSkirtField').hidden = st !== 'cap';
    $('lidSkirtOffsetField').hidden = st !== 'cap';
    $('lidInsetFields').hidden = st !== 'inset';
    $('lidJointField').hidden = st !== 'cap' && st !== 'inset';
    $('btnLiftLid').hidden = st === 'none';
  }

  function exportAssembly(kind) {
    const sel = $('exportAssemblySel').value;
    const assemblies = sel === 'all' ? null : [sel];
    const stem = sanitizeFilename(State.current.project.name);
    const { files } = window.AssemblyExport.exportAssemblies(State.derived.result, State.current.sheet, assemblies, stem, { showLabels: exportLabels() });
    if (!files.length) { toast('Nothing to export yet.'); return; }
    files.forEach((f, i) => setTimeout(() => {
      if (kind === 'svg') ProjectIO.downloadText(f.filename + '.svg', f.svg, 'image/svg+xml');
      else ProjectIO.downloadText(f.filename + '.dxf', f.dxf, 'application/dxf');
    }, i * 250));
    toast(`Exporting ${files.length} ${kind.toUpperCase()} file(s)…`);
  }

  // ---------------- Export ----------------
  // "Include part labels" switch in the Export menu (persisted)
  function exportLabels() { return $('exportLabels') ? $('exportLabels').checked : true; }

  function bindExport() {
    try { const v = localStorage.getItem('lb-export-labels'); if (v !== null) $('exportLabels').checked = v === '1'; } catch (e) {}
    $('exportLabels').addEventListener('change', () => { try { localStorage.setItem('lb-export-labels', $('exportLabels').checked ? '1' : '0'); } catch (e) {} });
    $('btnExportSvg').addEventListener('click', () => {
      const { result, layout } = State.derived;
      const sheetData = layout.sheets[currentSheetIndex] || layout.sheets[0];
      if (!sheetData) { toast('Nothing to export yet.'); return; }
      const svg = SvgExporter.exportSheetSvg(result.panels, sheetData.placements, State.current.sheet, { colors: State.current.layerColors, showLabels: exportLabels() });
      ProjectIO.downloadText(sanitizeFilename(State.current.project.name) + `-sheet${currentSheetIndex + 1}.svg`, svg, 'image/svg+xml');
    });

    $('btnExportDxf').addEventListener('click', () => {
      const { result, layout } = State.derived;
      const sheetData = layout.sheets[currentSheetIndex] || layout.sheets[0];
      if (!sheetData) { toast('Nothing to export yet.'); return; }
      const dxf = DxfExporter.exportSheetDxf(result.panels, sheetData.placements, { showLabels: exportLabels(), sheet: State.current.sheet });
      ProjectIO.downloadText(sanitizeFilename(State.current.project.name) + `-sheet${currentSheetIndex + 1}.dxf`, dxf, 'application/dxf');
    });

    $('btnExportPanelSvg').addEventListener('click', () => {
      const id = State.current.ui.selectedPanelId;
      if (!id) { toast('Select a panel first (click one in 2D Panels view).'); return; }
      const panel = State.derived.result.panels.find(p => p.id === id);
      const svg = SvgExporter.exportPanelSvg(panel, { colors: State.current.layerColors, showLabels: exportLabels() });
      ProjectIO.downloadText(`${sanitizeFilename(panel.name)}.svg`, svg, 'image/svg+xml');
    });

    $('btnKerfTest').addEventListener('click', () => {
      const t = State.current.params.thickness;
      const { svg } = KerfTest.generate({ thickness: t });
      ProjectIO.downloadText('kerf-calibration.svg', svg, 'image/svg+xml');
      toast('Kerf calibration pattern downloaded — cut it, then match tabs to slots.');
    });
  }

  // ---------------- Artwork upload & mapping ----------------
  let selectedArtworkId = null;

  function bindArtwork() {
    $('btnUploadArtwork').addEventListener('click', () => $('artworkFileInput').click());
    $('artworkFileInput').addEventListener('change', () => {
      const file = $('artworkFileInput').files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = window.ArtworkImporter.parseFile(file.name, reader.result);
          if (!parsed.subpaths.length) { toast('No vector geometry found in that file.'); return; }
          const panels = State.derived.result.panels;
          const targetPanel = panels.find(p => p.id === State.current.ui.selectedPanelId) || panels[0];
          const fitS = window.ArtworkMapper.fitScale({ source: parsed }, targetPanel.W * 0.6, targetPanel.H * 0.6);
          const instance = window.ArtworkMapper.defaultInstance({
            name: file.name, panelId: targetPanel.id, source: parsed,
            x: targetPanel.W / 2, y: targetPanel.H / 2, scale: fitS,
          });
          selectedArtworkId = instance.id;
          State.addArtwork(instance);
          toast(`Imported "${file.name}" onto ${targetPanel.name}.`);
        } catch (err) {
          toast('Could not read that file: ' + err.message);
        }
        $('artworkFileInput').value = '';
      };
      reader.readAsText(file);
    });

    const liveField = (id, patchFn) => $(id).addEventListener('input', () => {
      if (!selectedArtworkId) return;
      State.updateArtwork(selectedArtworkId, patchFn());
    });
    liveField('artworkX', () => ({ x: toMM(parseFloat($('artworkX').value) || 0) }));
    liveField('artworkY', () => ({ y: toMM(parseFloat($('artworkY').value) || 0) }));
    liveField('artworkScale', () => ({ scale: parseFloat($('artworkScale').value) || 1 }));
    liveField('artworkRotation', () => ({ rotation: parseFloat($('artworkRotation').value) || 0 }));
    $('artworkPanel').addEventListener('change', () => selectedArtworkId && State.updateArtwork(selectedArtworkId, { panelId: $('artworkPanel').value }));
    $('artworkOperation').addEventListener('change', () => selectedArtworkId && State.updateArtwork(selectedArtworkId, { operation: $('artworkOperation').value }));
    $('artworkMirrorX').addEventListener('change', () => selectedArtworkId && State.updateArtwork(selectedArtworkId, { mirrorX: $('artworkMirrorX').checked }));
    $('artworkMirrorY').addEventListener('change', () => selectedArtworkId && State.updateArtwork(selectedArtworkId, { mirrorY: $('artworkMirrorY').checked }));

    $('btnFitArtwork').addEventListener('click', () => {
      if (!selectedArtworkId) return;
      const inst = State.current.artwork.find(a => a.id === selectedArtworkId);
      const panel = State.derived.result.panels.find(p => p.id === inst.panelId);
      if (!inst || !panel) return;
      const s = window.ArtworkMapper.fitScale(inst, panel.W * 0.8, panel.H * 0.8);
      State.updateArtwork(selectedArtworkId, { scale: s, x: panel.W / 2, y: panel.H / 2, rotation: 0 });
    });
    $('btnDeleteArtwork').addEventListener('click', () => {
      if (!selectedArtworkId) return;
      const id = selectedArtworkId;
      selectedArtworkId = null;
      State.removeArtwork(id);
    });
  }

  function selectArtwork(id) { selectedArtworkId = id; renderArtworkUI(); }

  function renderArtworkUI() {
    const list = State.current.artwork;
    $('artworkList').innerHTML = list.map(a =>
      `<li class="${a.id === selectedArtworkId ? 'selected' : ''}" data-id="${a.id}">` +
      `<span>${escapeHtml(a.name)} · ${a.operation}</span><button data-del="${a.id}">✕</button></li>`
    ).join('') || '<li class="empty" style="background:none;border:none">None uploaded yet</li>';

    $('artworkList').querySelectorAll('li[data-id]').forEach(li => li.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      selectArtwork(li.getAttribute('data-id'));
    }));
    $('artworkList').querySelectorAll('button[data-del]').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-del');
      if (selectedArtworkId === id) selectedArtworkId = null;
      State.removeArtwork(id);
    }));

    const inst = list.find(a => a.id === selectedArtworkId);
    $('artworkEditor').hidden = !inst;
    if (!inst) return;

    const panels = State.derived.result.panels;
    $('artworkPanel').innerHTML = panels.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    $('artworkPanel').value = inst.panelId;
    $('artworkOperation').value = inst.operation;
    $('artworkX').value = round(toDisplay(inst.x), UNIT_DECIMALS[unit]);
    $('artworkY').value = round(toDisplay(inst.y), UNIT_DECIMALS[unit]);
    $('artworkScale').value = inst.scale;
    $('artworkRotation').value = inst.rotation;
    $('artworkMirrorX').checked = !!inst.mirrorX;
    $('artworkMirrorY').checked = !!inst.mirrorY;
  }

  // ---------------- Misc ----------------
  let toastTimer = null;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  function init() {
    bindInputs();
    bindNullableAndNestedParams();
    bindToolbar();
    bindProjectActions();
    bindExport();
    bindFeatureControls();
    bindArtwork();
    populatePresetSelects();
    initViewports();

    const saved = ProjectIO.loadFromLocalStorage();
    if (saved) State.replaceState(saved);

    refreshInputsFromState();
    switchView('3d');
    renderAll();

    State.subscribe(() => {
      ProjectIO.saveToLocalStorage(State.current);
      updateSectionVisibility();
      updatePresetIndicator();
      renderAll();
    });
  }

  window.UIController = { init };
})();
