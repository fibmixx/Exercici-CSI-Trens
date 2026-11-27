#!/usr/bin/env python3
"""Construeix index.html (un sol fitxer) a partir de src/."""
import json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
src = root / 'src'
page = (src / 'page.html').read_text(encoding='utf-8')
core = (src / 'core.js').read_text(encoding='utf-8')
about = (src / 'about.html').read_text(encoding='utf-8')
ui = 'const ABOUT_HTML = ' + json.dumps(about, ensure_ascii=False) + ';\n' + (src / 'ui.js').read_text(encoding='utf-8')
out = page.replace('/*CORE*/', core).replace('/*UI*/', ui)
(root / 'index.html').write_text(out, encoding='utf-8')
print('index.html', len(out), 'bytes')
