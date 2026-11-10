/**
 * projectIO.js — project JSON serialization + browser file helpers.
 * The project format is intentionally simple: it's just the serializable
 * parts of the app state (params, sheet, machine, layer colors, panel
 * overrides, project metadata). No geometry is stored — it's always
 * regenerated from parameters, guaranteeing the loaded project matches
 * exactly what a fresh generation from those parameters produces.
 */
(function (root) {
  'use strict';

  // v1: original single-material projects.
  // v2: adds box-feature parameters (dividers, detached lid, display cover) and
  //     per-component materials. v1 files load unchanged: missing keys take the
  //     feature defaults (all features off), see migrate().
  const PROJECT_VERSION = 2;

  function serialize(state) {
    return {
      formatVersion: PROJECT_VERSION,
      app: 'LaserBox Studio',
      copyright: (typeof window !== 'undefined' ? window.Branding : require('../branding.js')).notice(),
      project: state.project,
      params: state.params,
      sheet: state.sheet,
      machine: state.machine,
      layerColors: state.layerColors,
      panelOverrides: state.panelOverrides,
      artwork: state.artwork || [],
      ui: { view: state.ui.view, showLabels: state.ui.showLabels, lidLifted: !!state.ui.lidLifted },
    };
  }

  /** Upgrade an older project JSON to the current schema (non-destructive, returns a copy). */
  function migrate(input) {
    const data = JSON.parse(JSON.stringify(input));
    const from = data.formatVersion || 1;
    if (from > PROJECT_VERSION) throw new Error(`This project was saved by a newer version (format ${from}); this build understands up to format ${PROJECT_VERSION}.`);
    if (from < 2) {
      data.params = data.params || {};
      // Old projects predate every feature flag: make "no dividers, no detached lid"
      // explicit so the legacy box type behaves exactly as when it was saved.
      if (data.params.dividersEnabled === undefined) data.params.dividersEnabled = false;
      if (data.params.liftLidStyle === undefined) data.params.liftLidStyle = 'none';
      data.ui = Object.assign({ lidLifted: false }, data.ui || {});
    }
    data.formatVersion = PROJECT_VERSION;
    return data;
  }

  function deserialize(json) {
    const raw = typeof json === 'string' ? JSON.parse(json) : json;
    if (!raw || typeof raw !== 'object') throw new Error('Not a valid project file.');
    const data = migrate(raw);
    const base = root.State.defaultState();
    return Object.assign(base, {
      project: Object.assign(base.project, data.project || {}),
      params: Object.assign(base.params, data.params || {}),
      sheet: Object.assign(base.sheet, data.sheet || {}),
      machine: Object.assign(base.machine, data.machine || {}),
      layerColors: Object.assign(base.layerColors, data.layerColors || {}),
      panelOverrides: data.panelOverrides || {},
      artwork: data.artwork || [],
      ui: Object.assign(base.ui, data.ui || {}),
    });
  }

  function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function promptUploadJson(onLoad, onError) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try { onLoad(JSON.parse(reader.result)); }
        catch (e) { if (onError) onError(e); }
      };
      reader.onerror = () => onError && onError(reader.error);
      reader.readAsText(file);
    };
    input.click();
  }

  const LS_LAST_PROJECT = 'laserbox.lastProject';

  function saveToLocalStorage(state) {
    try { localStorage.setItem(LS_LAST_PROJECT, JSON.stringify(serialize(state))); return true; }
    catch (e) { return false; }
  }
  function loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(LS_LAST_PROJECT);
      return raw ? deserialize(raw) : null;
    } catch (e) { return null; }
  }

  const ProjectIO = { serialize, deserialize, migrate, downloadText, promptUploadJson, saveToLocalStorage, loadFromLocalStorage, PROJECT_VERSION };

  if (typeof module !== 'undefined' && module.exports) module.exports = ProjectIO;
  else root.ProjectIO = ProjectIO;
})(typeof window !== 'undefined' ? window : globalThis);
