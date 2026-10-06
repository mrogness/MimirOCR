import path from 'node:path'
import { RUNTIMES } from './runtimes.mjs'

export function createPyInstallerArgs(root, role, krakenModel) {
  const runtime = RUNTIMES[role]
  const separator = process.platform === 'win32' ? ';' : ':'
  const args = ['--noconfirm', '--clean', '--onedir', '--console',
    '--paths', root, '--name', runtime.name,
    '--distpath', path.join(root, 'src-tauri', 'resources'),
    '--workpath', path.join(root, '.pyinstaller', role, 'build'),
    '--specpath', path.join(root, '.pyinstaller', role, 'spec')]
  for (const name of [...runtime.forbidden, 'backend.tests']) {
    args.push('--exclude-module', name)
  }
  if (role === 'segmenter') {
    args.push('--exclude-module', 'backend.workers.recognizer',
      '--exclude-module', 'backend.stages.ocr', '--collect-all', 'kraken',
      '--add-data', `${krakenModel}${separator}kraken`)
  } else if (role === 'recognizer') {
    args.push('--exclude-module', 'backend.workers.segmenter',
      '--exclude-module', 'backend.stages.segment', '--collect-all', 'calamari_ocr',
      '--hidden-import', 'tensorflow.python.profiler.trace',
      '--collect-submodules', 'tensorflow.compiler.tf2tensorrt',
      '--add-data', `${path.join(root, 'backend/ml/calamari')}${separator}backend/ml/calamari`,
      '--add-data', `${path.join(root, 'backend/resources/fraktur_ij_lexicon.txt')}${separator}backend/resources`)
  } else {
    args.push('--exclude-module', 'backend.workers.segmenter',
      '--exclude-module', 'backend.workers.recognizer',
      '--exclude-module', 'backend.stages.segment', '--exclude-module', 'backend.stages.ocr')
  }
  args.push(path.join(root, runtime.entry))
  return args
}
