import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, emit } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { FileText } from 'lucide-react'
import type { EditorHandle } from './components/Editor'
import TabBar, { type Tab, type TabViewState } from './components/TabBar'
import Toolbar from './components/Toolbar'
import TableControls from './components/TableControls'
import DiagramViewer from './components/DiagramViewer'
import SourceView from './components/SourceView'
import Sidebar from './components/Sidebar'
import StatusBar from './components/StatusBar'
import FindReplace from './components/FindReplace'
import { prepareDiagrams } from './lib/diagram'
import { renderMarkdown } from './lib/markdown'
import { getDocDir } from './lib/imgSrc'
import { copyDroppedImage, isImagePath } from './lib/imageInsert'
import { DIAGRAM_ZOOM_EVENT, type DiagramZoomDetail } from './lib/diagramActions'
import './App.css'

const MD_EXTENSIONS = ['.md', '.markdown', '.txt']
const AUTO_SAVE_INTERVAL = 3 * 60 * 1000
const FONT_SIZE_STORAGE_KEY = 'marknote-font-size'
const DEFAULT_FONT_SIZE = 16
const WIDTH_MODE_STORAGE_KEY = 'marknote-width-mode'

export type WidthMode = 'narrow' | 'fluid'

function getInitialFontSize(): number {
  const saved = Number(localStorage.getItem(FONT_SIZE_STORAGE_KEY))
  return Number.isInteger(saved) && saved >= 10 && saved <= 32 ? saved : DEFAULT_FONT_SIZE
}

function getInitialWidthMode(): WidthMode {
  return localStorage.getItem(WIDTH_MODE_STORAGE_KEY) === 'fluid' ? 'fluid' : 'narrow'
}

let isFirstStartupFileOpen = true

let tabIdCounter = 0
function nextTabId() { return `tab-${++tabIdCounter}` }

function isMarkdownFile(path: string): boolean {
  const lower = path.toLowerCase()
  return MD_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

/** 查询单个文件 mtime（毫秒）；不存在返回 null */
async function getFileMtime(path: string): Promise<number | null> {
  try {
    const list = await invoke<(number | null)[]>('get_file_mtimes', { paths: [path] })
    return list[0] ?? null
  } catch {
    return null
  }
}

/* ---------------- 会话持久化（未保存草稿随标签一起存） ---------------- */

interface SavedSession {
  activeTabId: string
  tabs: Array<{
    filePath: string | null
    content: string
    sourceContent: string
    isDirty: boolean
    viewMode: 'wysiwyg' | 'source'
    viewState?: TabViewState
  }>
}

function serializeSession(tabs: Tab[], activeTabId: string): string {
  const session: SavedSession = {
    activeTabId,
    tabs: tabs
      // 无文件且未修改的空白标签没有恢复价值
      .filter((t) => t.filePath !== null || t.isDirty)
      .map((t) => ({
        filePath: t.filePath,
        content: t.content,
        sourceContent: t.sourceContent,
        isDirty: t.isDirty,
        viewMode: t.viewMode,
        viewState: t.viewState,
      })),
  }
  return JSON.stringify(session)
}

function createTab(overrides?: Partial<Tab>): Tab {
  const content = '# Welcome to MarkNote\n\nStart typing...\n'
  return {
    id: nextTabId(),
    filePath: null,
    content,
    sourceContent: content,
    isDirty: false,
    viewMode: 'wysiwyg',
    ...overrides,
  }
}

function App() {
  const [tabs, setTabs] = useState<Tab[]>([createTab()])
  // useState initializer args are evaluated on every render — guard for the
  // empty-tabs state (all tabs closed).
  const [activeTabId, setActiveTabId] = useState(tabs[0]?.id ?? '')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const editorRef = useRef<EditorHandle | null>(null)
  // editorHandle 提升为 state：渲染期读 ref.current 传 props 会让子组件
  // 拿到的引用过期（依赖别的 state 变化「碰巧」重渲染才刷新）
  const [editorHandle, setEditorHandle] = useState<EditorHandle | null>(null)
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const [editorReady, setEditorReady] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [editorKey, setEditorKey] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [closeConfirm, setCloseConfirm] = useState<{ tabId: string; tabName: string } | null>(null)
  // 窗口关闭确认（Rust 拦截 CloseRequested 后发 close-requested 事件）
  const [exitConfirm, setExitConfirm] = useState(false)
  const [fontSize, setFontSize] = useState(getInitialFontSize)
  const [widthMode, setWidthMode] = useState<WidthMode>(getInitialWidthMode)
  // 图表全屏查看：由 diagramPlugin 里的悬浮按钮通过自定义事件唤起
  const [zoomDiagram, setZoomDiagram] = useState<DiagramZoomDetail | null>(null)
  // 查找替换面板（WYSIWYG 与源码模式通用）
  const [findOpen, setFindOpen] = useState(false)
  const [findShowReplace, setFindShowReplace] = useState(false)
  const justLoadedRef = useRef(true)
  // 编辑器 ready 时的归一化内容快照：Milkdown 初始化期会发若干虚假
  // markdownUpdated（内容 === baseline），据此与用户真实输入区分，
  // 避免旧「500ms 时间窗」方案在窗口期内吞掉用户输入
  const editorBaselineRef = useRef<string | null>(null)
  const editorScrollRef = useRef<HTMLElement>(null)
  const sourceTextareaRef = useRef<HTMLTextAreaElement>(null)
  const [EditorModule, setEditorModule] = useState<React.ComponentType<{
    defaultValue: string
    onChange: (markdown: string) => void
    editorRef: React.RefObject<EditorHandle | null>
    docDir: string | null
  }> | null>(null)

  // Lazy-load Editor after mount and show window once rendered
  useEffect(() => {
    import('./components/Editor').then((mod) => {
      setEditorModule(() => mod.default)
    })
  }, [])

  const tabsRef = useRef(tabs)
  const activeTabIdRef = useRef(activeTabId)

  useEffect(() => { tabsRef.current = tabs }, [tabs])
  useEffect(() => { activeTabIdRef.current = activeTabId }, [activeTabId])

  // 图表预览的「放大」按钮 → 打开全屏查看器
  useEffect(() => {
    const onZoom = (e: Event) => {
      const detail = (e as CustomEvent<DiagramZoomDetail>).detail
      if (!detail?.svg) return
      setZoomDiagram(detail)
    }
    document.addEventListener(DIAGRAM_ZOOM_EVENT, onZoom)
    return () => document.removeEventListener(DIAGRAM_ZOOM_EVENT, onZoom)
  }, [])

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]
  // 只取视图模式字符串做 effect 依赖：避免每次 tabs 更新都重挂轮询
  const activeViewMode = activeTab?.viewMode


  const updateTab = useCallback((tabId: string, updates: Partial<Tab>) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, ...updates } : t))
    )
  }, [])

  const saveCurrentEditorContent = useCallback(() => {
    if (!editorRef.current?.ready) return
    const md = editorRef.current.getMarkdown()
    updateTab(activeTabIdRef.current, { content: md })
  }, [updateTab])

  const resetEditor = useCallback(() => {
    setEditorReady(false)
    justLoadedRef.current = true
    editorBaselineRef.current = null
    setEditorHandle(null)
    setEditorKey((k) => k + 1)
  }, [])

  // 记住当前标签页离开时的视图状态（滚动位置 + 光标/选区），
  // 切回时由下方两个恢复 effect 还原
  const captureViewState = useCallback(() => {
    const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current)
    if (!tab) return
    const viewState: TabViewState = { ...tab.viewState }
    if (tab.viewMode === 'wysiwyg') {
      const el = editorScrollRef.current
      if (el) {
        viewState.wysiwyg = { ...viewState.wysiwyg, scrollTop: el.scrollTop }
      }
      const handle = editorRef.current
      const selection = handle?.ready ? handle.getSelectionSnapshot() : null
      if (selection) {
        viewState.wysiwyg = { ...viewState.wysiwyg, selection }
      }
    } else {
      const ta = sourceTextareaRef.current
      if (ta) {
        viewState.source = {
          scrollTop: ta.scrollTop,
          cursor: { start: ta.selectionStart, end: ta.selectionEnd },
        }
      }
    }
    updateTab(tab.id, { viewState })
  }, [updateTab])

  // 统一的切换标签路径：捕获离开状态 → 保存内容 → 激活目标标签 → 重建编辑器。
  // 点击标签 / 打开已打开文件 / 侧边栏 / 拖放 / 滚轮切换都走这里
  const switchToTab = useCallback((tabId: string) => {
    if (tabId === activeTabIdRef.current) return
    captureViewState()
    saveCurrentEditorContent()
    setActiveTabId(tabId)
    resetEditor()
    // 查找面板与标签绑定（WYSIWYG 插件 state 随编辑器重建），切走即关闭
    setFindOpen(false)
    setFindShowReplace(false)
  }, [captureViewState, saveCurrentEditorContent, resetEditor])

  useEffect(() => {
    document.body.setAttribute('data-theme', theme)
  }, [theme])

  // 显示模式（窄栏 / 跟随窗口）写入 localStorage，下次启动保持
  useEffect(() => {
    localStorage.setItem(WIDTH_MODE_STORAGE_KEY, widthMode)
  }, [widthMode])

  const toggleWidthMode = useCallback(() => {
    setWidthMode((prev) => (prev === 'narrow' ? 'fluid' : 'narrow'))
  }, [])

  // 主题切换后让 mermaid 按新配色重绘
  useEffect(() => {
    if (!editorReady) return
    editorRef.current?.setTheme(theme)
  }, [theme, editorReady])

  const loadFile = useCallback(async (path: string) => {
    try {
      // If this file is already open, switch to its tab instead of creating a
      // duplicate — the file-opened event (double-clicking a file in Explorer)
      // can fire repeatedly for the same path.
      const existing = tabsRef.current.find((t) => t.filePath === path)
      if (existing) {
        switchToTab(existing.id)
        return
      }
      const res = await invoke<{ content: string; encoding: string }>('read_file', { path })
      const text = res.content
      const mtime = await getFileMtime(path)
      let targetTabId: string | undefined
      setTabs((prev) => {
        const soleTab = prev.length === 1 ? prev[0] : null
        if (
          isFirstStartupFileOpen &&
          soleTab &&
          soleTab.filePath === null &&
          !soleTab.isDirty
        ) {
          isFirstStartupFileOpen = false
          targetTabId = soleTab.id
          return [{ ...soleTab, filePath: path, content: text, sourceContent: text, encoding: res.encoding, lastMtimeMs: mtime }]
        }
        const newTab = createTab({
          filePath: path,
          content: text,
          sourceContent: text,
          encoding: res.encoding,
          lastMtimeMs: mtime,
        })
        targetTabId = newTab.id
        return [...prev, newTab]
      })
      // 目标是另一个标签页（而非启动时替换唯一空白标签）才需要记住离开位置
      if (targetTabId !== undefined && targetTabId !== activeTabIdRef.current) {
        captureViewState()
      }
      setActiveTabId(targetTabId!)
      resetEditor()
      invoke('add_recent_file', { path }).catch(console.error)
    } catch (e) {
      console.error('Failed to load file:', e)
      alert('打开文件失败：' + path + '\n\n' + e)
    }
  }, [switchToTab, captureViewState, resetEditor])

  // On startup, check if this window was opened with a file parameter
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const fileParam = params.get('file')
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 启动时一次性打开 URL 参数指定的文件
    if (fileParam) loadFile(fileParam)
  }, [loadFile])

  // 会话恢复：上次打开的标签（含未保存草稿与各自的滚动位置）。
  // 未修改的文件从磁盘重读最新内容；dirty 文件恢复草稿并保持未保存状态
  const restoreSession = useCallback(async () => {
    try {
      const raw = await invoke<string | null>('get_session')
      if (!raw) return
      const parsed = JSON.parse(raw) as SavedSession
      if (!parsed?.tabs?.length) return
      const restored: Tab[] = []
      for (const st of parsed.tabs) {
        if (!st.filePath) {
          // 从未保存过的新建文档：恢复草稿
          restored.push(createTab({
            content: st.content,
            sourceContent: st.sourceContent,
            isDirty: st.isDirty,
            viewMode: st.viewMode,
            viewState: st.viewState,
          }))
          continue
        }
        const mtime = await getFileMtime(st.filePath)
        if (!st.isDirty) {
          try {
            const res = await invoke<{ content: string; encoding: string }>('read_file', { path: st.filePath })
            restored.push(createTab({
              filePath: st.filePath,
              content: res.content,
              sourceContent: res.content,
              encoding: res.encoding,
              viewMode: st.viewMode,
              viewState: st.viewState,
              lastMtimeMs: mtime,
            }))
          } catch {
            // 文件已不存在，跳过该标签
          }
        } else {
          // dirty 文件：恢复草稿内容，保留未保存标记
          restored.push(createTab({
            filePath: st.filePath,
            content: st.content,
            sourceContent: st.sourceContent,
            isDirty: true,
            viewMode: st.viewMode,
            viewState: st.viewState,
            lastMtimeMs: mtime,
          }))
        }
      }
      if (restored.length === 0) return
      isFirstStartupFileOpen = false
      setTabs(restored)
      setActiveTabId(restored.find((t) => t.id === parsed.activeTabId)?.id ?? restored[0].id)
    } catch (e) {
      console.error('restore session failed:', e)
    }
  }, [])

  // 会话保存（标签结构 + 未保存草稿），防抖 2s
  useEffect(() => {
    const handle = setTimeout(() => {
      invoke('save_session', { session: serializeSession(tabs, activeTabId) }).catch(console.error)
    }, 2000)
    return () => clearTimeout(handle)
  }, [tabs, activeTabId])

  // 外部文件变更检测：每 5s 批量查询所有打开文件的 mtime，
  // 变了就在编辑器顶部提示重新加载/忽略
  useEffect(() => {
    const id = setInterval(async () => {
      const opened = tabsRef.current.filter(
        (t) => t.filePath !== null && t.lastMtimeMs != null && !t.externalChanged,
      )
      if (opened.length === 0) return
      try {
        const list = await invoke<(number | null)[]>('get_file_mtimes', {
          paths: opened.map((t) => t.filePath as string),
        })
        opened.forEach((t, i) => {
          const mtime = list[i]
          if (mtime != null && mtime !== t.lastMtimeMs) {
            updateTab(t.id, { externalChanged: true })
          }
        })
      } catch {
        // 查询失败静默跳过，下一轮再试
      }
    }, 5000)
    return () => clearInterval(id)
  }, [updateTab])

  // 外部变更提示条：从磁盘重新加载当前标签
  const handleReloadFromDisk = useCallback(async () => {
    const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current)
    if (!tab?.filePath) return
    try {
      const res = await invoke<{ content: string; encoding: string }>('read_file', { path: tab.filePath })
      const mtime = await getFileMtime(tab.filePath)
      updateTab(tab.id, {
        content: res.content,
        sourceContent: res.content,
        isDirty: false,
        encoding: res.encoding,
        lastMtimeMs: mtime,
        externalChanged: false,
        viewState: undefined,
      })
      resetEditor()
    } catch (e) {
      alert('重新加载失败：' + e)
    }
  }, [updateTab, resetEditor])

  // 外部变更提示条：忽略（记住新 mtime，提示消失，保留编辑器内容）
  const handleIgnoreExternalChange = useCallback(async () => {
    const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current)
    if (!tab?.filePath) return
    const mtime = await getFileMtime(tab.filePath)
    updateTab(tab.id, { externalChanged: false, lastMtimeMs: mtime })
  }, [updateTab])

  // Listen for file-opened event (file association / OS open)
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false
    async function setup() {
      try {
        // 会话恢复必须先于 emit('frontend-ready') 完成：frontend-ready 是
        // Rust 发出 file-opened 的门槛，天然串行化，避免恢复与「双击打开」
        // 竞态覆盖彼此的标签列表
        await restoreSession()
        const fn = await listen<string>('file-opened', (event) => {
          loadFile(event.payload)
        })
        if (!cancelled) {
          unlisten = fn
        } else {
          fn()
        }
        await emit('frontend-ready')
      } catch (e) {
        console.error('Failed to setup file-opened listener:', e)
      }
    }
    setup()
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [loadFile, restoreSession])

  // 窗口 X：Rust 侧已 prevent_close，这里检查未保存标签，确认后才真正销毁
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false
    async function setup() {
      try {
        const fn = await listen('close-requested', () => {
          const dirty = tabsRef.current.filter((t) => t.isDirty)
          if (dirty.length > 0) {
            setExitConfirm(true)
          } else {
            invoke('confirm_close').catch(console.error)
          }
        })
        if (!cancelled) unlisten = fn
        else fn()
      } catch (e) {
        console.error('close-requested listener failed:', e)
      }
    }
    setup()
    return () => { cancelled = true; unlisten?.() }
  }, [])

  // 「保存并退出」：逐个保存未保存标签（未落盘的依次弹另存对话框），全部成功才退出
  const handleExitSave = useCallback(async () => {
    setExitConfirm(false)
    const dirtyTabs = tabsRef.current.filter((t) => t.isDirty).map((t) => ({ ...t }))
    let failed = false
    for (const tab of dirtyTabs) {
      let content = tab.viewMode === 'source' ? tab.sourceContent : tab.content
      if (tab.id === activeTabIdRef.current && tab.viewMode === 'wysiwyg' && editorRef.current?.ready) {
        content = editorRef.current.getMarkdown()
      }
      let path = tab.filePath
      if (!path) {
        try {
          path = await invoke<string | null>('save_file_dialog')
          if (!path) return // 用户取消保存 → 中止整个退出
        } catch {
          return
        }
      }
      try {
        await invoke('write_file', { path, content })
        updateTab(tab.id, { filePath: path, isDirty: false })
      } catch (e) {
        failed = true
        console.error('Save on exit failed:', e)
        alert('保存失败，已取消退出：' + path + '\n\n' + e)
      }
    }
    if (failed) return
    // 退出前立即落一次会话（不等 2s 防抖），下次启动恢复现场
    invoke('save_session', { session: serializeSession(tabsRef.current, activeTabIdRef.current) })
      .catch(console.error)
    invoke('confirm_close').catch(console.error)
  }, [updateTab])

  const handleExitDiscard = useCallback(() => {
    setExitConfirm(false)
    invoke('save_session', { session: serializeSession(tabsRef.current, activeTabIdRef.current) })
      .catch(console.error)
    invoke('confirm_close').catch(console.error)
  }, [])

  const handleExportHtml = useCallback(async () => {
    try {
      const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current)
      if (!tab) return
      const md = tab.viewMode === 'wysiwyg' && editorRef.current?.ready
        ? editorRef.current.getMarkdown()
        : (tab.viewMode === 'source' ? tab.sourceContent : tab.content)
      const { text, blocks } = await prepareDiagrams(md)
      const html = renderMarkdown(text, blocks)
      const css = getExportCss()
      await invoke('export_html', { markdown: html, css })
    } catch (e) {
      console.error('Export HTML failed:', e)
      alert('导出 HTML 失败：' + e)
    }
  }, [])

  const handleExportPdf = useCallback(async () => {
    try {
      const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current)
      if (!tab) return
      const md = tab.viewMode === 'wysiwyg' && editorRef.current?.ready
        ? editorRef.current.getMarkdown()
        : (tab.viewMode === 'source' ? tab.sourceContent : tab.content)
      const { text, blocks } = await prepareDiagrams(md)
      const html = renderMarkdown(text, blocks)
      const css = getExportCss()
      await invoke('export_pdf', { markdown: html, css })
    } catch (e) {
      console.error('Export PDF failed:', e)
      alert('导出 PDF 失败：' + e + '\n\n将在浏览器中打开，请在打印对话框中选择"另存为 PDF"。')
    }
  }, [])

  const handleOpen = useCallback(async () => {
    try {
      const path = await invoke<string | null>('open_file_dialog')
      if (!path) return
      const existingTab = tabsRef.current.find((t) => t.filePath === path)
      if (existingTab) {
        switchToTab(existingTab.id)
      } else {
        await loadFile(path)
      }
    } catch (e) {
      console.error('Open failed:', e)
    }
  }, [loadFile, switchToTab])

  const handleSave = useCallback(async () => {
    try {
      const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current)
      if (!tab) return

      let content: string
      if (tab.viewMode === 'wysiwyg' && editorRef.current?.ready) {
        content = editorRef.current.getMarkdown()
      } else {
        content = tab.viewMode === 'source' ? tab.sourceContent : tab.content
      }

      let path = tab.filePath
      if (!path) {
        path = await invoke<string | null>('save_file_dialog')
        if (!path) return
      }

      await invoke('write_file', { path, content })
      const mtime = await getFileMtime(path)
      // 竞态防御：若保存期间用户又输入了新内容，不清 isDirty、不回写旧内容
      const current = tabsRef.current.find((t) => t.id === tab.id)
      const currentContent = current
        ? (current.viewMode === 'source' ? current.sourceContent : current.content)
        : content
      if (currentContent === content) {
        updateTab(tab.id, { filePath: path, isDirty: false, lastMtimeMs: mtime })
      }
    } catch (e) {
      console.error('Save failed:', e)
      alert('保存失败：' + e)
    }
  }, [updateTab])

  const handleNewTab = useCallback(() => {
    captureViewState()
    saveCurrentEditorContent()
    const newTab = createTab({
      content: '# Untitled\n\n',
      sourceContent: '# Untitled\n\n',
    })
    setTabs((prev) => [...prev, newTab])
    setActiveTabId(newTab.id)
    resetEditor()
  }, [captureViewState, saveCurrentEditorContent, resetEditor])

  const closeTab = useCallback((tabId: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === tabId)
      const newTabs = prev.filter((t) => t.id !== tabId)

      if (tabId === activeTabIdRef.current) {
        if (newTabs.length === 0) {
          // All tabs closed — show the empty state instead of auto-creating one.
          setActiveTabId('')
        } else {
          const newActiveIdx = Math.min(idx, newTabs.length - 1)
          setActiveTabId(newTabs[newActiveIdx].id)
        }
        resetEditor()
      }

      return newTabs
    })
  }, [resetEditor])

  const handleTabClose = useCallback((tabId: string) => {
    const tab = tabsRef.current.find((t) => t.id === tabId)
    if (!tab) return
    if (tab.isDirty) {
      const fileName = tab.filePath ? tab.filePath.split(/[\\/]/).pop()! : '未命名'
      setCloseConfirm({ tabId, tabName: fileName })
      return
    }
    closeTab(tabId)
  }, [closeTab])

  const handleCloseConfirmSave = useCallback(async () => {
    const { tabId } = closeConfirm!
    setCloseConfirm(null)

    const tab = tabsRef.current.find((t) => t.id === tabId)
    if (!tab) return

    let path = tab.filePath
    if (!path) {
      try {
        path = await invoke<string | null>('save_file_dialog')
        if (!path) return
      } catch {
        return
      }
    }

    try {
      const content = tab.viewMode === 'source' ? tab.sourceContent : tab.content
      await invoke('write_file', { path, content })
      closeTab(tabId)
    } catch (e) {
      console.error('Save failed:', e)
    }
  }, [closeConfirm, closeTab])

  const handleCloseConfirmDiscard = useCallback(() => {
    const { tabId } = closeConfirm!
    setCloseConfirm(null)
    closeTab(tabId)
  }, [closeConfirm, closeTab])

  const handleCloseConfirmCancel = useCallback(() => {
    setCloseConfirm(null)
  }, [])

  const handleEditorChange = useCallback((markdown: string) => {
    if (justLoadedRef.current) return
    // 宽限期：与 baseline（ready 时的归一化内容）相同的是初始化虚假回调；
    // 不同的一定是用户真实输入，不能丢——立即退出宽限期并正常入账
    if (editorBaselineRef.current !== null) {
      if (markdown === editorBaselineRef.current) return
      editorBaselineRef.current = null
    }
    updateTab(activeTabIdRef.current, { content: markdown, isDirty: true })
  }, [updateTab])

  const handleSourceChange = useCallback((value: string) => {
    updateTab(activeTabIdRef.current, { sourceContent: value, isDirty: true })
  }, [updateTab])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))
  }, [])

  const toggleViewMode = useCallback(() => {
    const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current)
    if (!tab) return
    // 两种方向都先记住当前模式的位置（WYSIWYG ↔ 源码各自独立记忆）
    captureViewState()
    if (tab.viewMode === 'wysiwyg') {
      const md = editorRef.current?.getMarkdown() ?? tab.content
      updateTab(tab.id, { viewMode: 'source', sourceContent: md })
    } else {
      updateTab(tab.id, { viewMode: 'wysiwyg', content: tab.sourceContent })
      resetEditor()
    }
  }, [captureViewState, updateTab, resetEditor])

  // Auto-save every 3 minutes — now covers ALL dirty tabs with a file path,
  // not just the active one (previously a background dirty tab was never saved)
  useEffect(() => {
    const id = setInterval(async () => {
      for (const tab of tabsRef.current) {
        if (!tab.isDirty || !tab.filePath) continue
        let content = tab.viewMode === 'source' ? tab.sourceContent : tab.content
        // 活动 WYSIWYG 标签直接取编辑器最新内容（state 可能滞后于打字）
        if (tab.id === activeTabIdRef.current && tab.viewMode === 'wysiwyg' && editorRef.current?.ready) {
          content = editorRef.current.getMarkdown()
        }
        try {
          await invoke('write_file', { path: tab.filePath, content })
          const mtime = await getFileMtime(tab.filePath)
          // 竞态防御：保存期间用户又改过就保持 isDirty
          const current = tabsRef.current.find((t) => t.id === tab.id)
          const currentContent = current
            ? (current.viewMode === 'source' ? current.sourceContent : current.content)
            : content
          if (currentContent === content) updateTab(tab.id, { isDirty: false, lastMtimeMs: mtime })
        } catch (e) {
          console.error('Auto-save failed:', tab.filePath, e)
        }
      }
    }, AUTO_SAVE_INTERVAL)
    return () => clearInterval(id)
  }, [saveCurrentEditorContent, updateTab])

  // Poll for editor readiness
  useEffect(() => {
    if (editorReady || activeViewMode !== 'wysiwyg') return
    const id = setInterval(() => {
      if (editorRef.current?.ready) {
        setEditorReady(true)
        // handle 提升为 state 供 Toolbar/TableControls 订阅
        setEditorHandle(editorRef.current)
        // 记录归一化 baseline，宽限期内据此过滤 Milkdown 的虚假回调
        editorBaselineRef.current = editorRef.current.getMarkdown()
        // Release justLoadedRef now; the baseline comparison in
        // handleEditorChange absorbs Milkdown's spurious init-time
        // markdownUpdated callbacks (fixes false "modified" state).
        justLoadedRef.current = false
        clearInterval(id)
      }
    }, 100)
    return () => clearInterval(id)
  }, [editorReady, activeViewMode])

  // 切换标签页 / 视图模式后立即按记忆值定位：源码模式直接恢复 textarea 的
  // 光标与滚动；WYSIWYG 此时容器里还是即时预览，先大致定位，编辑器就绪后
  // 由下一个 effect 精确恢复。无记忆（首次打开）则确定性回到顶部——
  // 源码 textarea 在两个源码标签间是复用的，不覆写会残留上个标签的位置
  useEffect(() => {
    if (!activeTab) return
    const vs = activeTab.viewState
    if (activeTab.viewMode === 'source') {
      const ta = sourceTextareaRef.current
      if (!ta) return
      const s = vs?.source
      if (typeof s?.scrollTop === 'number') {
        // 先恢复光标再恢复滚动：setSelectionRange 可能把 textarea 滚向光标处
        if (s.cursor) ta.setSelectionRange(s.cursor.start, s.cursor.end)
        ta.scrollTop = s.scrollTop
      } else {
        ta.scrollTop = 0
      }
    } else if (editorScrollRef.current) {
      const st = vs?.wysiwyg?.scrollTop
      editorScrollRef.current.scrollTop = typeof st === 'number' ? st : 0
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, activeTab?.viewMode])

  // 编辑器重建就绪后精确恢复 WYSIWYG 的选区与滚动位置。选区恢复不触发
  // markdownUpdated（无文档变更），不会误标 isDirty
  useEffect(() => {
    if (!editorReady || !activeTab || activeTab.viewMode !== 'wysiwyg') return
    const s = activeTab.viewState?.wysiwyg
    if (!s) return
    if (s.selection) {
      editorRef.current?.restoreSelectionSnapshot(s.selection)
    }
    const target = s.scrollTop
    if (typeof target !== 'number' || target === 0) return
    // Milkdown 初始渲染与图片/图表异步加载期间文档高度仍在增长，scrollTop
    // 会被夹紧——用 rAF 重写直到定位准确且高度稳定（上限约 1s 防空转）
    const tabId = activeTabIdRef.current
    const el = editorScrollRef.current
    let tries = 0
    let lastHeight = 0
    let stableFrames = 0
    const apply = () => {
      const container = editorScrollRef.current
      if (!container || activeTabIdRef.current !== tabId) return
      container.scrollTop = target
      const height = container.scrollHeight
      stableFrames = height === lastHeight ? stableFrames + 1 : 0
      lastHeight = height
      const stuck = Math.abs(container.scrollTop - target) < 1
      if ((stuck && stableFrames >= 5) || ++tries >= 60) return
      requestAnimationFrame(apply)
    }
    if (el) requestAnimationFrame(apply)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorReady, editorKey])

  // Ctrl + wheel to zoom editor font size (persisted across sessions)
  useEffect(() => {
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(fontSize))
  }, [fontSize])

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setFontSize((prev) => {
        const next = e.deltaY < 0 ? prev + 1 : prev - 1
        return Math.max(10, Math.min(32, next))
      })
    }
    const el = editorContainerRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key === 's') {
        e.preventDefault()
        handleSave()
      } else if (mod && e.key === 'o') {
        e.preventDefault()
        handleOpen()
      } else if (mod && e.key === 'n') {
        e.preventDefault()
        handleNewTab()
      } else if (mod && e.key === 't') {
        e.preventDefault()
        handleNewTab()
      } else if (mod && e.key === 'w') {
        e.preventDefault()
        if (activeTabIdRef.current) handleTabClose(activeTabIdRef.current)
      } else if (mod && e.key === 'Tab') {
        e.preventDefault()
        const list = tabsRef.current
        if (list.length < 2) return
        const idx = list.findIndex((t) => t.id === activeTabIdRef.current)
        if (idx < 0) return
        const dir = e.shiftKey ? -1 : 1
        const nextIdx = (idx + dir + list.length) % list.length
        switchToTab(list[nextIdx].id)
      } else if (mod && e.key === '/') {
        e.preventDefault()
        toggleViewMode()
      } else if (mod && e.key === 'f') {
        e.preventDefault()
        setFindOpen(true)
      } else if (mod && e.key === 'h') {
        e.preventDefault()
        setFindOpen(true)
        setFindShowReplace(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave, handleOpen, handleNewTab, toggleViewMode, handleTabClose, switchToTab])

  // 拖入的图片：复制到 assets/ 后经编辑器插入（编辑器未就绪则忽略插入）
  const handleDroppedImages = useCallback(async (imgPaths: string[]) => {
    const docDir = getDocDir(activeTabIdRef.current
      ? tabsRef.current.find((t) => t.id === activeTabIdRef.current)?.filePath ?? null
      : null)
    if (!docDir) {
      alert('请先保存文档（Ctrl+S），再拖入图片 —— 图片将写入文档目录下的 assets/ 文件夹。')
      return
    }
    for (const p of imgPaths) {
      const rel = await copyDroppedImage(p, docDir)
      if (rel) editorRef.current?.insertImage(rel)
    }
  }, [])

  // Tauri v2 drag-drop — .md opens in a tab; images land in the editor
  useEffect(() => {
    const webview = getCurrentWebview()
    const unlistenPromise = webview.onDragDropEvent((event) => {
      if (event.payload.type === 'enter') {
        setIsDragging(true)
      } else if (event.payload.type === 'drop') {
        setIsDragging(false)
        const mdFile = event.payload.paths.find(isMarkdownFile)
        if (mdFile) {
          const existingTab = tabsRef.current.find((t) => t.filePath === mdFile)
          if (existingTab) {
            switchToTab(existingTab.id)
          } else {
            loadFile(mdFile)
          }
          return
        }
        // 拖入图片文件 → 复制到当前文档 assets/ 并插入光标处
        const imgFiles = event.payload.paths.filter(isImagePath)
        if (imgFiles.length > 0) void handleDroppedImages(imgFiles)
      } else if (event.payload.type === 'leave') {
        setIsDragging(false)
      }
    })
    return () => {
      unlistenPromise.then((fn) => fn())
    }
  }, [loadFile, switchToTab, handleDroppedImages])

  const handleSidebarFileOpen = useCallback((path: string) => {
    const existingTab = tabsRef.current.find((t) => t.filePath === path)
    if (existingTab) {
      switchToTab(existingTab.id)
    } else {
      loadFile(path)
    }
  }, [loadFile, switchToTab])

  // 标签拖拽排序
  const handleReorderTabs = useCallback((fromId: string, toId: string) => {
    setTabs((prev) => {
      const from = prev.findIndex((t) => t.id === fromId)
      const to = prev.findIndex((t) => t.id === toId)
      if (from < 0 || to < 0) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }, [])

  // 关闭其他 / 关闭右侧：未保存标签跳过并提示（避免无声丢失）
  const handleCloseOthers = useCallback((tabId: string) => {
    const others = tabsRef.current.filter((t) => t.id !== tabId)
    const skipped = others.filter((t) => t.isDirty).length
    setTabs((prev) => prev.filter((t) => t.id === tabId || t.isDirty))
    if (skipped > 0) alert(`${skipped} 个未保存标签已跳过（请单独关闭并保存）`)
    if (!others.some((t) => t.id === activeTabIdRef.current && t.isDirty)) {
      if (activeTabIdRef.current !== tabId) switchToTab(tabId)
    }
  }, [switchToTab])

  const handleCloseToRight = useCallback((tabId: string) => {
    const idx = tabsRef.current.findIndex((t) => t.id === tabId)
    if (idx < 0) return
    const right = tabsRef.current.slice(idx + 1)
    if (right.length === 0) return
    const skipped = right.filter((t) => t.isDirty).length
    setTabs((prev) => prev.filter((t) => {
      const i = prev.findIndex((x) => x.id === t.id)
      return i <= idx || t.isDirty
    }))
    if (skipped > 0) alert(`${skipped} 个未保存标签已跳过（请单独关闭并保存）`)
    if (!right.some((t) => t.id === activeTabIdRef.current && t.isDirty)) {
      if (activeTabIdRef.current !== tabId) switchToTab(tabId)
    }
  }, [switchToTab])

  const currentContent = !activeTab
    ? ''
    : (activeTab.viewMode === 'source' ? activeTab.sourceContent : activeTab.content)

  // 文档大纲标题（ATX 风格；代码块内的 # 不误判）
  const outlineHeadings = useMemo(() => {
    const out: Array<{ level: number; text: string }> = []
    let inFence = false
    for (const line of currentContent.split('\n')) {
      const trimmed = line.trimStart()
      if (/^(```|~~~)/.test(trimmed)) { inFence = !inFence; continue }
      if (inFence) continue
      const m = line.match(/^(#{1,6})\s+(.*)$/)
      if (m) out.push({ level: m[1].length, text: m[2].replace(/\s+#+\s*$/, '').trim() })
    }
    return out
  }, [currentContent])

  // 大纲跳转：WYSIWYG 滚动到标题节点；源码模式定位到对应行
  const handleTocClick = useCallback((text: string) => {
    if (activeTab?.viewMode === 'wysiwyg') {
      editorRef.current?.scrollToHeading(text)
      return
    }
    const ta = sourceTextareaRef.current
    if (!ta) return
    const lines = ta.value.split('\n')
    let inFence = false
    let lineIdx = -1
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart()
      if (/^(```|~~~)/.test(trimmed)) { inFence = !inFence; continue }
      if (inFence) continue
      const m = lines[i].match(/^(#{1,6})\s+(.*)$/)
      if (m && m[2].replace(/\s+#+\s*$/, '').trim() === text) { lineIdx = i; break }
    }
    if (lineIdx < 0) return
    ta.focus()
    const start = lines.slice(0, lineIdx).join('\n').length + (lineIdx > 0 ? 1 : 0)
    ta.setSelectionRange(start, start)
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 22
    ta.scrollTop = Math.max(0, lineIdx * lineHeight - ta.clientHeight / 3)
  }, [activeTab?.viewMode])

  return (
    <div className="app" data-width-mode={widthMode}>
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onTabClick={switchToTab}
        onTabClose={handleTabClose}
        onNewTab={handleNewTab}
        theme={theme}
        onToggleTheme={toggleTheme}
        viewMode={activeTab?.viewMode ?? 'wysiwyg'}
        onToggleViewMode={toggleViewMode}
        widthMode={widthMode}
        onToggleWidthMode={toggleWidthMode}
        onReorder={handleReorderTabs}
        onCloseOthers={handleCloseOthers}
        onCloseToRight={handleCloseToRight}
      />
      <Toolbar
        editor={editorHandle}
        disabled={!activeTab || activeTab.viewMode === 'source' || !editorReady}
        onNew={handleNewTab}
        onOpen={handleOpen}
        onSave={handleSave}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onExportHtml={handleExportHtml}
        onExportPdf={handleExportPdf}
      />
      <div className="main-area">
        {sidebarOpen && (
          <Sidebar
            filePath={activeTab?.filePath ?? null}
            theme={theme}
            onFileOpen={handleSidebarFileOpen}
            outlineHeadings={outlineHeadings}
            onTocClick={handleTocClick}
          />
        )}
        <div
          className="editor-wrapper"
          ref={editorContainerRef}
          style={{ ['--editor-font-size' as string]: `${fontSize}px` }}
        >
          {!activeTab ? (
            <div className="empty-state">
              <FileText size={40} className="empty-state-icon" />
              <p className="empty-state-title">所有标签页已关闭</p>
              <p className="empty-state-hint">Ctrl+N 新建文档 · Ctrl+O 打开文件 · 或点击上方 ＋ 新建标签页</p>
            </div>
          ) : (
            <>
              {activeTab.externalChanged && (
                <div className="external-change-banner">
                  <span>文件已在磁盘上被其他程序修改</span>
                  <button className="external-change-btn" onClick={() => handleReloadFromDisk()}>重新加载</button>
                  <button className="external-change-btn ghost" onClick={() => handleIgnoreExternalChange()}>忽略</button>
                </div>
              )}
              {findOpen && (
                <FindReplace
                  mode={activeTab.viewMode}
                  editor={editorHandle}
                  editorReady={editorReady}
                  textareaRef={sourceTextareaRef}
                  content={activeTab.viewMode === 'source' ? activeTab.sourceContent : activeTab.content}
                  onChange={handleSourceChange}
                  showReplace={findShowReplace}
                  onToggleShowReplace={setFindShowReplace}
                  onClose={() => setFindOpen(false)}
                />
              )}
              {activeTab.viewMode === 'wysiwyg' ? (
                <main className="editor-container" ref={editorScrollRef}>
                  {!editorReady && (
                    <div
                      className="content-preview"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(activeTab.content, [], getDocDir(activeTab.filePath)) }}
                    />
                  )}
                  <div style={editorReady ? undefined : { position: 'absolute', opacity: 0, pointerEvents: 'none' }}>
                    {EditorModule && (
                      <EditorModule
                        key={editorKey}
                        defaultValue={activeTab.content}
                        onChange={handleEditorChange}
                        editorRef={editorRef}
                        docDir={getDocDir(activeTab.filePath)}
                      />
                    )}
                  </div>
                  <TableControls
                    containerRef={editorScrollRef}
                    editor={editorHandle}
                    enabled={editorReady}
                  />
                </main>
              ) : (
                <SourceView
                  value={activeTab.sourceContent}
                  onChange={handleSourceChange}
                  textareaRef={sourceTextareaRef}
                />
              )}
              <StatusBar content={currentContent} fontSize={fontSize} />
            </>
          )}
        </div>
      </div>
      {zoomDiagram && (
        <DiagramViewer
          svg={zoomDiagram.svg}
          title={zoomDiagram.title}
          onClose={() => setZoomDiagram(null)}
        />
      )}
      {isDragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-text">松开以在新标签页中打开</div>
        </div>
      )}
      {closeConfirm && (
        <dialog
          open
          className="close-confirm-dialog"
          onClick={(e) => { if (e.target === e.currentTarget) handleCloseConfirmCancel() }}
        >
          <div className="close-confirm-content">
            <p>保存对&ldquo;{closeConfirm.tabName}&rdquo;的更改吗？</p>
            <div className="close-confirm-actions">
              <button className="close-confirm-btn primary" onClick={handleCloseConfirmSave}>保存</button>
              <button className="close-confirm-btn" onClick={handleCloseConfirmDiscard}>不保存</button>
              <button className="close-confirm-btn" onClick={handleCloseConfirmCancel}>取消</button>
            </div>
          </div>
        </dialog>
      )}
      {exitConfirm && (
        <dialog
          open
          className="close-confirm-dialog"
          onClick={(e) => { if (e.target === e.currentTarget) setExitConfirm(false) }}
        >
          <div className="close-confirm-content">
            <p>有未保存的文档，退出前要保存吗？</p>
            <div className="close-confirm-actions">
              <button className="close-confirm-btn primary" onClick={handleExitSave}>保存并退出</button>
              <button className="close-confirm-btn" onClick={handleExitDiscard}>直接退出</button>
              <button className="close-confirm-btn" onClick={() => setExitConfirm(false)}>取消</button>
            </div>
          </div>
        </dialog>
      )}
    </div>
  )
}

function getExportCss(): string {
  // Mirrors the in-app document typography (App.css) so exported files
  // look the same as the editor.
  return `
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif;
      max-width: 860px;
      margin: 0 auto;
      padding: 40px 48px;
      color: #1a1a2e;
      font-size: 16px;
      line-height: 1.75;
    }
    h1, h2, h3, h4, h5, h6 {
      font-family: 'LXGW WenKai', '霞鹜文楷', 'Microsoft YaHei UI', '微软雅黑', 'PingFang SC', sans-serif;
      font-weight: 600;
      line-height: 1.4;
      color: #1a1a2e;
    }
    h1 { font-size: 2em; margin: 1.1em 0 0.55em; padding-bottom: 0.25em; border-bottom: 1px solid #e5e7eb; }
    h2 { font-size: 1.5em; margin: 1em 0 0.5em; padding-bottom: 0.2em; border-bottom: 1px solid #e5e7eb; }
    h3 { font-size: 1.25em; margin: 0.9em 0 0.45em; }
    h4 { font-size: 1.1em; margin: 0.8em 0 0.4em; }
    h5 { font-size: 1em; margin: 0.7em 0 0.35em; }
    h6 { font-size: 0.9em; margin: 0.7em 0 0.35em; color: #6b7280; }
    h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }
    p { margin: 0.55em 0; }
    ul, ol { margin: 0.55em 0; padding-left: 1.75em; }
    li { margin: 0.2em 0; }
    blockquote { margin: 0.9em 0; padding: 0.2em 0 0.2em 1em; border-left: 4px solid #d1d5db; color: #6b7280; }
    code { font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace; font-size: 0.875em; background: #f1f3f5; padding: 0.1em 0.35em; border-radius: 4px; }
    pre { background: #f8f9fa; border: none; border-radius: 8px; padding: 0.85em 1.1em; margin: 0.9em 0; overflow-x: auto; font-size: 0.875em; line-height: 1.55; }
    pre code { background: none; padding: 0; font-size: inherit; }
    pre.frontmatter { margin: 0 0 1.2em; padding: 0.55em 1em 0.7em; font-size: 0.8em; line-height: 1.65; color: #6b7280; white-space: pre-wrap; word-break: break-word; }
    a { color: #4a6fa5; text-decoration: none; }
    a:hover { text-decoration: underline; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 1.4em 0; }
    table { border-collapse: collapse; margin: 0.9em 0; font-size: 0.95em; }
    th, td { border: 1px solid #dfe2e5; padding: 8px 16px; }
    th { background: #f1f3f5; font-weight: 600; }
    img { max-width: 100%; border-radius: 4px; }
    strong { font-weight: 700; }
    del { color: #6b7280; }
    .diagram-svg, .diagram-mermaid { margin: 1.2em 0; text-align: center; }
    .diagram-svg svg, .diagram-mermaid svg { max-width: 100%; height: auto; }
    .diagram-error { color: #dc3545; font-size: 0.9em; }
  `
}

export default App
