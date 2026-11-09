# Font provenance

The committed bitmap tables were generated from **Noto Sans CJK SC**
(`NotoSansCJKsc-Regular.otf`), which is licensed under the SIL Open Font
License 1.1. The license text is in `OFL.txt` next to this file.

The font file itself is not committed (16 MB); download it from the upstream
Noto CJK repository and point the generator at it:

```bash
curl -L -o /tmp/NotoSansCJKsc-Regular.otf \
  https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf

/Users/fujd/.espressif/tools/python/v6.1/venv/bin/python tools/gen_cjk_bitmaps.py \
  --font /tmp/NotoSansCJKsc-Regular.otf
```

`gen_cjk_bitmaps.py` also accepts a system CJK font for quick local
experiments, but the committed assets use Noto so the result is reproducible
and redistributable under the OFL.
