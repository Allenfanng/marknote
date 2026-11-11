/** 是否运行在 Tauri WebView 内（纯 vite dev 浏览器下为 false）。 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}