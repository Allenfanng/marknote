import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')
const targetDir = join(projectRoot, 'src-tauri', 'target', 'release')

const releaseRoot = join(projectRoot, '..', 'release')
if (!existsSync(releaseRoot)) mkdirSync(releaseRoot, { recursive: true })

const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8'))
const version = pkg.version

// Clean old release files before copying
for (const old of readdirSync(releaseRoot)) {
  if (old.startsWith('MarkNote_') || old.startsWith('marknote_')) {
    unlinkSync(join(releaseRoot, old))
  }
}

// Portable exe
const exePath = join(targetDir, 'marknote.exe')
if (existsSync(exePath)) {
  const dest = join(releaseRoot, `marknote_${version}_portable.exe`)
  copyFileSync(exePath, dest)
  console.log(`Copied: marknote_${version}_portable.exe`)
}

// Bundle files (msi + nsis installer) — only current version
const bundleDir = join(targetDir, 'bundle')
if (existsSync(bundleDir)) {
  for (const dir of ['msi', 'nsis']) {
    const d = join(bundleDir, dir)
    if (!existsSync(d)) continue
    for (const f of readdirSync(d)) {
      if (f.includes(version)) {
        copyFileSync(join(d, f), join(releaseRoot, f))
        console.log(`Copied: ${f}`)
      }
    }
  }
}

console.log('Release files synced successfully.')
