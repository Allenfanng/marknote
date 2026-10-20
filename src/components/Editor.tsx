import { useRef, useImperativeHandle, useState } from 'react'
import { Crepe } from '@milkdown/crepe'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import { $node, $prose, $remark, $view, callCommand } from '@milkdown/utils'
import frontmatter from 'remark-frontmatter'
import {
  toggleStrongCommand,
  toggleEmphasisCommand,
  wrapInHeadingCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  createCodeBlockCommand,
  wrapInBlockquoteCommand,
  toggleLinkCommand,
  insertImageCommand,
  isMarkSelectedCommand,
  isNodeSelectedCommand,
  strongSchema,
  emphasisSchema,
  bulletListSchema,
  orderedListSchema,
  codeBlockSchema,
  blockquoteSchema,
  imageSchema,
} from '@milkdown/kit/preset/commonmark'
import {
  toggleStrikethroughCommand,
  insertTableCommand,
  strikethroughSchema,
} from '@milkdown/kit/preset/gfm'
import {
  addRowAfter,
  addRowBefore,
  addColumnAfter,
  addColumnBefore,
  deleteRow,
  deleteColumn,
  deleteTable,
  TableMap,
} from '@milkdown/kit/prose/tables'
import { Plugin, Selection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'
import type { Node as PMNode } from '@milkdown/kit/prose/model'
import { commandsCtx, editorViewCtx, type Editor as MilkdownEditor } from '@milkdown/kit/core'
import { diagramPlugin, diagramPluginKey } from '../lib/diagramPlugin'
import { clearDiagramCache, setMermaidTheme } from '../lib/diagram'
import { findPlugin, findPluginKey } from '../lib/findPlugin'
import { resolveImgSrc } from '../lib/imgSrc'
import { storePastedImage } from '../lib/imageInsert'

import '@milkdown/crepe/theme/common/reset.css'
import '@milkdown/crepe/theme/common/prosemirror.css'
import '@milkdown/crepe/theme/classic.css'
import '@milkdown/crepe/theme/classic-dark.css'

// --- YAML frontmatter support ---
// Without this, a leading `--- ... ---` block is parsed by CommonMark as
// "thematic break + paragraph + setext H2", rendering the metadata as a
// giant bold heading. Instead we parse it into an atomic `frontmatter`
// node rendered as a monospace panel (like Typora/MarkText). The node is
// read-only in WYSIWYG — edit it in source mode.

// NOTE: initialOptions is required — $remark defaults it to `{}`, and
// remark-frontmatter({}) throws "Missing `type` in matter", killing the
// whole editor init.
const remarkFrontmatterPlugin = $remark('remarkFrontmatter', () => frontmatter, 'yaml')

const frontmatterNode = $node('frontmatter', () => ({
  group: 'block',
  atom: true,
  isolating: true,
  selectable: true,
  marks: '',
  attrs: { value: { default: '' } },
  parseDOM: [
    {
      tag: 'pre.frontmatter',
      getAttrs: (dom) => ({ value: (dom as HTMLElement).textContent ?? '' }),
    },
  ],
  toDOM: (node) => ['pre', { class: 'frontmatter' }, node.attrs.value as string],
  parseMarkdown: {
    match: (node) => node.type === 'yaml',
    runner: (state, node, type) => {
      state.addNode(type, { value: (node.value as string | undefined) ?? '' })
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'frontmatter',
    runner: (state, node) => {
      state.addNode('yaml', undefined, node.attrs.value as string)
    },
  },
}))

/** 插入图表时的起始模板：直接给一份能跑通的样例，用户改起来有参照 */
const MERMAID_TEMPLATE = `flowchart TD
  A[开始] --> B{条件判断}
  B -->|是| C[处理一]
  B -->|否| D[处理二]
  C --> E[结束]
  D --> E`

const SVG_TEMPLATE = `<svg viewBox="0 0 240 90" xmlns="http://www.w3.org/2000/svg">
  <rect x="10" y="10" width="220" height="70" rx="10" fill="#4a6fa5"/>
  <text x="120" y="52" fill="#ffffff" font-size="18" text-anchor="middle">Hello MarkNote</text>
</svg>`

export interface ActiveState {
  bold: boolean
  italic: boolean
  strikethrough: boolean
  heading: number | null
  bulletList: boolean
  orderedList: boolean
  codeBlock: boolean
  blockquote: boolean
}

export type TableOp =
  | 'addRowAfter'
  | 'addRowBefore'
  | 'addColAfter'
  | 'addColBefore'
  | 'deleteRow'
  | 'deleteCol'
  | 'deleteTable'

export interface FindInfo {
  total: number
  active: number
}

export interface EditorHandle {
  ready: boolean
  getMarkdown: () => string
  toggleBold: () => void
  toggleItalic: () => void
  toggleStrikethrough: () => void
  setHeading: (level: 1 | 2 | 3) => void
  toggleBulletList: () => void
  toggleOrderedList: () => void
  insertCodeBlock: () => void
  toggleBlockquote: () => void
  insertLink: (href: string) => void
  insertImage: (src: string, alt?: string) => void
  insertTable: (rows: number, cols: number) => void
  /** 插入带语言标注的图表代码块（mermaid / svg），模板内容会处于选中态 */
  insertDiagram: (lang: 'mermaid' | 'svg') => void
  getActiveState: () => ActiveState
  /** 暴露 ProseMirror view，供表格边缘控件做坐标 ↔ 文档位置的换算 */
  getView: () => EditorView | null
  /** 当前选区快照（Selection.toJSON()），用于标签页切换时记忆位置 */
  getSelectionSnapshot: () => Record<string, unknown> | null
  /** 恢复选区快照（不触发滚动）；偏移非法或文档结构不匹配时返回 false */
  restoreSelectionSnapshot: (json: Record<string, unknown>) => boolean
  /** 对指定表格执行行列增删；tablePos 是表格节点在文档中的起始位置 */
  runTableOp: (op: TableOp, index: number, tablePos: number) => void
  /** 主题切换后让图表按新配色重绘 */
  setTheme: (theme: 'light' | 'dark') => void
  /** 大纲跳转：滚动到指定标题并同步光标 */
  scrollToHeading: (text: string) => void
  /** 查找替换（WYSIWYG）：设置查询词并重算匹配 */
  findSetQuery: (query: string, caseSensitive: boolean) => void
  /** 查找替换（WYSIWYG）：当前匹配总数与激活下标（无匹配时 active 为 -1） */
  getFindState: () => FindInfo
  findNext: () => void
  findPrev: () => void
  replaceCurrent: (replacement: string) => void
  replaceAll: (replacement: string) => number
}

const defaultActive: ActiveState = {
  bold: false,
  italic: false,
  strikethrough: false,
  heading: null,
  bulletList: false,
  orderedList: false,
  codeBlock: false,
  blockquote: false,
}

/** 表格行列增删的公共实现（handle 与 dev 调试钩子共用） */
function runTableOpImpl(
  get: () => MilkdownEditor | undefined,
  op: TableOp,
  index: number,
  tablePos: number,
): void {
  const editor = get()
  if (!editor) return
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const table = view.state.doc.nodeAt(tablePos)
    if (!table || table.type.name !== 'table') return

    const map = TableMap.get(table)
    const isRowOp = op === 'addRowAfter' || op === 'addRowBefore' || op === 'deleteRow'
    const safeRow = Math.min(Math.max(index, 0), map.height - 1)
    const safeCol = Math.min(Math.max(index, 0), map.width - 1)
    // 表头行（第 0 行）不允许删除：删掉后表格不再是合法 GFM 结构，
    // 会被自动修复机制搅乱；UI 侧同时禁用了该入口
    if (op === 'deleteRow' && safeRow === 0) return
    if (op === 'deleteCol' && map.width === 1) return
    if (op === 'deleteRow' && map.height === 1) return
    const cellIndex = isRowOp ? safeRow * map.width : safeCol
    // map.map 是相对表格内容起点的偏移；tablePos 是表格节点前一个位置，
    // 所以 +1 进入节点、再 +1 进入单元格
    const cellPos = tablePos + 1 + map.map[cellIndex] + 1

    const $cell = view.state.doc.resolve(Math.min(cellPos, view.state.doc.content.size))
    view.dispatch(view.state.tr.setSelection(TextSelection.near($cell)))

    switch (op) {
      case 'addRowAfter': addRowAfter(view.state, view.dispatch); break
      case 'addRowBefore': addRowBefore(view.state, view.dispatch); break
      case 'addColAfter': addColumnAfter(view.state, view.dispatch); break
      case 'addColBefore': addColumnBefore(view.state, view.dispatch); break
      // deleteRow/deleteColumn 基于 selectedRect：光标落在哪个单元格，
      // 删的就是那一行 / 那一列（整个表格只剩一行 / 一列时会拒绝删除）
      case 'deleteRow': deleteRow(view.state, view.dispatch); break
      case 'deleteCol': deleteColumn(view.state, view.dispatch); break
      case 'deleteTable': deleteTable(view.state, view.dispatch); break
    }
    view.focus()
  })
}

interface EditorInnerProps {
  defaultValue: string
  onChange: (markdown: string) => void
  editorRef: React.RefObject<EditorHandle | null>
  /** 文档所在目录：相对路径图片据此解析为 asset URL、粘贴图片落盘位置 */
  docDir: string | null
}

/** 图片 nodeView：把 attrs.src 的相对/本地路径解析成 asset:// URL 后再赋给 <img>。
 *  序列化用的是 attrs.src 原值，不受此渲染影响。 */
function makeImageNodeView(docDir: string | null) {
  return (node: PMNode): NodeView => {
    const img = document.createElement('img')
    const apply = (n: PMNode) => {
      img.src = resolveImgSrc(String(n.attrs.src ?? ''), docDir)
      if (n.attrs.alt) img.alt = String(n.attrs.alt)
      else img.removeAttribute('alt')
      if (n.attrs.title) img.title = String(n.attrs.title)
      else img.removeAttribute('title')
    }
    apply(node)
    return {
      dom: img,
      update: (n) => {
        if (n.type.name !== 'image') return false
        apply(n)
        return true
      },
      // src 是外部转换的 asset URL，与 attrs.src 不同，必须忽略 PM 的 mutation 观察
      ignoreMutation: () => true,
    }
  }
}

/** 粘贴图片：剪贴板二进制图片 → assets/ 落盘（或 data URI 兜底）→ 插入 image 节点 */
function makeImagePastePlugin(docDir: string | null) {
  return $prose(() => {
    return new Plugin({
      props: {
        handlePaste: (view, event) => {
          const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
          if (files.length === 0) return false
          event.preventDefault()
          void (async () => {
            for (const file of files) {
              const src = await storePastedImage(file, docDir)
              if (!src) continue
              const type = view.state.schema.nodes.image
              if (!type) continue
              view.dispatch(view.state.tr.replaceSelectionWith(type.create({ src })))
              view.focus()
            }
          })()
          return true
        },
      },
    })
  })
}

function EditorInner({ defaultValue, onChange, editorRef, docDir }: EditorInnerProps) {
  const crepeRef = useRef<Crepe | null>(null)

  const { get } = useEditor((root) => {
    const crepe = new Crepe({
      root,
      defaultValue,
      features: {
        'block-edit': false,
        toolbar: false,
        'top-bar': false,
        'link-tooltip': false,
        'list-item': false,
        'image-block': false,
        placeholder: false,
        'code-mirror': false,
        // v1.9 起开启 LaTeX 数学公式（$...$ / $$...$$），KaTeX 渲染
        latex: true,
      },
      featureConfigs: {
        cursor: { virtual: false },
      },
    })

    crepe.editor
      .use(remarkFrontmatterPlugin)
      .use(frontmatterNode)
      .use(diagramPlugin)
      .use(findPlugin)
      .use($view(imageSchema.node, () => makeImageNodeView(docDir)))
      .use(makeImagePastePlugin(docDir))

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        onChange(markdown)
      })
    })

    crepeRef.current = crepe
    return crepe
  }, [])

  const [initialized, setInitialized] = useState(false)
  if (!initialized && get()) {
    setInitialized(true)
  }

  // 开发模式调试钩子：自动化测试 / 控制台可直接读文档真相
  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__marknoteEditor = {
      getMarkdown: () => crepeRef.current?.getMarkdown() ?? '',
      getView: () => get()?.ctx.get(editorViewCtx) ?? null,
      runTableOp: (op: TableOp, index: number, tablePos: number) =>
        runTableOpImpl(get, op, index, tablePos),
    }
  }

  useImperativeHandle(editorRef, () => ({
    ready: initialized,
    getMarkdown: () => crepeRef.current?.getMarkdown() ?? '',
    toggleBold: () => { get()?.action(callCommand(toggleStrongCommand.key)) },
    toggleItalic: () => { get()?.action(callCommand(toggleEmphasisCommand.key)) },
    toggleStrikethrough: () => { get()?.action(callCommand(toggleStrikethroughCommand.key)) },
    setHeading: (level) => { get()?.action(callCommand(wrapInHeadingCommand.key, level)) },
    toggleBulletList: () => { get()?.action(callCommand(wrapInBulletListCommand.key)) },
    toggleOrderedList: () => { get()?.action(callCommand(wrapInOrderedListCommand.key)) },
    insertCodeBlock: () => { get()?.action(callCommand(createCodeBlockCommand.key)) },
    toggleBlockquote: () => { get()?.action(callCommand(wrapInBlockquoteCommand.key)) },
    insertLink: (href) => { get()?.action(callCommand(toggleLinkCommand.key, { href })) },
    insertImage: (src, alt) => { get()?.action(callCommand(insertImageCommand.key, { src, alt })) },
    insertTable: (rows, cols) => { get()?.action(callCommand(insertTableCommand.key, { row: rows, col: cols })) },

    insertDiagram: (lang) => {
      get()?.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const type = view.state.schema.nodes.code_block
        if (!type) return
        const template = lang === 'svg' ? SVG_TEMPLATE : MERMAID_TEMPLATE
        const { state } = view
        const node = type.create({ language: lang }, state.schema.text(template))
        const $from = state.selection.$from
        let tr = state.tr

        // 光标停在空段落里时直接替换掉这个段落，避免留下一个空行
        const inEmptyBlock = $from.depth > 0 && $from.parent.isTextblock && $from.parent.content.size === 0
        if (inEmptyBlock) {
          tr = tr.replaceWith($from.before($from.depth), $from.after($from.depth), node)
        } else {
          tr = tr.replaceSelectionWith(node)
        }

        // 选中刚插入的模板内容，用户直接敲字就能整体替换掉
        let found = -1
        tr.doc.descendants((n, pos) => {
          if (n.type.name === 'code_block' && n.textContent === template) found = pos
        })
        if (found >= 0) {
          const start = found + 1
          tr = tr.setSelection(TextSelection.create(tr.doc, start, start + template.length))
        }

        view.dispatch(tr.scrollIntoView())
        view.focus()
      })
    },

    getView: () => get()?.ctx.get(editorViewCtx) ?? null,

    getSelectionSnapshot: () => {
      const view = get()?.ctx.get(editorViewCtx)
      return view ? (view.state.selection.toJSON() as Record<string, unknown>) : null
    },

    restoreSelectionSnapshot: (json) => {
      const view = get()?.ctx.get(editorViewCtx)
      if (!view) return false
      try {
        // 不带 scrollIntoView：滚动位置由 App 层按记忆值单独恢复
        view.dispatch(view.state.tr.setSelection(Selection.fromJSON(view.state.doc, json)))
        return true
      } catch {
        // 选区偏移失效（如源码模式改过内容后偏移越界/结构不匹配），放弃恢复
        return false
      }
    },

    runTableOp: (op, index, tablePos) => runTableOpImpl(get, op, index, tablePos),

    setTheme: (t) => {
      setMermaidTheme(t)
      clearDiagramCache()
      // 用一个带 meta 的空事务触发图表装饰重算（选区/文档都没变，否则不会重算）
      get()?.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        view.dispatch(view.state.tr.setMeta(diagramPluginKey, t))
      })
    },

    scrollToHeading: (text) => {
      get()?.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        view.state.doc.descendants((node, pos) => {
          if (node.type.name !== 'heading') return true
          if (node.textContent !== text) return true
          const dom = view.nodeDOM(pos)
          if (dom instanceof HTMLElement) {
            dom.scrollIntoView({ behavior: 'smooth', block: 'start' })
            const $p = view.state.doc.resolve(pos + 1)
            view.dispatch(view.state.tr.setSelection(TextSelection.near($p)))
          }
          return false
        })
        view.focus()
      })
    },

    findSetQuery: (query, caseSensitive) => {
      get()?.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        view.dispatch(view.state.tr.setMeta(findPluginKey, { type: 'query', query, caseSensitive }))
      })
    },

    getFindState: () => {
      const view = get()?.ctx.get(editorViewCtx)
      const st = view ? findPluginKey.getState(view.state) : null
      return st ? { total: st.matches.length, active: st.matches.length > 0 ? st.active : -1 } : { total: 0, active: -1 }
    },

    findNext: () => {
      get()?.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const st = findPluginKey.getState(view.state)
        if (!st || st.matches.length === 0) return
        const active = (st.active + 1) % st.matches.length
        const m = st.matches[active]
        view.dispatch(
          view.state.tr
            .setMeta(findPluginKey, { type: 'active', active })
            .setSelection(TextSelection.create(view.state.doc, m.from, m.to))
            .scrollIntoView(),
        )
        view.focus()
      })
    },

    findPrev: () => {
      get()?.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const st = findPluginKey.getState(view.state)
        if (!st || st.matches.length === 0) return
        const active = (st.active - 1 + st.matches.length) % st.matches.length
        const m = st.matches[active]
        view.dispatch(
          view.state.tr
            .setMeta(findPluginKey, { type: 'active', active })
            .setSelection(TextSelection.create(view.state.doc, m.from, m.to))
            .scrollIntoView(),
        )
        view.focus()
      })
    },

    replaceCurrent: (replacement) => {
      get()?.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const st = findPluginKey.getState(view.state)
        if (!st || st.matches.length === 0) return
        const m = st.matches[st.active] ?? st.matches[0]
        // insertText 不接受换行，压成空格（与多数编辑器一致）
        view.dispatch(
          view.state.tr
            .insertText(replacement.replace(/\r?\n/g, ' '), m.from, m.to)
            .scrollIntoView(),
        )
        view.focus()
      })
    },

    replaceAll: (replacement) => {
      let count = 0
      get()?.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const safe = replacement.replace(/\r?\n/g, ' ')
        // 每替换一个，插件就重算一次 matches；总是替换 matches[0]，
        // 直到不再有匹配（防御上限防死循环）
        while (count < 10000) {
          const st = findPluginKey.getState(view.state)
          if (!st || st.matches.length === 0) break
          const m = st.matches[0]
          view.dispatch(view.state.tr.insertText(safe, m.from, m.to))
          count++
        }
        view.focus()
      })
      return count
    },

    getActiveState: () => {
      const editor = get()
      if (!editor) return defaultActive
      return editor.action((ctx) => {
        const commands = ctx.get(commandsCtx)
        const view = ctx.get(editorViewCtx)
        const { $from } = view.state.selection

        let headingLevel: number | null = null
        for (let d = $from.depth; d > 0; d--) {
          const node = $from.node(d)
          if (node.type.name === 'heading') {
            headingLevel = node.attrs.level as number
            break
          }
        }

        return {
          bold: commands.call(isMarkSelectedCommand.key, strongSchema.type(ctx)),
          italic: commands.call(isMarkSelectedCommand.key, emphasisSchema.type(ctx)),
          strikethrough: commands.call(isMarkSelectedCommand.key, strikethroughSchema.type(ctx)),
          heading: headingLevel,
          bulletList: commands.call(isNodeSelectedCommand.key, bulletListSchema.type(ctx)),
          orderedList: commands.call(isNodeSelectedCommand.key, orderedListSchema.type(ctx)),
          codeBlock: commands.call(isNodeSelectedCommand.key, codeBlockSchema.type(ctx)),
          blockquote: commands.call(isNodeSelectedCommand.key, blockquoteSchema.type(ctx)),
        }
      })
    },
  }), [get, initialized])

  return <Milkdown />
}

interface EditorProps {
  defaultValue: string
  onChange: (markdown: string) => void
  editorRef: React.RefObject<EditorHandle | null>
  /** 文档所在目录：相对图片解析 / 粘贴图片落盘用 */
  docDir: string | null
}

export default function Editor({ defaultValue, onChange, editorRef, docDir }: EditorProps) {
  return (
    <MilkdownProvider>
      <EditorInner
        defaultValue={defaultValue}
        onChange={onChange}
        editorRef={editorRef}
        docDir={docDir}
      />
    </MilkdownProvider>
  )
}
