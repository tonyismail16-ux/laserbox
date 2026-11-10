/**
 * presets.js — built-in material/box presets plus a thin localStorage-backed
 * store so users can save their own. Presets are just plain data; editing
 * one is editing a JS object, no special-casing required.
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const CustomBox = isNode ? require('../geometry/customBox.js') : root.CustomBox;

  const LS_MATERIALS = 'laserbox.presets.materials';
  const LS_BOXES = 'laserbox.presets.boxes';
  const LS_MACHINES = 'laserbox.presets.machines';

  const BUILTIN_MATERIALS = [
    { id: 'ply3', name: '3mm Plywood', thickness: 3, kerf: 0.15, color: '#c69a63', builtin: true },
    { id: 'ply4', name: '4mm Plywood', thickness: 4, kerf: 0.18, color: '#b98950', builtin: true },
    { id: 'ply6', name: '6mm Plywood', thickness: 6, kerf: 0.2, color: '#a97a42', builtin: true },
    { id: 'mdf3', name: '3mm MDF', thickness: 3, kerf: 0.12, color: '#8a6d4b', builtin: true },
    { id: 'acrylic2', name: '2mm Acrylic (clear)', thickness: 2, kerf: 0.08, color: '#bfe3f0', transparent: true, builtin: true },
    { id: 'acrylic3', name: '3mm Acrylic', thickness: 3, kerf: 0.1, color: '#bfe3f0', transparent: true, builtin: true },
    { id: 'acrylic5', name: '5mm Acrylic', thickness: 5, kerf: 0.12, color: '#a9d8ea', transparent: true, builtin: true },
    { id: 'cardboard', name: 'Cardboard (single wall)', thickness: 3, kerf: 0.3, color: '#c8a878', builtin: true },
  ];

  const BUILTIN_BOXES = [
    {
      id: 'small-gift', name: 'Small Gift Box', builtin: true,
      params: { boxType: 'finger6', length: 100, width: 80, height: 50, fingerMode: 'count', fingerCount: 5 },
    },
    {
      id: 'medium-gift', name: 'Medium Gift Box', builtin: true,
      params: { boxType: 'finger6', length: 180, width: 130, height: 80, fingerMode: 'count', fingerCount: 7 },
    },
    {
      id: 'large-storage', name: 'Large Storage Box', builtin: true,
      params: { boxType: 'finger6', length: 400, width: 300, height: 200, fingerMode: 'width', fingerWidth: 20 },
    },
    {
      id: 'open-tray', name: 'Open Tray (sliding/open lid)', builtin: true,
      params: { boxType: 'finger5open', length: 250, width: 180, height: 60, fingerMode: 'count', fingerCount: 8 },
    },
    {
      id: 'jewelry', name: 'Jewelry Box', builtin: true,
      params: { boxType: 'finger6', length: 150, width: 100, height: 60, thickness: 3, fingerMode: 'count', fingerCount: 6 },
    },
  ];

  // ---- Box-feature presets (Box with Dividers / Box with Detached Lid) -------
  // Each is a full parameter set for the SAME `customBox` builder — starting
  // configurations, not separate geometry. Every feature key is reset to its
  // default first so loading a preset never inherits a previous design's lid
  // or divider settings.
  const F = (o) => Object.assign({ boxType: 'customBox', lidStyle: 'none', bottomStyle: 'flat', fingerMode: 'count', fingerCount: 7 },
    CustomBox ? CustomBox.featureDefaults() : {}, o);

  const FEATURE_BOXES = [
    { id: 'div-2', name: 'Divider Box: 2-compartment gift box', builtin: true, params: F({ length: 180, width: 120, height: 55, dividersEnabled: true, dividerPattern: 'columns', dividerCountX: 1, dividerThickness: 3 }) },
    { id: 'div-4', name: 'Divider Box: 4-compartment organizer', builtin: true, params: F({ length: 200, width: 150, height: 60, dividersEnabled: true, dividerPattern: 'grid', dividerCountX: 1, dividerCountY: 1 }) },
    { id: 'div-6', name: 'Divider Box: 6-compartment product box', builtin: true, params: F({ length: 240, width: 160, height: 60, dividersEnabled: true, dividerPattern: 'grid', dividerCountX: 2, dividerCountY: 1, dividerThickness: 3 }) },
    { id: 'div-3x3', name: 'Divider Box: 3 × 3 organizer grid', builtin: true, params: F({ length: 240, width: 240, height: 50, dividersEnabled: true, dividerPattern: 'grid', dividerCountX: 2, dividerCountY: 2, dividerThickness: 2 }) },
    { id: 'div-custom', name: 'Divider Box: custom layout (40 / 0 / 30 mm columns)', builtin: true, params: F({ length: 200, width: 120, height: 55, dividersEnabled: true, dividerPattern: 'custom', customColumnWidths: '40,0,30', customRowDepths: '', dividerThickness: 3 }) },
    { id: 'lid-flat', name: 'Detached Lid: flat lift-off lid', builtin: true, params: F({ length: 160, width: 110, height: 50, liftLidStyle: 'flat', liftLidLocator: 'plug', liftLidClearance: 0.3 }) },
    { id: 'lid-cap', name: 'Detached Lid: cap-style lid', builtin: true, params: F({ length: 160, width: 110, height: 50, liftLidStyle: 'cap', liftLidSkirtDepth: 18, liftLidClearance: 0.3 }) },
    { id: 'lid-collar', name: 'Detached Lid: inner collar lid (negative skirt)', builtin: true, params: F({ length: 160, width: 110, height: 50, liftLidStyle: 'cap', liftLidSkirtDepth: -12, liftLidClearance: 0.3 }) },
    { id: 'bed-tray', name: 'Inner Bed: raised tray insert in a cap-lid box', builtin: true, params: F({ length: 200, width: 150, height: 60, bedEnabled: true, bedStyle: 'tray', bedHeight: 18, bedElevation: 15, liftLidStyle: 'cap', liftLidSkirtDepth: 18 }) },
    { id: 'bed-platform', name: 'Inner Bed: upside-down tray (raised platform) in a cap-lid box', builtin: true, params: F({ length: 200, width: 150, height: 60, bedEnabled: true, bedStyle: 'tray', bedFlipped: true, bedHeight: 18, bedElevation: 0, liftLidStyle: 'cap', liftLidSkirtDepth: 18 }) },
    { id: 'bed-plate', name: 'Inner Bed: flat false floor + deep outer skirt', builtin: true, params: F({ length: 200, width: 150, height: 60, bedEnabled: true, bedStyle: 'plate', bedElevation: 25, liftLidStyle: 'cap', liftLidSkirtDepth: 75 }) },
    { id: 'rev-deep-flat', name: 'Reversed A: deep open-top base + flat top plate on the rim', builtin: true, params: F({ length: 180, width: 120, height: 70, liftLidStyle: 'flat', liftLidLocator: 'none', liftLidOverhang: 0, liftLidClearance: 0.3 }) },
    { id: 'rev-deep-collar', name: 'Reversed B: deep open-top base + flat top with inner collar', builtin: true, params: F({ length: 180, width: 120, height: 70, liftLidStyle: 'cap', liftLidSkirtDepth: -10, liftLidClearance: 0.3 }) },
    { id: 'rev-telescope', name: 'Reversed C: shallow base + deeper open-box lid flipped over it', builtin: true, params: F({ length: 180, width: 120, height: 30, liftLidStyle: 'cap', liftLidSkirtDepth: 45, liftLidClearance: 0.3 }) },
    { id: 'rev-telescope-flat', name: 'Reversed C (flat top): same shallow base, flat top lid + plug', builtin: true, params: F({ length: 180, width: 120, height: 30, liftLidStyle: 'flat', liftLidLocator: 'plug', liftLidClearance: 0.3 }) },
    { id: 'rev-inset-acrylic', name: 'Reversed D: larger wooden base + smaller acrylic lid inside, with bed', builtin: true, params: F({ length: 120, width: 120, height: 45, liftLidStyle: 'inset', liftLidJoint: 'finger', liftLidInsetDepth: null, liftLidRise: 20, liftLidClearance: 0.3, lidMaterialId: 'acrylic3', lidMaterialName: '3mm Acrylic', lidMaterialColor: '#bfe3f0', lidThickness: 3, lidKerf: 0.1, bedEnabled: true, bedOnFloor: true, bedStyle: 'tray', bedHeight: 20, bedElevation: 0, bedClearance: 0.5 }) },
    { id: 'rev-inset-wood', name: 'Reversed D (plywood): larger base + smaller inset lid, flat top', builtin: true, params: F({ length: 160, width: 110, height: 50, liftLidStyle: 'inset', liftLidJoint: 'finger', liftLidInsetDepth: 15, liftLidRise: 12, liftLidClearance: 0.3 }) },
    { id: 'lid-acrylic', name: 'Detached Lid: clear acrylic display cover', builtin: true, params: F({ length: 120, width: 90, height: 30, liftLidStyle: 'acrylicCover', coverSeat: 'ring', lidMaterialId: null, lidThickness: null }) },
    { id: 'combo-ring', name: 'Combined: cap-lid gift box with 4 compartments', builtin: true, params: F({ length: 200, width: 150, height: 55, liftLidStyle: 'cap', liftLidSkirtDepth: 18, dividersEnabled: true, dividerPattern: 'grid', dividerCountX: 1, dividerCountY: 1, dividerThickness: 3 }) },
    { id: 'combo-acrylic', name: 'Combined: acrylic display cover with 3 slots', builtin: true, params: F({ length: 160, width: 100, height: 35, liftLidStyle: 'acrylicCover', dividersEnabled: true, dividerPattern: 'columns', dividerCountX: 2, dividerThickness: 3 }) },
  ];

  BUILTIN_BOXES.push.apply(BUILTIN_BOXES, FEATURE_BOXES);

  const OCC = [
    ['xmas-classic','Christmas: classic gift box with cap lid',{length:200,width:150,height:60,liftLidStyle:'cap',liftLidSkirtDepth:20,liftLidEngraveText:'Merry Christmas'}],
    ['xmas-hamper','Christmas: hamper tray with 4 compartments',{length:320,width:240,height:85,liftLidStyle:'cap',liftLidSkirtDepth:28,dividersEnabled:true,dividerPattern:'grid',dividerCountX:1,dividerCountY:1,liftLidEngraveText:'Season\u2019s Greetings'}],
    ['xmas-advent','Christmas: 6-slot treat box, flat lid',{length:240,width:160,height:50,liftLidStyle:'flat',liftLidLocator:'plug',dividersEnabled:true,dividerPattern:'grid',dividerCountX:2,dividerCountY:1}],
    ['xmas-ornament','Christmas: ornament display, finger-jointed inset lid + bed',{length:140,width:140,height:50,liftLidStyle:'inset',liftLidJoint:'finger',liftLidInsetDepth:null,liftLidRise:20,bedEnabled:true,bedOnFloor:true,bedStyle:'tray',bedHeight:20,bedElevation:0,bedClearance:0.5}],
    ['eid-hamper','Eid Fitr: lebaran hamper, 3 columns + cap lid',{length:300,width:200,height:80,liftLidStyle:'cap',liftLidSkirtDepth:25,dividersEnabled:true,dividerPattern:'columns',dividerCountX:2,liftLidEngraveText:'Eid Mubarak'}],
    ['eid-thr','Eid Fitr: THR / angpao envelope box',{length:190,width:110,height:40,liftLidStyle:'flat',liftLidLocator:'plug',liftLidOverhang:2,liftLidEngraveText:'Eid Mubarak'}],
    ['eid-dates','Eid Fitr: dates (kurma) display with clear cover',{length:180,width:110,height:35,liftLidStyle:'acrylicCover',dividersEnabled:true,dividerPattern:'columns',dividerCountX:1,dividerThickness:3}],
    ['eid-premium','Eid Fitr: premium hamper with raised bed',{length:320,width:230,height:90,bedEnabled:true,bedStyle:'tray',bedHeight:20,bedElevation:20,liftLidStyle:'cap',liftLidSkirtDepth:30,liftLidEngraveText:'Eid Mubarak'}],
    ['bday-cake','Birthday: cake-slice / cupcake box, 2 slots',{length:200,width:120,height:70,liftLidStyle:'cap',liftLidSkirtDepth:20,dividersEnabled:true,dividerPattern:'columns',dividerCountX:1}],
    ['wed-favor','Wedding: favor box, finger-jointed inset lid',{length:100,width:100,height:45,liftLidStyle:'inset',liftLidJoint:'finger',liftLidInsetDepth:12,liftLidRise:10}],
    ['val-choc','Valentine / Mother\u2019s Day: chocolate box, 3 \u00d7 3',{length:180,width:180,height:40,liftLidStyle:'flat',liftLidLocator:'plug',dividersEnabled:true,dividerPattern:'grid',dividerCountX:2,dividerCountY:2,dividerThickness:2}],
    ['tea-set','Gift: tea / coffee set box, 4 compartments',{length:240,width:180,height:70,liftLidStyle:'cap',liftLidSkirtDepth:22,dividersEnabled:true,dividerPattern:'grid',dividerCountX:1,dividerCountY:1}],
    ['corp-hamper','Corporate: large hamper, custom columns (80 / 0 / 60)',{length:380,width:260,height:100,liftLidStyle:'cap',liftLidSkirtDepth:30,dividersEnabled:true,dividerPattern:'custom',customColumnWidths:'80,0,60',customRowDepths:''}],
    ['souvenir-slim','Souvenir: slim gift box (scarf, pen, card)',{length:260,width:90,height:30,liftLidStyle:'flat',liftLidLocator:'plug'}],
  ];
  OCC.forEach(o => BUILTIN_BOXES.push({ id: 'occ-' + o[0], name: o[1], builtin: true, params: F(o[2]) }));

  const SHP = [
    ['heart','Shapes: Heart gift box (Valentine / Mother\u2019s Day)',{length:180,width:165,height:36,shapeType:'heart',shapeWall:10,shapeEngraveText:'With Love'}],
    ['heart-small','Shapes: Small heart favor box',{length:110,width:100,height:30,shapeType:'heart',shapeWall:8}],
    ['tree','Shapes: Christmas tree box',{length:190,width:240,height:36,shapeType:'tree',shapeWall:10,shapeEngraveText:'Merry Christmas'}],
    ['star5','Shapes: Star ornament box (5 point)',{length:200,width:190,height:33,shapeType:'star5',shapeWall:12,shapeEngraveText:'Joy'}],
    ['star8','Shapes: Eid 8-point star box',{length:190,width:190,height:36,shapeType:'star8',shapeWall:12,shapeEngraveText:'Eid Mubarak'}],
    ['arch','Shapes: Eid arch / mosque window box',{length:150,width:200,height:36,shapeType:'arch',shapeWall:10,shapeEngraveText:'Eid Mubarak'}],
    ['bauble','Shapes: Round bauble box',{length:150,width:150,height:36,shapeType:'circle',shapeWall:9,shapeEngraveText:'Noel'}],
    ['flower','Shapes: Scalloped flower box',{length:170,width:170,height:33,shapeType:'flower',shapeWall:10}],
    ['hexagon','Shapes: Hexagon trinket box',{length:150,width:130,height:36,shapeType:'hexagon',shapeWall:9}],
    ['octagon','Shapes: Octagon tea box',{length:160,width:160,height:42,shapeType:'octagon',shapeWall:9}],
    ['diamond','Shapes: Diamond / gem jewellery box',{length:140,width:170,height:30,shapeType:'diamond',shapeWall:10}],
  ];
  SHP.forEach(o => BUILTIN_BOXES.push({ id: 'occ-shape-' + o[0], name: o[1], builtin: true, params: F(Object.assign({ boxType: 'shapeBox' }, o[2])) }));

  const BUILTIN_MACHINES = [
    { id: 'co2-40w', name: 'CO2 Laser 40W', builtin: true, power: 40, speedCutMmPerMin: 300, speedEngraveMmPerMin: 3000, passes: 1 },
    { id: 'co2-80w', name: 'CO2 Laser 80W', builtin: true, power: 80, speedCutMmPerMin: 600, speedEngraveMmPerMin: 6000, passes: 1 },
    { id: 'co2-100w', name: 'CO2 Laser 100W', builtin: true, power: 100, speedCutMmPerMin: 900, speedEngraveMmPerMin: 8000, passes: 1 },
    { id: 'fiber-30w', name: 'Fiber Laser 30W (thin metal)', builtin: true, power: 30, speedCutMmPerMin: 150, speedEngraveMmPerMin: 4000, passes: 1 },
  ];

  function loadUser(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }
  function saveUser(key, list) {
    try { localStorage.setItem(key, JSON.stringify(list)); return true; } catch (e) { return false; }
  }

  function makeStore(key, builtins) {
    return {
      list() { return builtins.concat(loadUser(key)); },
      save(preset) {
        const list = loadUser(key).filter(p => p.id !== preset.id);
        list.push(Object.assign({}, preset, { builtin: false }));
        saveUser(key, list);
        return list;
      },
      remove(id) {
        const list = loadUser(key).filter(p => p.id !== id);
        saveUser(key, list);
        return list;
      },
    };
  }

  const Presets = {
    materials: makeStore(LS_MATERIALS, BUILTIN_MATERIALS),
    boxes: makeStore(LS_BOXES, BUILTIN_BOXES),
    machines: makeStore(LS_MACHINES, BUILTIN_MACHINES),
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Presets;
  else root.Presets = Presets;
})(typeof window !== 'undefined' ? window : globalThis);
