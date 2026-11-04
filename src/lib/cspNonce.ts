/**
 * 读取 Tauri 注入的 CSP nonce。
 *
 * 背景：Tauri 启动时会给 index.html 里的内联 <style> 注入一个随机 nonce，
 * 并把它写进 CSP 头的 style-src：
 *
 *   style-src 'self' 'unsafe-inline' 'nonce-14306499248385515550'
 *
 * 按 CSP 规范，style-src 里一旦出现 nonce / hash，'unsafe-inline' 就会被忽略，
 * 于是所有「没有 nonce 的内联 <style>」都会被浏览器拒绝。
 *
 * CodeMirror 6 正是靠运行时动态创建 <style>（StyleModule）来注入自己的主题，
 * 这些 <style> 没有 nonce → 全部被拒 → 代码块丢失 .cm-content/.cm-line/.cm-gutters
 * 等全部样式，行号竖着堆成一列、代码正文被挤到视口外（v1.9.0 的现象）。
 *
 * CodeMirror 提供了 EditorView.cspNonce facet 专门用于这个场景：
 * 把同一个 nonce 喂给它，它创建的 <style> 就会带上 nonce，从而通过 CSP。
 *
 * nonce 从 DOM 里现成的 <style> 元素上取（浏览器会隐藏 nonce 属性的内容属性值，
 * 但 HTMLElement.nonce IDL 属性仍然返回真实值）。
 */

/** 从页面上任一带 nonce 的 <style> 上取出 nonce 值，取不到返回空串。 */
export function readCspNonce(): string {
  if (typeof document === 'undefined') return ''
  const styles = document.querySelectorAll('style')
  for (const style of styles) {
    // HTMLElement.nonce 是 IDL 属性：即使 content attribute 被浏览器隐藏，
    // 它仍然返回真实的 nonce 值。
    const nonce = (style as HTMLElement).nonce
    if (nonce) return nonce
  }
  return ''
}
