import { useRef, useImperativeHandle, useState } from 'react'
import { Crepe } from '@milkdown/crepe'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import { callCommand, $node, $remark } from '@milkdown/utils'
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
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { commandsCtx, editorViewCtx, type Editor as MilkdownEditor } from '@milkdown/kit/core'
import { diagramPlugin, diagramPluginKey } from '../lib/diagramPlugin'
import { clearDiagramCache, setMermaidTheme } from '../lib/diagram'

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
  getActiveState: () => ActiveState
  /** 暴露 ProseMirror view，供表格边缘控件做坐标 ↔ 文档位置的换算 */
  getView: () => EditorView | null
  /** 对指定表格执行行列增删；tablePos 是表格节点在文档中的起始位置 */
  runTableOp: (op: TableOp, index: number, tablePos: number) => void
  /** 主题切换后让图表按新配色重绘 */
  setTheme: (theme: 'light' | 'dark') => void
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
}

function EditorInner({ defaultValue, onChange, editorRef }: EditorInnerProps) {
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
        latex: false,
      },
      featureConfigs: {
        cursor: { virtual: false },
      },
    })

    crepe.editor
      .use(remarkFrontmatterPlugin)
      .use(frontmatterNode)
      .use(diagramPlugin)

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
    getView: () => get()?.ctx.get(editorViewCtx) ?? null,

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
}

export default function Editor({ defaultValue, onChange, editorRef }: EditorProps) {
  return (
    <MilkdownProvider>
      <EditorInner
        defaultValue={defaultValue}
        onChange={onChange}
        editorRef={editorRef}
      />
    </MilkdownProvider>
  )
}
