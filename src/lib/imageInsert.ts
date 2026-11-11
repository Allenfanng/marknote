/**
 * 图片插入：把粘贴进编辑器的图片文件存到文档同目录 assets/ 下，
 * 并在光标处插入相对路径引用（Typora 风格）。
 *
 * 拖拽文件（资源管理器 → 窗口）走 Tauri onDragDropEvent，由 App 层调
 * Rust copy_image_asset；粘贴（剪贴板二进制）在这里走 save_image_asset。
 * 文档未保存（无目录）时退化为 base64 data URI。
 */
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './env'

function extFromMime(mime: string): string {
  const m: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'image/avif': 'avif',
  }
  return m[mime] ?? 'png'
}

function blobToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** data-URI 大小上限（未保存文档粘贴的兜底路径，防文档体积爆炸） */
const DATA_URI_LIMIT = 2 * 1024 * 1024

/**
 * 把剪贴板图片写盘并返回 markdown 引用路径。
 * 返回 null 表示无法插入（用户已被告知原因）。
 */
export async function storePastedImage(file: File, docDir: string | null): Promise<string | null> {
  try {
    if (docDir && isTauri()) {
      const buf = new Uint8Array(await file.arrayBuffer())
      const rel = await invoke<string>('save_image_asset', {
        dir: docDir,
        data: Array.from(buf),
        ext: extFromMime(file.type),
      })
      return rel
    }
    // 文档未保存 / 非 Tauri 环境：data URI 兜底
    if (file.size > DATA_URI_LIMIT) {
      alert('图片较大（>2MB）：请先保存文档（Ctrl+S），再粘贴图片，图片将写入文档目录 assets/ 下。')
      return null
    }
    return await blobToDataUrl(file)
  } catch (e) {
    console.error('storePastedImage failed:', e)
    alert('插入图片失败：' + e)
    return null
  }
}

/** 拖拽进窗口的磁盘图片文件 → 复制到 assets/ 并返回相对路径 */
export async function copyDroppedImage(srcPath: string, docDir: string): Promise<string | null> {
  try {
    return await invoke<string>('copy_image_asset', { srcPath, dir: docDir })
  } catch (e) {
    console.error('copyDroppedImage failed:', e)
    alert('复制图片失败：' + e)
    return null
  }
}

/** 判断路径是否为受支持的图片文件（用于拖拽分流） */
export function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(path)
}
