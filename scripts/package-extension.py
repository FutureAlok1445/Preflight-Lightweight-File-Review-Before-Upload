"""Create clean, reproducible Chromium and Firefox distribution packages."""
from pathlib import Path
import json
import zipfile
import shutil

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
RUNTIME_DIRS = ['core', 'popup', 'optimizer', 'upload', 'compression', 'icons', 'lib', 'docs']
RUNTIME_FILES = ['background.js', 'manifest.json', 'README.md', 'PRIVACY.md', 'INSTALL.md']

def build(browser):
    manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
    version = manifest['version']
    destination = DIST / f'preflight-{browser}-{version}'
    # Never delete another path; only overwrite named runtime files in our build folder.
    destination.mkdir(parents=True, exist_ok=True)
    selected = []
    for folder in RUNTIME_DIRS:
        for path in sorted((ROOT / folder).rglob('*')):
            if path.is_file():
                relative = path.relative_to(ROOT)
                target = destination / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, target)
                selected.append(relative)
    for name in RUNTIME_FILES:
        if (ROOT / name).is_file():
            shutil.copy2(ROOT / name, destination / name)
            selected.append(Path(name))
    if browser == 'firefox':
        manifest.pop('minimum_chrome_version', None)
        manifest['background'] = {'scripts': ['background.js'], 'type': 'module'}
        manifest['permissions'].remove('offscreen')
        manifest['browser_specific_settings'] = {'gecko': {
            'id': 'preflight@futurealok1445', 'strict_min_version': '140.0',
            'data_collection_permissions': {'required': ['none']}
        }}
    (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
    archive = DIST / f'preflight-{browser}-{version}.zip'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for relative in sorted(selected):
            info = zipfile.ZipInfo(relative.as_posix(), (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, (destination / relative).read_bytes())
    print(f'{browser}: {archive.name} ({archive.stat().st_size / 1024 / 1024:.1f} MB)')
    return archive

if __name__ == '__main__':
    build('chromium')
    build('firefox')
