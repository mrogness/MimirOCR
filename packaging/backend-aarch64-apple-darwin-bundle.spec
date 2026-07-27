# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules

hiddenimports = ['kraken.blla', 'kraken.lib.segmentation']
hiddenimports += collect_submodules('backend')
hiddenimports += collect_submodules('kraken')
hiddenimports += collect_submodules('calamari_ocr')


a = Analysis(
    ['../../backend/sidecar_main.py'],
    pathex=['/Users/matthew/personal-projects/fraktur/mimir-venv'],
    binaries=[],
    datas=[('/Users/matthew/personal-projects/fraktur/mimir-venv/backend/ml/calamari', 'backend/ml/calamari'), ('/Users/matthew/personal-projects/fraktur/mimir-venv/.venv/lib/python3.10/site-packages/kraken/blla.mlmodel', 'kraken')],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['matplotlib', 'matplotlib.pyplot', 'IPython', 'ipykernel', 'jupyter_client', 'jupyter_core', 'debugpy', 'pandas', 'openpyxl', 'xlsxwriter', 'tkinter', 'tensorboard', 'tensorboard_data_server', 'tensorboard_plugin_wit', 'tensorflow.compiler.tf2tensorrt', 'tensorflow.lite', 'tensorflow.python.profiler', 'tensorflow.python.data.experimental.service'],
    noarchive=False,
    optimize=0,
)

duplicate_destinations = {
    "_pywrap_tensorflow_internal.so",
    "libtensorflow_cc.2.dylib",
    "libtensorflow_framework.2.dylib",
}

a.binaries = [
    entry
    for entry in a.binaries
    if entry[0] not in duplicate_destinations
]

pyz = PYZ(a.pure)


exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='backend-aarch64-apple-darwin-bundle',
    debug=False,
    bootloader_ignore_signals=False,
    strip=True,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=True,
    upx=True,
    upx_exclude=[],
    name='backend-aarch64-apple-darwin-bundle',
)
