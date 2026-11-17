import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile, access, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const ws = require('../electron/workspace.cjs')

test('Git blame and history never execute repository text conversion commands', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'khef-git-security-'))
  const handlers = new Map<string, (...args: any[]) => Promise<any>>()
  const gitPath = require.resolve('../electron/git.cjs')
  const localRequire = createRequire(gitPath)
  const module = { exports: {} as any }
  // Load the actual IPC implementation without launching Electron.
  vm.runInThisContext(`(function(require, module, exports) {${readFileSync(gitPath, 'utf8')}\n})`)(
    (id: string) => id === 'electron'
      ? { ipcMain: { handle: (name: string, fn: any) => handlers.set(name, fn) } }
      : localRequire(id), module, module.exports,
  )
  module.exports.registerGitIpc()
  const wcId = 987654
  const event = { sender: { id: wcId } }
  const git = (...args: string[]) => execFileSync('git', args, {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  }).trim()
  try {
    git('init', '--quiet')
    await writeFile(path.join(root, 'sample.txt'), 'original text\n')
    await writeFile(path.join(root, '.gitattributes'), '*.txt diff=hostile\n')
    git('add', '.')
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
      '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Fixture')
    // Harmless proof of execution: this would be an arbitrary shell command in a
    // hostile repository's .git/config. Blame enables textconv by default.
    git('config', 'diff.hostile.textconv', 'printf triggered > textconv-executed; cat')
    await ws.setWorkspaceRoot(wcId, root)
    const blame = await handlers.get('git:blame')!(event, 'sample.txt')
    assert.equal(blame.runs.length, 1)
    assert.equal(blame.runs[0].author, 'Fixture')
    await handlers.get('git:log')!(event, 0, 50)
    await handlers.get('git:fileHistory')!(event, 'sample.txt', 0, 50)
    await handlers.get('git:commitDetail')!(event, git('rev-parse', 'HEAD'))
    await assert.rejects(access(path.join(root, 'textconv-executed')), { code: 'ENOENT' })
  } finally {
    ws.clearWorkspaceRoot(wcId)
    await rm(root, { recursive: true, force: true })
  }
})
