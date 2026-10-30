"""Check/generate missing web glyphs from the same bundled variable font sources.

Requires fontTools with Brotli support. Normal website builds do not need Python.
Run --check for integrity/coverage verification; default regenerates supplements.
"""
from pathlib import Path
from io import BytesIO
import argparse
import hashlib
import json
from fontTools import subset
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parent.parent
folder = root / 'assets/fonts/modern'
manifest_path = folder / 'sources.json'
manifest = json.loads(manifest_path.read_text())
parser = argparse.ArgumentParser()
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
base_coverage = {'Inter': set(), 'Noto Sans SC': set()}
for item in manifest['assets'].values():
    data = (folder / item['file']).read_bytes()
    assert hashlib.sha256(data).hexdigest() == item['sha256']
    font = TTFont(BytesIO(data))
    family = 'Inter' if font['name'].getDebugName(1).startswith('Inter') else 'Noto Sans SC'
    base_coverage[family].update(font.getBestCmap())

def unicode_ranges(values):
    groups = []
    for value in sorted(values):
        if groups and value == groups[-1][1] + 1: groups[-1][1] = value
        else: groups.append([value, value])
    return ','.join('U+%X' % a + ('-%X' % b if a != b else '') for a, b in groups)

marker = '\n/* Full-source supplementary glyphs; downloaded only when needed. */'
css_path = root / 'arena-fonts.css'
css = css_path.read_text().split(marker)[0].rstrip() + '\n'
records = []
for family, filename in [('Inter', 'inter.ttf'), ('Noto Sans SC', 'noto_sans_sc.ttf')]:
    source = root / 'android/app/src/main/res/font' / filename
    font = TTFont(source, recalcTimestamp=False)
    missing = set(font.getBestCmap()) - base_coverage[family]
    if args.check:
        record = next(item for item in manifest['supplements'] if item['family'] == family)
        data = (folder / record['file']).read_bytes()
        assert hashlib.sha256(data).hexdigest() == record['sha256']
        assert hashlib.sha256(source.read_bytes()).hexdigest() == record['fullSourceSHA256']
        assert set(TTFont(BytesIO(data)).getBestCmap()) == missing
        print(f'{family}: all {len(font.getBestCmap())} source codepoints covered')
        continue
    options = subset.Options()
    options.layout_features = ['*']
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=missing)
    subsetter.subset(font)
    font.flavor = 'woff2'
    output = BytesIO()
    font.save(output)
    data = output.getvalue()
    digest = hashlib.sha256(data).hexdigest()
    name = digest[:20] + '.woff2'
    (folder / name).write_bytes(data)
    records.append({'family': family, 'file': name, 'glyphCodepoints': len(missing), 'bytes': len(data), 'sha256': digest, 'fullSourceSHA256': hashlib.sha256(source.read_bytes()).hexdigest()})
    css += marker + f"\n@font-face {{ font-family: '{family}'; font-style: normal; font-weight: 100 900; font-display: block; src: url(/assets/fonts/modern/{name}) format('woff2'); unicode-range: {unicode_ranges(missing)}; }}\n"
if not args.check:
    css_path.write_text(css)
    manifest['supplements'] = records
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
