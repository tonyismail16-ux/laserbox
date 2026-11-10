/**
 * assemblyExport.js — exports the cutting layout for the whole design or for
 * ONE assembly (body, dividers, lid, cover) on its own sheets. The body and
 * lid are never mixed into one another's files unless the whole design is
 * requested. Parts of different materials/thicknesses are always nested onto
 * different sheets (one file per sheet).
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const Vec2 = isNode ? require('../geometry/vec2.js') : root.Vec2;
  const Assembly = isNode ? require('../geometry/assembly.js') : root.Assembly;
  const SheetLayout = isNode ? require('../geometry/sheetLayout.js') : root.SheetLayout;
  const SvgExporter = isNode ? require('./svgExporter.js') : root.SvgExporter;
  const DxfExporter = isNode ? require('./dxfExporter.js') : root.DxfExporter;

  /** Assembly ids present in a result, in a stable display order. */
  function listAssemblies(result) {
    const order = ['body', 'dividers', 'bed', 'lid', 'cover'];
    const present = {};
    for (const p of result.panels) present[p.assemblyId || 'body'] = true;
    return order.filter(a => present[a]).concat(Object.keys(present).filter(a => order.indexOf(a) < 0));
  }

  /**
   * @param {object} result   BoxGenerator.generate() output
   * @param {object} sheet    { width, height, margin, spacing, allowRotation }
   * @param {string[]|null} assemblies  assembly ids to include, or null for everything
   * @param {string} baseName filename stem
   * @returns {{files: Array<{filename,svg,dxf,sheetIndex,label,assemblies:string[],partIds:string[]}>, layout}}
   */
  function exportAssemblies(result, sheet, assemblies, baseName, exportOpts) {
    baseName = baseName || 'design';
    const panels = assemblies ? result.panels.filter(p => assemblies.indexOf(p.assemblyId || 'body') >= 0) : result.panels;
    const items = panels.map(p => {
      const b = Vec2.bounds(p.outline);
      return { id: p.id, name: p.name, width: b.width, height: b.height, allowRotate: sheet.allowRotation, group: Assembly.sheetGroupKey(p), groupLabel: Assembly.sheetGroupLabel(p) };
    });
    const layout = SheetLayout.packGroups(items, sheet);
    const tag = assemblies ? assemblies.join('+') : 'all';
    const files = layout.sheets.map((s, i) => {
      const title = `Assembly: ${tag} | Sheet ${i + 1}/${layout.sheets.length}${s.groupLabel ? ' | ' + s.groupLabel : ''}`;
      const opts = { assemblies: assemblies || undefined, showLabels: !!(exportOpts && exportOpts.showLabels), title };
      return {
        filename: `${baseName}-${tag}-sheet${i + 1}`,
        svg: SvgExporter.exportSheetSvg(panels, s.placements, sheet, opts),
        dxf: DxfExporter.exportSheetDxf(panels, s.placements, Object.assign({ sheet }, opts)),
        sheetIndex: i, label: s.groupLabel, assemblies: assemblies || listAssemblies(result),
        partIds: s.placements.map(pl => pl.id),
      };
    });
    return { files, layout };
  }

  const AssemblyExport = { listAssemblies, exportAssemblies };
  if (isNode) module.exports = AssemblyExport;
  else root.AssemblyExport = AssemblyExport;
})(typeof window !== 'undefined' ? window : globalThis);
