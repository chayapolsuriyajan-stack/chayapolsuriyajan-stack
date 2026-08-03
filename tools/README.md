# tools

Regenerates the halftone S15 animation in `assets/`.

```bash
node tools/render-s15.js assets/s15-rotate.svg
```

Writes two files, `assets/s15-rotate-light.svg` and `assets/s15-rotate-dark.svg`
(the `.svg` suffix on the argument is replaced with `-light.svg` / `-dark.svg`).
Both have a fully transparent background — no card, no colour to match — so
README.md picks between them with a `<picture>` tag driven by
`prefers-color-scheme`, which is how GitHub actually switches images for its
light/dark toggle (a CSS media query *inside* an embedded SVG only follows the
OS theme, not GitHub's own switch, so that approach doesn't work here).

- `glb-loader.js` — minimal glTF 2.0 / GLB parser (node hierarchy, accessors, TRS matrices).
- `render-s15.js` — software rasteriser (z-buffer, per-vertex shading, a real shadow-map
  pass for cast shadows, alpha-blended glass) → Bayer 8×8 ordered dither → hand-rolled
  RGBA PNG encoder → animated SVG with the frames inlined as data URIs.

No dependencies; plain Node.

## Options

| Env | Default | Meaning |
|-----|---------|---------|
| `SRC` | `source/2010_vertex_edge_nissan_s15_silvia.glb` | input model |
| `OW` / `OH` | `420` / `288` | output pixel size (use `OW=460 OH=320` for the current crop) |
| `SS` | `3` | supersample factor before dithering |
| `FRAMES` | `24` | rotation frames |
| `GRAY=<yaw>` | — | render one frame to `gray.png` (opaque grayscale) + `dith.png` (dithered, light-ink) for previewing |

Preview a single angle (yaw in radians):

```bash
OW=460 OH=320 GRAY=0.4 node tools/render-s15.js
```
