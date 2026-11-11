declare module '@traptitech/markdown-it-katex' {
  import type MarkdownIt from 'markdown-it'
  /** markdown-it 数学插件；options 透传给 katex.renderToString */
  const plugin: (md: MarkdownIt, options?: Record<string, unknown>) => void
  export default plugin
}