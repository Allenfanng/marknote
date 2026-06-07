import { readdirSync, copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')
const bundleDir = resolve(projectRoot, 'src-tauri', 'target', 'release', 'bundle')
const releaseDir = resolve(projectRoot, '..', 'release')

if (!existsSync(bundleDir)) {
  console.log('Bundle directory not found, skipping copy.')
  process.exit(0)
}

if (!existsSync(releaseDir)) {
  mkdirSync(releaseDir, { recursive: true })
}

const dirs = [
  { subdir: 'msi', pattern: /\.msi$/ },
  { subdir: 'nsis', pattern: /-setup\.exe$/ },
]

for (const { subdir, pattern } of dirs) {
  const sourceDir = resolve(bundleDir, subdir)
  if (!existsSync(sourceDir)) {
    console.log(`  ${subdir}/ not found, skipping.`)
    continue
  }
  const files = readdirSync(sourceDir).filter((f) => pattern.test(f))
  for (const file of files) {
    const src = resolve(sourceDir, file)
    const dest = resolve(releaseDir, file)
    copyFileSync(src, dest)
    console.log(`  copied: ${file}`)
  }
}

// Copy portable exe from target/release/
const portableExe = resolve(projectRoot, 'src-tauri', 'target', 'release', 'marknote.exe')
if (existsSync(portableExe)) {
  const destName = `MarkNote_${process.env.npm_package_version || 'portable'}_x64.exe`
  const dest = resolve(releaseDir, destName)
  copyFileSync(portableExe, dest)
  console.log(`  copied: ${destName}`)
} else {
  console.log('  portable exe not found, skipping.')
}

console.log('Done. Release artifacts synced to /release.')
