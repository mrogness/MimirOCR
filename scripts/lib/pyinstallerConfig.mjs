import path from 'node:path'

export function defaultSidecarProfile() {
  return 'standard'
}

export function validateSidecarProfile(profile) {
  if (!['standard', 'lean'].includes(profile)) {
    throw new Error(`Unsupported sidecar profile '${profile}'. Use 'standard' or 'lean'.`)
  }
}

function profileOptions(profile) {
  if (profile !== 'lean') {
    return []
  }

  const excludes = [
    'matplotlib',
    'matplotlib.pyplot',
    'IPython',
    'ipykernel',
    'jupyter_client',
    'jupyter_core',
    'debugpy',
    'pandas',
    'openpyxl',
    'xlsxwriter',
    'tkinter',
    'tensorboard',
    'tensorboard_data_server',
    'tensorboard_plugin_wit',
    'tensorflow.compiler.tf2tensorrt',
    'tensorflow.lite',
    'tensorflow.python.data.experimental.service',
  ]

  const args = ['--strip']
  for (const moduleName of new Set(excludes)) {
    args.push('--exclude-module', moduleName)
  }

  return args
}

function packageCollectionArgs(profile) {
  const useSubmodules = profile === 'lean'
  const args = ['--collect-submodules', 'backend']

  if (useSubmodules) {
    args.push(
      '--collect-submodules',
      'kraken',
      '--collect-submodules',
      'calamari_ocr',
    )
  } else {
    args.push(
      '--collect-all',
      'kraken',
      '--collect-all',
      'calamari_ocr',
    )
  }

  return args
}

export function createPyInstallerArgs({
  profile,
  rootDir,
  outDir,
  bundleName,
  calamariModelsSrc,
  calamariModelsDest,
  krakenBllaModelSrc,
  krakenBllaModelDest,
}) {
  const dataSeparator = process.platform === 'win32' ? ';' : ':'

  return [
    '--noconfirm',
    '--clean',
    '--onedir',
    ...(process.platform === 'win32' ? ['--noconsole'] : []),

    '--paths',
    rootDir,

    ...packageCollectionArgs(profile),

    '--hidden-import',
    'kraken.blla',

    '--hidden-import',
    'kraken.lib.segmentation',

    '--hidden-import',
    'tensorflow.python.profiler.trace',

    '--hidden-import',
    'tensorflow.compiler.tf2tensorrt._pywrap_py_utils',

    '--collect-submodules',
    'tensorflow.compiler.tf2tensorrt',

    '--add-data',
    `${calamariModelsSrc}${dataSeparator}${calamariModelsDest}`,

    ...(krakenBllaModelSrc
      ? [
          '--add-data',
          `${krakenBllaModelSrc}${dataSeparator}${krakenBllaModelDest}`,
        ]
      : []),

    '--name',
    bundleName,

    '--distpath',
    outDir,

    '--workpath',
    path.join('.pyinstaller', 'build'),

    '--specpath',
    path.join('.pyinstaller', 'spec'),

    ...profileOptions(profile),

    path.join('backend', 'sidecar_main.py'),
  ]
}
