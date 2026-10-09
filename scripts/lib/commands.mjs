import { spawnSync } from 'node:child_process'

export function runCommand(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'pipe',
    encoding: 'utf8',
    shell: false,
    ...options,
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim() || ''
    const stdout = result.stdout?.trim() || ''
    const detail = stderr || stdout || `exit code ${result.status}`
    throw new Error(`${command} failed: ${detail}`)
  }

  return result
}
