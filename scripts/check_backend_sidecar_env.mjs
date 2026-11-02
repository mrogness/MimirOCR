#!/usr/bin/env node
import { runCommand } from './lib/commands.mjs'
import { scriptProjectRootFrom } from './lib/projectPaths.mjs'
import { RUNTIMES, runtimePython } from './lib/runtimes.mjs'

const root = scriptProjectRootFrom(import.meta.url)
const build = process.argv.includes('--build')
try {
  for (const [role, runtime] of Object.entries(RUNTIMES)) {
    const python = runtimePython(root, role)
    console.log(`Checking ${role}: ${python}`)
    runCommand(python, ['-c', `
import importlib, importlib.metadata, importlib.util, sys
assert sys.version_info[:2] == (3, 11), 'Use Python 3.11; resync with scripts/setup_backend.py'
print(f'Interpreter: {sys.executable}', flush=True)
required = ${JSON.stringify(build ? runtime.imports.concat('PyInstaller') : runtime.imports)}
forbidden = ${JSON.stringify(runtime.forbidden)}
missing = [x for x in required if importlib.util.find_spec(x) is None]
unexpected = [x for x in forbidden if importlib.util.find_spec(x) is not None]
assert not missing, f'Missing packages: {missing}'
assert not unexpected, f'Cross-runtime packages installed: {unexpected}; recreate this venv'
for name, expected in ${JSON.stringify(runtime.versions || {})}.items():
    actual = importlib.metadata.version(name)
    print(f'{name}: {actual} (expected {expected})', flush=True)
    assert actual == expected, f'{name} {actual} is incompatible with this adapter; expected {expected}. Recreate .venvs/${role} with scripts/setup_backend.py'
for name in required:
    importlib.import_module(name)
${role === 'segmenter' ? `from kraken.tasks import SegmentationTaskModel
from kraken.configs import SegmentationInferenceConfig
from kraken.lib.segmentation import extract_polygons
from kraken.ketos.util import to_ptl_device` : ''}
${role === 'recognizer' ? 'from calamari_ocr.ocr.predict.predictor import Predictor, PredictorParams' : ''}
`], { stdio: 'inherit' })
    runCommand('uv', ['pip', 'check', '--python', python], { stdio: 'inherit' })
  }
} catch (error) {
  console.error(String(error?.message || error))
  console.error(`Run python scripts/setup_backend.py${build ? ' --build' : ''}; each role requires its own environment.`)
  process.exit(1)
}
