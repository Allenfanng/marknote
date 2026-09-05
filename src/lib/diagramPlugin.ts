import { $prose } from '@milkdown/utils'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { getDiagramLang, renderMermaid, getCachedMermaid, sanitizeSvg, escapeHtml } from './diagram'
import { serializeSvg, exportSvgFile, openDiagramViewer } from './diagramActions'

/**
 * 图表块：把 ```mermaid / ```svg 代码块就地渲染成图。
 *
 * 做法是用 decoration 隐藏代码块本体，再在同一个位置插一个 widget 承载渲染
 * 结果；当光标落进该代码块时（点一下图即可）自动撤掉装饰、露出源码供编辑。
 * 这样既不需要改 schema，也不会破坏 markdown 的序列化往返。
 */

export const diagramPluginKey = new PluginKey<DecorationSet>('marknote-diagram')

const DIAGRAM_POS_ATTR = 'data-diagram-pos'
const DIAGRAM_ACTION_ATTR = 'data-diagram-action'

/** lucide 图标路径（widget 是命令式 DOM，用不了 React 组件，只能内联） */
const ICONS: Record<string, string> = {
  zoom: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
  export: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  edit: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z',
}

function makeIcon(name: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', ICONS[name])
  svg.appendChild(path)
  return svg
}

function makeAction(name: string, title: string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'diagram-action-btn'
  btn.title = title
  btn.setAttribute(DIAGRAM_ACTION_ATTR, name)
  btn.setAttribute('aria-label', title)
  btn.appendChild(makeIcon(name))
  return btn
}

function hash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36)
}

function makeWidget(code: string, lang: 'mermaid' | 'svg', pos: number): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'diagram-preview'
  wrap.setAttribute(DIAGRAM_POS_ATTR, String(pos))
  wrap.title = '点击编辑图表源码'
  // widget 挂在 contenteditable 里，必须显式关掉编辑能力，否则浏览器会
  // 往里插文本、ProseMirror 却看不到
  wrap.contentEditable = 'false'

  const body = document.createElement('div')
  body.className = 'diagram-preview-body'
  wrap.appendChild(body)

  // 操作条：全屏放大 / 导出 SVG / 编辑源码。图没渲染出来之前先禁用
  const actions = document.createElement('div')
  actions.className = 'diagram-actions'
  const zoomBtn = makeAction('zoom', '全屏查看 (可缩放)')
  const exportBtn = makeAction('export', '导出为 SVG 文件')
  const editBtn = makeAction('edit', '编辑图表源码')
  for (const b of [zoomBtn, exportBtn, editBtn]) {
    b.disabled = true
    actions.appendChild(b)
  }
  wrap.appendChild(actions)

  const toast = document.createElement('div')
  toast.className = 'diagram-toast'
  wrap.appendChild(toast)
  let toastTimer: ReturnType<typeof setTimeout> | undefined
  const showToast = (msg: string, isError = false) => {
    toast.textContent = msg
    toast.classList.toggle('error', isError)
    toast.classList.add('visible')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2000)
  }

  const langLabel = lang === 'svg' ? 'SVG 图' : 'Mermaid 图表'

  zoomBtn.addEventListener('click', () => {
    const svg = body.querySelector('svg')
    if (!svg) return
    openDiagramViewer({ svg: serializeSvg(svg), title: langLabel })
  })

  exportBtn.addEventListener('click', () => {
    const svg = body.querySelector('svg')
    if (!svg) return
    exportSvgFile(svg, `diagram-${Date.now()}.svg`)
      .then((ok) => {
        // null = 用户在保存对话框里点了取消，不算失败
        if (ok === null) return
        showToast(ok ? '已导出 SVG' : '导出失败')
      })
      .catch((e: unknown) => {
        showToast(`导出失败：${e instanceof Error ? e.message : String(e)}`, true)
      })
  })

  // 编辑源码：和点图一样，把光标送进被隐藏的代码块
  editBtn.addEventListener('click', () => {
    wrap.dispatchEvent(
      new CustomEvent('diagram-edit-request', { bubbles: true, detail: { pos } })
    )
  })

  const onRendered = () => {
    const hasSvg = !!body.querySelector('svg')
    zoomBtn.disabled = !hasSvg
    exportBtn.disabled = !hasSvg
    editBtn.disabled = false
  }

  if (lang === 'svg') {
    const svg = sanitizeSvg(code)
    body.innerHTML = svg || '<div class="diagram-error">SVG 解析失败</div>'
    onRendered()
    return wrap
  }

  const cached = getCachedMermaid(code)
  if (cached !== undefined) {
    body.innerHTML = cached
    onRendered()
    return wrap
  }

  body.innerHTML = '<div class="diagram-loading">图表渲染中…</div>'
  renderMermaid(code)
    .then((svg) => {
      // DOM 可能已被后续重绘替换，这里只管往容器里塞，旧节点会被 GC
      body.innerHTML = svg
      onRendered()
    })
    .catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e)
      body.innerHTML = `<div class="diagram-error">图表渲染失败：${escapeHtml(msg)}</div>`
      onRendered()
    })

  return wrap
}

function build(state: EditorState): DecorationSet {
  const decos: Decoration[] = []
  const { from: selFrom, to: selTo } = state.selection

  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'code_block') return true
    const lang = getDiagramLang(String(node.attrs.language ?? ''))
    if (!lang) return true

    const to = pos + node.nodeSize
    // 光标在块内 → 老老实实显示源码，让用户能改
    if (selFrom >= pos && selTo <= to) return false

    const code = node.textContent
    decos.push(Decoration.node(pos, to, { class: 'diagram-source-hidden' }))
    decos.push(
      Decoration.widget(pos, () => makeWidget(code, lang, pos), {
        // side: -1 —— widget 作为 <pre> 的前置兄弟节点插入，否则会被塞进
        // 那个 display:none 的代码块里一起隐藏掉
        side: -1,
        key: `diagram-${lang}-${hash(code)}`,
        ignoreSelection: true,
      })
    )
    return false
  })

  return DecorationSet.create(state.doc, decos)
}

/**
 * 把光标送进指定位置的代码块 —— 代码块被 decoration 隐藏了，只有把光标
 * 放进去，插件才会撤掉隐藏、露出源码供编辑。
 */
function focusCodeBlock(view: EditorView, pos: number): void {
  if (!Number.isFinite(pos) || pos < 0 || pos >= view.state.doc.content.size) return
  const $pos = view.state.doc.resolve(Math.min(pos + 1, view.state.doc.content.size))
  view.dispatch(view.state.tr.setSelection(TextSelection.near($pos)).scrollIntoView())
  view.focus()
}

export const diagramPlugin = $prose(() => {
  return new Plugin<DecorationSet>({
    key: diagramPluginKey,
    state: {
      init: (_config, state) => build(state),
      apply: (tr, value, _oldState, newState) => {
        // 选区变化也要重算：光标进出代码块会切换"显示图 / 显示源码"
        if (tr.docChanged || !tr.selection.eq(_oldState.selection) || tr.getMeta(diagramPluginKey)) {
          return build(newState)
        }
        return value.map(tr.mapping, tr.doc)
      },
    },
    props: {
      // 经 PluginKey 取 state，避免在初始化表达式里自引用造成循环类型推断
      decorations: (state) => diagramPluginKey.getState(state) ?? DecorationSet.empty,
      // 点击图表 → 把光标放进被隐藏的代码块，进入编辑状态
      handleDOMEvents: {
        mousedown: (view, event) => {
          const target = event.target as HTMLElement | null
          // 点操作条上的按钮时放行，交给按钮自己的 click 处理
          if (target?.closest?.(`[${DIAGRAM_ACTION_ATTR}]`)) return false
          const wrap = target?.closest?.(`[${DIAGRAM_POS_ATTR}]`) as HTMLElement | null
          if (!wrap) return false
          const pos = Number(wrap.getAttribute(DIAGRAM_POS_ATTR))
          if (!Number.isFinite(pos) || pos < 0 || pos >= view.state.doc.content.size) return false
          event.preventDefault()
          focusCodeBlock(view, pos)
          return true
        },
      },
    },
    // widget 里的"编辑源码"按钮通过冒泡事件把请求送上来
    view(editorView) {
      const dom = editorView.dom
      const onEdit = (event: Event) => {
        const detail = (event as CustomEvent<{ pos?: number }>).detail
        if (!detail || typeof detail.pos !== 'number') return
        focusCodeBlock(editorView, detail.pos)
      }
      dom.addEventListener('diagram-edit-request', onEdit)
      return {
        destroy() {
          dom.removeEventListener('diagram-edit-request', onEdit)
        },
      }
    },
  })
})

export type { EditorView }
