// node examples/generate-feature-samples.js  — writes SVG + DXF samples for the new presets.
const fs = require('fs'), path = require('path');
const BG = require('../js/geometry/boxGenerator.js');
require('../js/geometry/customBox.js');
const Presets = require('../js/state/presets.js');
const AE = require('../js/export/assemblyExport.js');
const SHEET = { width: 600, height: 400, margin: 10, spacing: 4, allowRotation: true };
const base = { length: 200, width: 150, height: 60, thickness: 3, kerf: 0.15, materialId: 'ply3', materialName: '3mm Plywood', materialColor: '#c69a63', fingerMode: 'count', fingerCount: 7, minFingerWidth: 3, maxFingerWidth: 40, outlineCompensation: 'auto' };
const samples = {
  'sample-divider-box': 'div-4',
  'sample-detached-lid-box': 'lid-cap',
  'sample-divider-and-lid-box': 'combo-ring',
  'sample-acrylic-cover-box': 'lid-acrylic',
};
for (const [name, id] of Object.entries(samples)) {
  const preset = Presets.boxes.list().find(b => b.id === id);
  const r = BG.generate(Object.assign({}, base, preset.params));
  if (r.errors.length) throw new Error(name + ': ' + r.errors.map(e => e.message).join('; '));
  const { files } = AE.exportAssemblies(r, SHEET, null, name);
  files.forEach(f => {
    fs.writeFileSync(path.join(__dirname, f.filename + '.svg'), f.svg);
    fs.writeFileSync(path.join(__dirname, f.filename + '.dxf'), f.dxf);
    console.log(f.filename, f.label, f.partIds.join(','));
  });
}
