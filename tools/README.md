# tools

Regenerates the halftone S15 animation in `assets/`.

```bash
node tools/render-s15.js assets/s15-rotate.svg
```

- `glb-loader.js` — minimal glTF 2.0 / GLB parser (node hierarchy, accessors, TRS matrices).
- `render-s15.js` — software rasteriser (z-buffer, Gouraud shading) → Bayer 8×8 ordered
  dither → hand-rolled PNG encoder → animated SVG with the frames inlined as data URIs.

No dependencies; plain Node.

## Options

| Env | Default | Meaning |
|-----|---------|---------|
| `SRC` | `source/2000 Nissan Silvia Varietta (S15).glb` | input model |
| `OW` / `OH` | `420` / `288` | output pixel size (use `OH=252` for the current crop) |
| `SS` | `3` | supersample factor before dithering |
| `FRAMES` | `24` | rotation frames |
| `GRAY=<yaw>` | — | render one frame to `gray.png` + `dith.png` for previewing |

Preview a single angle (yaw in radians):

```bash
OH=252 GRAY=0.4 node tools/render-s15.js
```
