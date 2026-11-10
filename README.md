# LaserBox Studio

A browser-based, production-grade parametric box generator for laser cutting —
kerf compensation, finger joints, panel layout, sheet nesting, and
export-ready SVG/DXF, built as a real tool for a real laser-cutting business
rather than a demo.

**Runs with zero install and zero server.** Open `index.html` in a browser.
Three.js is vendored locally in `libs/`, so it also works fully offline.

## UI design (v8)

The interface follows an Apple-style system: one accent colour, grouped inset cards, switches for on/off options, and progressive disclosure.

- **Top bar:** sidebar toggles, project name, a `3D / Panels / Sheets` segmented control, a `⋯` menu (New, Open, Save, Units, Appearance) and a single **Export** menu.
- **Left (Design):** only *Box* and *Material* are open by default; *Fit & Joints*, *Sheets & Machine* and *Advanced* are collapsed. Type-specific sections (Shape, Dividers & Lid, Sliding Lid, Hinge, Inner Bed) appear only when the chosen box type needs them.
- **Right (Inspector):** Summary, Checks (warnings), the selected panel's cutouts/engraving, and Artwork.
- **Viewport:** a floating toolbar; 3D-only controls (Exploded, Wireframe, Spin, camera) hide in the 2D and Sheet views.
- Both sidebars collapse on desktop and become slide-over drawers on phones. Light and dark follow the system setting.

All styling lives in `css/studio.css`; behaviour for menus/sidebars is in `js/ui/enhance.js`. No geometry or export code was changed.

---

## 1. Running it

```
cd laserbox
open index.html        # macOS
# or just double-click index.html / drag it into a browser tab
```

No build step, no `npm install`, no server. Everything is plain
`<script>` tags (not ES modules — see *Browser limitations* below for why).

To run the automated geometry tests (Node, no browser needed):

```
node tests/geometry.test.js
```

---

## 2. What's in the box

```
index.html                  Page shell + all UI controls
css/studio.css               Visual design (Apple-style light/dark system)

js/geometry/                 Pure math. No DOM. Unit-testable under Node.
  vec2.js                       2D vector/path utilities
  fingerJoint.js                 1D tab/gap segmentation along an edge
  kerf.js                        Kerf compensation math
  itemAlign.js                    Align / centre / distribute / arrange maths for the item layout editor
  panel.js                       Builds a closed 2D outline from 4 edges + cutouts
  boxGenerator.js                Assembles panels into full box constructions
  sheetLayout.js                  MaxRects nesting (multi-strategy + seeded search); all materials share sheets unless "Separate sheets per material" is on
  kerfTest.js                     Kerf calibration test-pattern generator

js/validation/validator.js    Manufacturability checks -> plain-language warnings

js/export/
  svgExporter.js                Panel/sheet geometry -> layered SVG
  dxfExporter.js                 Panel/sheet geometry -> DXF (R12 POLYLINE)

js/state/
  presets.js                    Material / box / machine presets (+ localStorage)
  stateManager.js                 Single source of truth + recompute pipeline
  projectIO.js                    Project JSON save/load, file download/upload

js/render/
  preview2d.js                   Draws panels into an on-screen <svg> (pan/zoom)
  preview3d.js                    Assembles real extruded geometry in Three.js

js/ui/uiController.js         Wires the DOM to State; the only file that
                               touches page chrome directly
js/main.js                    Bootstraps the app

tests/geometry.test.js        Assertion-based tests, run with plain `node`
examples/                     A generated sample SVG/DXF/PNG and UI screenshots
presets/example-project.json  A saved project you can load via "Open"
libs/                         Vendored Three.js r128 (UMD build) + OrbitControls
```

**One geometry, three consumers.** `BoxGenerator.generate()` produces a
`panel.outline` polyline (and `cutouts`/`engravings`) per panel. The 2D
preview, the 3D preview, and the SVG/DXF exporters all consume that exact
same array — nothing is redrawn or approximated differently for display vs.
export, per the "don't fake the geometry" requirement.

---

## 3. The geometry model

### 3.1 Coordinate system

Each panel lives in its own local 2D space: origin at the bottom-left
corner, +x to the right, +y up. The box itself uses global axes X = length,
Y = width, Z = height, external (outer) dimensions.

### 3.2 Box construction ("endcap" convention)

Left and Right panels are full-size **end caps** (`width × height`) that
reach the box's true outer corners in Y and Z. Front/Back and Top/Bottom are
**recessed by one material thickness on their X ends**, so they fit *between*
the two end caps — the end caps' own material thickness fills that recess.

```
LEFT   width × height     at X = 0
RIGHT  width × height     at X = length
FRONT  (length-2t) × height   at Y = 0
BACK   (length-2t) × height   at Y = width
BOTTOM (length-2t) × width    at Z = 0
TOP    (length-2t) × width    at Z = height
```

This keeps the **assembled outer box exactly length × width × height**, and —
critically — guarantees every pair of mating edges has an *identical nominal
length*, which is a hard requirement for finger joints to interlock. (An
earlier, more "obvious" convention — recess two axes instead of one — was
tried first and rejected because it produces a length mismatch at the
Front/Back ↔ Top/Bottom joint; see the commit history of this file's design
notes in `boxGenerator.js` for the full derivation of why only one axis can
be recessed.)

The 12 box edges reduce to 3 "joint families" that always share the same
nominal length, so finger settings apply consistently per family:

| Family | Length | Edges |
|---|---|---|
| A | `width` | Left/Right ↔ Top/Bottom |
| B | `height` | Left/Right ↔ Front/Back |
| C | `length - 2×thickness` | Front/Back ↔ Top/Bottom |

### 3.3 Finger joints

An edge of length `L` is divided into alternating segments:

- **TAB** — material present, sits at the edge's nominal line.
- **GAP** — material absent, recessed *into* the panel by exactly one
  `thickness`, forming a slot that receives the mating panel's tab.

The two panels sharing a physical edge use **complementary phase** — one
starts TAB, the other starts GAP — so wherever one panel has material, the
other has a slot. That's what makes the joint interlock at all; it's the one
invariant the whole system depends on (see `FingerJoint.matingPhase` and the
`phase: 0` / `phase: 1` pairing in `boxGenerator.js`).

Three input modes ( `fingerJoint.js` → `segmentEdge()` ):

- **By count** — you specify how many segments; width is derived (`L / n`).
- **By width** — you specify a target width; count is derived
  (`round(L / w)`) and the actual width is rebalanced so it divides the edge
  evenly (no leftover sliver segment).
- **Manual** — explicit boundary positions + states, for hand-tuned joints.

Odd segment counts produce a symmetric edge (tab at both ends); even counts
end on the opposite state from where they started — both are structurally
valid, it's just worth knowing which you're getting.

### 3.4 Kerf compensation — the physics and the fix

A laser removes a strip of material of width `kerf`, centered on the
programmed path. With **zero compensation**, this means:

- protrusions (tabs) come out **narrower** than drawn, by `kerf` total
- recesses (slots) come out **wider** than drawn, by `kerf` total

If both mating parts are cut with the same kerf, the *natural, uncompensated*
result is a joint that's `2 × kerf` looser than nominal — usually too sloppy
for a snug finger-jointed box.

**The fix**: pre-compensate the *design* geometry in the opposite direction —
widen tabs and narrow gaps by `kerf` before cutting — so that after the laser
removes its kerf, the finished part lands on the nominal dimension. Because a
tab and its neighboring gap share one cut line, widening the tab
automatically narrows the gap by the same amount — there's only ever one
shift per internal boundary, computed in `kerf.js` → `compensateSegments()`.
The very first and last boundary of an edge (which coincide with the panel's
outer silhouette / corner) are deliberately **not** touched by this pass —
that's what the separate **outline compensation** mode
(`auto` / `inside` / `outside` / `none`) is for, applied to flat
(non-jointed) edges via `Kerf.resolveOutlineOffset()`.

This is exactly the model the app distinguishes in the UI as **nominal →
design → compensated → finished** dimensions.

### 3.5 Kerf calibration pattern

"Kerf" is not a machine constant — it depends on material, lens, power,
speed, and focus. The **Generate kerf calibration pattern** button (Kerf
section) produces a small SVG coupon: a row of slots and a row of tabs, each
pair cut assuming a different kerf value across a configurable range. Cut it
once, physically try each tab in its same-column slot, and read off the
label of the best-fitting pair — that's your real-world kerf for this
material/power/speed combination. See `kerfTest.js`.

---

## 4. Validation

`validator.js` runs after every geometry recompute and produces
plain-language, laser-operator-facing messages, not stack traces — e.g.
*"Kerf (2.9mm) is close to or exceeds material thickness (3mm) — finger
joints may be too loose or fail to form."* It checks: finger width vs.
configured min/max, kerf vs. thickness, degenerate/zero-area panels, joint
collisions (segments collapsed by kerf), cutouts positioned outside a panel,
sheet-fit per panel, and material-thickness-to-box-size ratio.

---

## 5. Box types & extensibility

Box types are a **registry** (`BoxGenerator.BoxTypes`), each just a `build(params)`
function returning `{ panels, warnings, info }`. Shipped today:

- `finger6` — full 6-panel finger-jointed box
- `finger5open` — the same, with the lid omitted and its rim edges flattened
- `basic6` — 6 panels, plain butt joints (glue/tape assembly)
- `simple4` — open 4-sided frame, plain edges

Adding a new box type (sliding lid, hinged box, dividers, drawers, etc.) means
writing one more `build()` function and registering it — no changes needed
anywhere else (UI, exporters, and previews are all driven generically by the
`panels` array they return). This was a first-class design goal per the "do
not hard-code around one box style" requirement.

The same extensibility applies to sheet nesting (`SheetLayout.pack()` is
intentionally isolated so a smarter bin-packer can replace the current
shelf-packing heuristic later) and to DXF export (isolated in
`dxfExporter.js`, R12/POLYLINE today, upgradable without touching callers).

---

## 6. Automated tests

`tests/geometry.test.js` runs under plain Node (no test framework, no DOM) —
27 assertions covering: finger segmentation and its complementary-phase
invariant, kerf compensation arithmetic, panel outline closure (no gaps/self
intersections) for both flat and finger edges, the full box generator across
a sweep of dimensions/thicknesses/kerfs/finger counts (including edge cases
that don't divide evenly, very small boxes, and large boxes), the validator,
and the sheet-packing nesting including multi-sheet spillover.

```
$ node tests/geometry.test.js
27 passed, 0 failed
```

A **debug/developer mode** toggle exists in the left sidebar ("Layers &
Advanced") for future expansion into joint-coordinate overlays.

---

## 7. Browser limitations & notes

- **No ES modules.** Opening `index.html` directly via `file://` triggers
  CORS restrictions on `type="module"` scripts in Chromium-based browsers.
  Every file is a plain classic `<script>` using an IIFE + a small
  `window.X` namespace instead — this is *why* the app can be opened with a
  double-click with zero server, at the cost of manual `<script>` ordering
  in `index.html` (dependencies load before dependents).
- **No browser storage in the *generated* box artifacts** — this app itself
  *is* the artifact, so it's fine to use `localStorage` (used for
  presets and last-open-project autosave); this restriction only applies to
  Artifacts embedded inside a chat UI, not to a standalone delivered app.
- **DXF is R12/POLYLINE**, not the newer LWPOLYLINE — deliberately, for the
  widest compatibility, at the cost of more verbose output. SVG remains the
  primary, recommended export.
- **3D preview** uses real extruded panel geometry (including the actual
  finger teeth), not placeholder boxes — but it does not simulate physical
  material flex, and cutouts render as holes without engraving depth.
- Cutouts/engraving are stored per-panel in `state.panelOverrides` and
  survive regeneration as long as the panel `id` doesn't change (i.e. as
  long as you don't switch box types in a way that removes that panel).

---

## 8. Example files

- `examples/sample-box.svg` / `.dxf` — a generated 300×200×100mm box nested
  on a 600×400mm sheet (3 sheets, since Top/Bottom don't fit alongside each
  other on that sheet size — try a bigger sheet or open-top box type for
  fewer sheets).
- `examples/sample-box.png` — that SVG rasterized, to eyeball the joints
  without opening a laser program.
- `examples/screenshot-*.png` — the running application.
- `presets/example-project.json` — load this via the **Open** button to see
  a populated project.

---

## 10. Custom artwork upload & 3D mapping (added in v2)

Upload a `.svg` or `.dxf` file (Artwork section, right sidebar) and it's
mapped onto whichever panel is currently selected, then editable — target
face, operation, X/Y, scale, rotation, and mirror — with the result baked
into that panel's real geometry and visible immediately in every view (2D,
3D, and export), because it goes through the exact same
`panel.cutouts`/`panel.engravings` pipeline as every other cutout/engraving
in the app.

- **Import** (`js/artwork/artworkImporter.js`): a from-scratch SVG path-data
  parser (M/L/H/V/C/S/Q/T/A/Z, curves sampled to line segments) plus basic
  shape elements (`rect`/`circle`/`ellipse`/`line`/`polyline`/`polygon`),
  transform stack (`translate`/`scale`/`rotate`/`matrix`), and viewBox/unit
  handling; and a DXF (ASCII) reader for `LINE`/`CIRCLE`/`ARC`/`LWPOLYLINE`/
  `POLYLINE`, with `$INSUNITS` unit detection. Output is always plain
  polylines in millimeters — no SVG/DXF-specific data leaks past this file.
- **Mapping** (`js/artwork/artworkMapper.js`): resolves an artwork instance's
  placement (center, scale, rotation, mirror) into fully-baked, absolute
  panel-local points, flipping Y from the source's SVG-style down convention
  to the panel's up convention so it appears correctly oriented on the face.
- **Operations**: *Full Engraving* → `panel.engravings` (`type: 'artworkFill'`,
  rendered as a solid filled area, multiple subpaths of one upload merged
  with `fill-rule="evenodd"` so holes/counters render correctly). *Vector
  Cutting* and *Vector Scoring* → `panel.cutouts` (`layer: 'cut'` or
  `'score'`); score paths are excluded from becoming actual holes in the 3D
  solid and from validation's through-cut assumptions, since a score pass
  doesn't cut through material.
- **3D mapping** (`js/render/preview3d.js`): cut artwork already appears as
  a real hole in the extruded panel mesh (same geometry, no special case).
  Engraved fills and score lines are drawn as thin overlay meshes/lines at
  the panel's outer face using the identical per-panel transform used for
  the solid geometry — so there's exactly one coordinate system to reason
  about, not a separate "3D preview" mapping model.

## 11. The layered sliding-lid box (added in v2)

`js/geometry/slidingLidBox.js` implements a cut-only (no Z-axis routing, no
engraved grooves), fully layered sliding-lid mechanism. See the extensive
header comment in that file for the full mechanism diagram; summary:

- **Chassis** (Base, Back, Left, Right, Front): standard finger joints via
  the same `FingerJoint`/`Kerf` primitives as every other box type. The
  Front panel's top edge is lowered by `frontLowerAmount` (default
  `thickness + lidClearance`) so the lid can be dropped in from the top-front
  opening during assembly, then slid back. Because Front is shorter than
  Left/Right, the mating edge on Left/Right is only finger-jointed over the
  shorter height, with a plain (unjointed) strip above it up to full height
  — implemented by appending one synthetic full-material segment to the
  finger pattern (`extendWithFlatCap`), not a separate code path.
- **Inner ledge runners**: plain rectangles, `width × (height - (thickness + lidClearance))`,
  glued to the inside faces of Left/Right — the shelf the lid rests on and
  slides along.
- **Top retainer rails**: plain rectangles, `(width - railSetbackFromFront) × railWidth`,
  glued flush with the top inside edge of Left/Right, stopping short of the
  front by `railSetbackFromFront` so there's room to drop the lid in during
  assembly before sliding it back under the rails.
- **The lid**: `(length - 2×thickness - horizontalClearance) × (width - thickness - horizontalClearance)`,
  with an optional semicircular thumb-pull notch cut into its front edge.
- **Clearances**: `lidClearance` (default 0.2mm) and `horizontalClearance`
  (default 0.3mm) are exposed exactly as requested, so friction can be
  dialed in against a shop's measured kerf — the same "expose the tunable
  parameter, verify empirically" philosophy as the kerf calibration pattern.

## 12. Hinged box presets (added in v2)

`js/geometry/hingedBox.js`, box type `hingedBox`, `hingeStyle: 'living' | 'node'`:

- **Living hinge**: the Back wall and the Lid are generated as ONE
  continuous panel (no cut at all along the fold line) with a band of short,
  alternating slits cut across the fold — the classic laser-cut living
  hinge. `hingeSegments: 'continuous' | 'segmented'` selects one long hinge
  band or several shorter ones separated by solid, uncut bridges (more
  resistant to a single-point tear, at the cost of a less smooth fold).
- **Interlocking node hinge**: the Back wall and Lid are separate panels
  whose shared edge is cut into complementary rounded knuckles (`panel.js`
  gained a `type: 'custom'` edge kind for this — an edge defined by explicit
  `{along, depth}` points rather than the tab/gap comb model, since knuckles
  are semicircular, not rectangular), each knuckle carrying a small pin hole
  so a wire or dowel threaded through afterward becomes the pivot.
- **Directional lids**: `lidOpening: 'oneWay'` (single lid hinged at the
  back) or `'twoWay'` (the lid is split into two independent halves, one
  hinged at the front, one at the back, meeting — not joined — in the
  middle, so it opens from either direction).

## 13. Production dieline export & strict color-coding (updated in v2)

Every export function now enforces exact production colors regardless of
whatever is configured for the on-screen preview:

| Layer | Color | Meaning |
|---|---|---|
| CUT | `#FF0000` | every through-cut: outlines, joints, cutouts |
| ENGRAVE | `#000000` | raster/fill engraving (uploaded artwork fills) |
| SCORE | `#0000FF` | vector scoring/guide lines — no through-cut |

- `svgExporter.js`: `panelToSvgGroup(panel, opts)` takes a `strict` flag
  (default `true`); the interactive preview explicitly passes `strict:false`
  with its own customizable colors, while `exportSheetSvg`/`exportPanelSvg`
  always force `strict:true` so a saved file can never accidentally carry a
  user's preview color choice. Cutouts route to a `layer-cut` or
  `layer-score` `<g>` based on their own `layer` field (previously every
  cutout was drawn in the cut color regardless of its tag — fixed). Artwork
  fills belonging to the same upload are merged into one `<path>` with
  `fill-rule="evenodd"` so internal holes render correctly.
- `dxfExporter.js`: writes both the legacy ACI color index (group 62, for
  older readers) and a true 24-bit RGB color (group 420 — read by LightBurn
  and most modern CAM software) on each layer, so the exact hex values match
  regardless of which color model the importing software prefers.
- Kerf compensation (section 3.4 above) already applies to every panel
  generated by every box type, including the new sliding-lid and hinged
  variants — there's one compensation pipeline, not a per-box-type copy.

## 14. Known simplifications (v2 additions)

- The 3D preview places sliding-lid runners/rails/lid and hinged-box
  lids at representative assembly positions for visualization; it does not
  animate the lid sliding or the hinge folding.
- Node-hinge knuckle geometry uses a simplified semicircle-with-clearance
  model (documented in `hingedBox.js`) rather than a full physical
  interference simulation — verify pin-hole and knuckle-clearance fit with a
  test cut, same as kerf.
- The SVG/DXF importer covers the common path/shape grammar (enough for
  logos, text-converted-to-paths, and simple line art) but not every SVG
  feature (e.g. `<use>`/`<symbol>` references, CSS-based styling, clipping
  paths, or embedded raster images).

---

## 15. Priorities, as built

Per the brief, in order: **geometry correctness → kerf accuracy → joint
accuracy → manufacturability → export reliability → ease of use → advanced
customization → visual appearance.** Concretely, that's why the geometry
engine was written and unit-tested *before* any UI existed, why kerf
compensation has a dedicated module with its own tests, and why validation
surfaces manufacturability problems before you ever get to export.

---

## 15. Box with Dividers / Detached Lid (added in v3)

Box type **"Box with Dividers / Detached Lid"** (`customBox`). Both features
are parameters of one builder, so they combine freely. Ten starting presets
appear in *Presets → Load box preset* (`Divider Box: …`, `Detached Lid: …`,
`Combined: …`). They are parameter sets, not separate geometry.

New modules (all pure, DOM-free, Node-testable):

| File | Role |
|---|---|
| `js/geometry/assembly.js` | assembly/material metadata, 3D frames, collision boxes |
| `js/geometry/dividerGrid.js` | cross-lap divider grid + optional wall slots |
| `js/geometry/liftOffLidBox.js` | flat and cap-style detached lids |
| `js/geometry/displayCover.js` | acrylic display cover, base plate, seat ring |
| `js/geometry/customBox.js` | composes body + dividers + lid/cover |
| `js/export/assemblyExport.js` | per-assembly (body / dividers / lid / cover) exports |

Modified: `boxGenerator.js` (fixed-outline panels, legacy tagging), `sheetLayout.js`
(`packGroups`, `findOverlaps`), `validator.js`, `stateManager.js`, `projectIO.js`
(schema v2 + migration), `presets.js`, `svgExporter.js`/`dxfExporter.js`
(assembly filter, `data-assembly` attributes), `preview3d.js` (per-panel frame,
thickness, translucent acrylic, lid lift), `uiController.js`, `index.html`.

### Dimensions
`length × width × height` is the **body's external size without the lid**.
Internal space = external − 2×body thickness (X,Y); height − bottom (− fixed top
when no detached lid and *Lid = Flat panel*). Lid/cover sizes are derived.

### Dividers
`dividerCountX` walls split the length into `n+1` columns; `dividerCountY` split
the width. Patterns: grid, columns, rows, custom (`customColumnWidths="40,0,30"`,
`0` = take the remainder). X-walls are slotted from the top, Y-walls from the
bottom, each slot `dividerHeight/2` deep and
`matingThickness + dividerSlotFit` wide. Divider thickness/material are independent
of the body. Height is auto (internal height − clearance − lid plug) or explicit.
Mounting: `free` (removable grid, ends stop `dividerClearance` short of the walls)
or `slotted` (end tabs through rectangular wall slots kept ≥ 2×thickness from the
finger joints). **Kerf is applied once**: parts are drawn nominal then offset
outward by `kerf/2` (per *Outline compensation*), which narrows every slot by one
kerf in the cut file; wall slots use the same rule. With compensation *None*
slots are the raw nominal width.

### Detached lids (`liftLidStyle`)
* **flat** – `lid-top` = body + 2×overhang; optional `lid-plug` drops inside the
  opening: `(L−2t−2c) × (W−2t−2c)` with per-side clearance `c`.
* **cap** – cap inner = body + 2×clearance; outer = inner + 2×lid thickness; height
  = skirt depth + lid thickness; plywood uses finger joints, transparent material
  uses butt joints (solvent cement).
  **Skirt depth is signed and unlimited** (`liftLidSkirtDepth + liftLidSkirtOffset`):
  * **> 0, outer skirt** – may be *deeper than the body*; it then hangs below the
    body's base (warning only), e.g. to cover a bed or a stand beneath the box.
  * **< 0, inner collar** – a flat `lid-top` plate (body footprint + overhang) rests
    on the rim and a finger- or butt-jointed collar (`cap-plug` + 4 `cap-*` walls)
    hangs *inside* the body, `clearance` away from the inner walls. Its depth is
    `|skirt|` (+ plate thickness) and must fit within the internal height.
  * **0** is rejected.
* **inset** (reversed: *larger base, smaller lid*) – the lid is a smaller flat-topped
  open-box cover that sits **inside** the base opening, like an acrylic cover set
  into a wooden box. Lid outer = base internal − 2×clearance; `liftLidInsetDepth`
  is how far it goes down into the base and `liftLidRise` how far it stands above
  the rim (0 = flush). Transparent material is butt-jointed, plywood finger-jointed.
  Combine with the inner bed for the "wooden base + acrylic cover + bed" build
  (preset *Reversed D*).
* **acrylicCover** – transparent top + 4 butt-jointed sidewalls; plywood base
  plate and seat ring (ring inner = body + 2×gap; cover inner = ring outer +
  2×`coverClearance`). Cover width/depth/height are adjustable (blank = derived).
  With sidewalls off it becomes a flat acrylic top.

No grooves, rails or hinges: the lid lifts straight off. Clearances are starting
points; kerf, material and assembly preference differ, so **cut a test piece**.

### Body height offset (`bodyHeightOffset`)
Effective body height = `height + bodyHeightOffset` (± mm, may be negative). The
lid, dividers and bed all derive from the effective height, so you can nudge the
body taller/shorter without retyping anything else. It must stay positive.

### Inner bed (`bedEnabled`) — raised insert / false floor
Its own assembly (`bed`, own materials and export). `bedStyle` is `tray` (open-top
finger-jointed tray, `bedHeight` outer height) or `plate` (single flat plate).
`bedHeight` blank = **auto**: the tray fills from its elevation up to the rim, or up to
the underside of an inset lid / inner collar / lid plug (type a number to override).
Plan size = body internal − 2×`bedClearance`; `bedElevation` is mm from the
internal floor to the bed's underside (≥ 0). A bed may reach above the rim
(warning); a bed that overlaps dividers or the lid is reported as a collision,
with a message saying what to lower.

`bedFlipped` turns a tray **upside down** (open side down): the walls stand on the
elevation and the plate is the top face, i.e. a raised platform / table. Same
footprint and height span as the upright tray. The bed has its own panel and works
with **every preset**: ticking it on a plain finger-jointed preset switches the box to
the `customBox` type (identical body geometry; closed-top boxes stay closed).
Loading a preset resets the bed, so a previous bed never lingers.

#### Double layer (local backing patches) for pocket items
Pocket holes are cut *through* the pocket plate, so anything that does not reach the
box floor would fall straight through. Instead of a full second plate, **only the items
that need it** get their own small **`bed-backing-N`** patch, glued flat against the
**underside** of the pocket plate directly beneath the hole:

* The hole stays cut through the top plate; the patch is **solid (not cut out)**, so the
  item rests on it. With 3 mm plywood that is 3 mm + 3 mm = 6 mm at that spot only.
* The patch is the pocket outline grown by **`bedBackingMargin`** (default 5 mm per
  side, rounded corners) so there is a glue ledge all the way round.
* **Needs a patch:** acrylic laid flat, hamper contents (jars, boxes, bottles ...), and
  any item with no *Item height* entered (safe default).
* **No patch (single layer):** an item whose *Item height* rises at least
  **`bedTallItemMin` (default 50 mm = 5 cm)** above the bed top, e.g. a lamp base. It
  stands on the box floor and the pocket only holds it upright. If every item is tall,
  nothing is added and the bed is not lifted.
* A patch is automatically narrowed (never below 3 mm) so it does not run past the bed
  edge, cover a tall item's hole, or touch a neighbouring patch; a warning says when
  that happened or when it still cannot clear.
* An upright tray / flat plate is lifted by one thickness to make room for the patches
  (an auto-height tray gets one thickness shorter so it still fills to the rim). An
  upside-down tray has its pocket plate on top, so the patches fit inside the walls and
  nothing is lifted. Works with Grip layers.
* `bedBacking: false` (checkbox *Double layer*) turns it off; a warning then lists the
  items that will fall through. In the layout editor, amber pockets get a patch, dark
  ones are tall items that stand on the floor.
* The bed is held up by whatever its elevation rests on; a flat plate sitting on the
  floor with patches only under some items is supported by those patches.

#### Square, smooth corners, finger slot and per-item double layer

New item options in the **Item layout** editor (all stored per item in `bedItems`, all kerf-compensated like every other pocket):

| Option | Key | What it does |
|---|---|---|
| **Square** item | `type: 'square'`, `w` | One side length drives both directions. With no item height entered it is a flat item, so it automatically gets its own double-layer backing patch. |
| **Corner radius** | `radius` (mm) | Rounds the corners of *Rectangle*, *Square*, *Acrylic* and *Bottle* pockets. 0 = sharp. Clamped to half the short side, so it can never self-intersect. The backing patch follows the rounded outline. |
| **Finger slot** | `finger: true`, `fingerAngle`, `fingerWidth`, `fingerDepth` | A round notch merged into the pocket outline (one closed cut, not two overlapping ones) so a fingertip can get beside the item and lift it out. Works on every item type. `fingerAngle` is the side of the item (0 right, 90 up, 180 left, 270 down) measured from the item's own rotation, so the slot turns with the item. `fingerWidth` is the notch diameter, `fingerDepth` how far it reaches past the pocket edge (a depth larger than half the width makes a stadium-shaped slot). |
| **Double layer per item** | `support: 'double' \| 'none'` (blank = auto) | Overrides the automatic rule for one item: *Always* glues a backing patch under it even if it is tall; *Never* leaves a bare hole (a warning appears if the item is too short to reach the floor and would fall through). |

#### Selecting, aligning and distributing items

Select items on the layout canvas: **click**, **Shift/Ctrl/Cmd-click** to add or remove, **drag a box** on empty space, **Select all** button or **Ctrl/Cmd + A**. Dragging, arrow-key nudging (Shift = 5 mm), **Ctrl/Cmd + D** (duplicate) and **Delete** act on the whole selection; **Esc** deselects. Every operation works on the *visible outline* of each pocket (including rotation, cable slots and finger slots), not on the item's origin.

| Group | Buttons | Behaviour |
|---|---|---|
| **Align** | Left, Centre, Right, Top, Middle, Bottom | *Align to: The selection* lines items up with each other (e.g. Middle or Top = the same height). *Align to: The bed* uses the bed centre, and keeps the *Bed edge margin* (default 5 mm) for Left/Right/Top/Bottom. A single item always aligns to the bed. |
| **Centre the group** | Left-right, Top-bottom, Both | Moves the selection as one block, keeping the spacing between items, so the block is centred on the bed. The older *Centre* button does the same. |
| **Distribute** | Gaps ↔ / Gaps ↕ | Equal gaps *between* items; the two outermost stay put (needs 3+). |
| | Spread bed ↔ / Spread bed ↕ | Equal gaps between items **and** between the items and the bed edges, so they are spread evenly over the box size and centred. Works with 1+ items. |
| **Arrange** | Row, Column, Grid | Places the selection with an exact **Gap (mm)** (Grid uses **Grid columns**, in selection order) and centres the result on the bed. |

Alignment maths lives in `js/geometry/itemAlign.js` (pure functions, unit-tested under Node).

#### Lamp base item (circle + cable slot)
Item type **`lamp`** ("Lamp base + cable slot"): `w` = base diameter, `cableWidth` = slot
width (default 60 % of the diameter), `cableLen` = how far the slot reaches past the
circle edge, `cableAngle` = direction (0 = right, 90 = up, 270 = down, default 270). The
slot starts just inside the circle and is a little wider than the circle there, leaving
the small step on each side. The older *round + cable* item (narrow channel with an
optional coil pocket) is still available.

### Kerf per part
Lid, bed and dividers each have their own **kerf** field (blank = the material's kerf,
or the body kerf for the bed and dividers). For the lid the panel also shows the **fit
gap after cutting**: with outline compensation *auto/outside* the lid is cut at its
nominal size so the gap equals the clearance; with *none* the beam eats kerf/2 off each
side (inset lid ≈ clearance + kerf/2, outer cap ≈ clearance − kerf/2); *inside* adds a
full kerf. A warning appears if the kerf-adjusted gap would make the inset lid bind.

### Preset indicator
Loading a box preset keeps its name in the dropdown (✓) and in a badge in the top bar.
Editing any of the preset's parameters marks it *(modified)*; New/Open clears it.

### Materials
Body, divider, lid/base and cover each have thickness, kerf and material
(blank = same as body). Parts of different material/thickness are nested on
different sheets. Acrylic is rendered translucent in 3D. Legacy projects use one
material for everything.

### Exports
*Export assembly* writes one SVG/DXF per sheet for the whole design or one
assembly only. Assembly/material data lives in `data-*` attributes, never in
cut layers. Samples: `examples/sample-*.svg|dxf` (regenerate with
`node examples/generate-feature-samples.js`).

### Validation
Actionable errors for: divider counts/sizes/height, compartments too narrow,
slots too close to joints, lid clearance/overhang/skirt, cover too small/short,
divider ↔ lid-plug collisions, assembly collisions, zero-length or duplicate
edges, unplaced or overlapping parts. Invalid features are not generated and are
never silently clamped.

### Known limitations
* No costing engine exists; per-component area, cut length and material sheets
  are exposed in `State.derived.info` (`components`, `byMaterial`, `byAssembly`).
* Custom compartment sizes are typed lists, not drag-and-drop.
* Lid engraving is a single text line; use *Artwork* on `lid-top` / `cap-top` for graphics.
* Collision checks are axis-aligned box tests (0.2 mm tolerance).
* Acrylic joints are butt-jointed only; bonding is a manual assembly step.
* 3D lid lift is a static separated view, not an animation.
* Nesting is rectangle-based MaxRects (per material, bounding boxes with 90° rotation) — it does not interlock irregular outlines such as hearts or stars.

### Tests
`node tests/geometry.test.js` → 95 assertions (47 original + 48 new covering
dividers, lids, cover, combinations, exports, migration, state).

## Copyright & watermark

Every build shows **© <current year> Bali Craft Design. Laser Box - All rights reserved.** in the bottom-right corner of the app, and embeds the same notice in every export:

- **SVG** (sheet, single panel, kerf test): XML comment, `<metadata>` (`dc:rights`, `dc:creator`) and a visible grey `WATERMARK` layer (`#999999`) along the bottom edge of the sheet.
- **DXF**: a `999` comment on the first line and a `WATERMARK` layer (grey) with the notice text in the bottom-left corner.
- **Project (.json)**: a `copyright` field.

The watermark is never on the CUT (red), ENGRAVE (black) or SCORE (blue) layers. In LightBurn / LaserGRBL set the grey layer to "Output: off" so it is not burned. The year comes from `js/branding.js` and updates automatically on 1 January.
