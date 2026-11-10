# Font provenance

The committed bitmap tables were generated from **Noto Sans CJK SC**
(`NotoSansCJKsc-Regular.otf`, or the SC face in `NotoSansCJK-Regular.ttc`),
which is licensed under the SIL Open Font License 1.1. The license text is in
`OFL.txt` next to this file. The current tables were regenerated from the
Debian `fonts-noto-cjk` 20240730 package, whose TTC stores the SC face at
index 2.

The font file itself is not committed (16 MB); download it from the upstream
Noto CJK repository and point the generator at it:

```bash
curl -L -o /tmp/NotoSansCJKsc-Regular.otf \
  https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf

/Users/fujd/.espressif/tools/python/v6.1/venv/bin/python tools/gen_cjk_bitmaps.py \
  --font /tmp/NotoSansCJKsc-Regular.otf

# TTC (e.g. from the fonts-noto-cjk Debian package): SC is face 2
/Users/fujd/.espressif/tools/python/v6.1/venv/bin/python tools/gen_cjk_bitmaps.py \
  --font /tmp/NotoSansCJK-Regular.ttc --font-index 2
```

The generator places each glyph on the **hanzi baseline** it measures at the
target pixel size. Do not switch back to Pillow's `anchor="mm"`: centring the
line box pushes the bottom of 24 px hanzi past the last row, so the bitmap
loses one or two rows of the bottom stroke.

`gen_cjk_bitmaps.py` also accepts a system CJK font for quick local
experiments, but the committed assets use Noto so the result is reproducible
and redistributable under the OFL.
