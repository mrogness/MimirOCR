import path from 'node:path'

export const RUNTIMES = {
  backend: { name: 'backend-runtime', entry: 'backend/sidecar_main.py',
    imports: ['fastapi', 'uvicorn', 'sqlalchemy', 'pydantic', 'multipart', 'PIL', 'fitz', 'reportlab'],
    forbidden: ['kraken', 'calamari_ocr', 'torch', 'tensorflow', 'coremltools'] },
  segmenter: { name: 'mimir-segmenter', entry: 'backend/workers/segmenter.py',
    imports: ['pydantic', 'PIL', 'numpy', 'kraken', 'torch', 'torchvision', 'coremltools'],
    forbidden: ['calamari_ocr', 'tensorflow', 'fastapi'] },
  recognizer: { name: 'mimir-recognizer', entry: 'backend/workers/recognizer.py',
    imports: ['pydantic', 'PIL', 'numpy', 'calamari_ocr', 'tensorflow'],
    forbidden: ['kraken', 'torch', 'coremltools', 'fastapi'] },
}

export function runtimePython(root, role) {
  const key = role === 'backend' ? 'MIMIR_PYTHON' : `MIMIR_${role.toUpperCase()}_PYTHON`
  return process.env[key] || path.join(root, '.venvs', role,
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
}

export function executable(root, role) {
  const { name } = RUNTIMES[role]
  return path.join(root, 'src-tauri', 'resources', name,
    name + (process.platform === 'win32' ? '.exe' : ''))
}
