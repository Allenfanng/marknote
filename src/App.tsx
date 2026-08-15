import { useState, useCallback, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, emit } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import type { EditorHandle } from './components/Editor'
import TabBar, { type Tab } from './components/TabBar'
import Toolbar from './components/Toolbar'
import SourceView from './components/SourceView'
import Sidebar from './components/Sidebar'
import StatusBar from './components/StatusBar'
import './App.css'

const MD_EXTENSIONS = ['.md', '.markdown', '.txt']
const AUTO_SAVE_INTERVAL = 3 * 60 * 1000
const FONT_SIZE_STORAGE_KEY = 'marknote-font-size'
const DEFAULT_FONT_SIZE = 16

function getInitialFontSize(): number {
  const saved = Number(localStorage.getItem(FONT_SIZE_STORAGE_KEY))
  return Number.isInteger(saved) && saved >= 10 && saved <= 32 ? saved : DEFAULT_FONT_SIZE
}

let isFirstStartupFileOpen = true

let tabIdCounter = 0
function nextTabId() { return `tab-${++tabIdCounter}` }

function isMarkdownFile(path: string): boolean {
  const lower = path.toLowerCase()
  return MD_EXTENSIONS.some((ext) => lower.endsWith(ext))
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
  const [activeTabId, setActiveTabId] = useState(tabs[0].id)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const editorRef = useRef<EditorHandle | null>(null)
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const [editorReady, setEditorReady] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [editorKey, setEditorKey] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [closeConfirm, setCloseConfirm] = useState<{ tabId: string; tabName: string } | null>(null)
  const [fontSize, setFontSize] = useState(getInitialFontSize)
  const justLoadedRef = useRef(true)
  const editorReadyAtRef = useRef(0)
  const [EditorModule, setEditorModule] = useState<React.ComponentType<{
    defaultValue: string
    onChange: (markdown: string) => void
    editorRef: React.RefObject<EditorHandle | null>
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

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]


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
    editorReadyAtRef.current = 0
    setEditorKey((k) => k + 1)
  }, [])

  useEffect(() => {
    document.body.setAttribute('data-theme', theme)
  }, [theme])

  const loadFile = useCallback(async (path: string) => {
    try {
      const text = await invoke<string>('read_file', { path })
      let targetTabId: string
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
          return [{ ...soleTab, filePath: path, content: text, sourceContent: text }]
        }
        const newTab = createTab({
          filePath: path,
          content: text,
          sourceContent: text,
        })
        targetTabId = newTab.id
        return [...prev, newTab]
      })
      setActiveTabId(targetTabId!)
      resetEditor()
      invoke('add_recent_file', { path }).catch(console.error)
    } catch (e) {
      console.error('Failed to load file:', e)
    }
  }, [])

  // On startup, check if this window was opened with a file parameter
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const fileParam = params.get('file')
    if (fileParam) loadFile(fileParam)
  }, [loadFile])

  // Listen for file-opened event (file association / OS open)
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false
    async function setup() {
      try {
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
  }, [loadFile])

  const handleExportHtml = useCallback(async () => {
    try {
      const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current)
      if (!tab) return
      const md = tab.viewMode === 'wysiwyg' && editorRef.current?.ready
        ? editorRef.current.getMarkdown()
        : (tab.viewMode === 'source' ? tab.sourceContent : tab.content)
      const html = markdownToHtml(md)
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
      const html = markdownToHtml(md)
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
        if (existingTab.id !== activeTabIdRef.current) {
          saveCurrentEditorContent()
          setActiveTabId(existingTab.id)
          resetEditor()
        }
      } else {
        await loadFile(path)
      }
    } catch (e) {
      console.error('Open failed:', e)
    }
  }, [loadFile, saveCurrentEditorContent])

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
      updateTab(tab.id, { filePath: path, content, isDirty: false })
    } catch (e) {
      console.error('Save failed:', e)
    }
  }, [updateTab])

  const handleNewTab = useCallback(() => {
    saveCurrentEditorContent()
    const newTab = createTab({
      content: '# Untitled\n\n',
      sourceContent: '# Untitled\n\n',
    })
    setTabs((prev) => [...prev, newTab])
    setActiveTabId(newTab.id)
    resetEditor()
  }, [saveCurrentEditorContent, resetEditor])

  const handleTabClick = useCallback((tabId: string) => {
    if (tabId === activeTabIdRef.current) return
    saveCurrentEditorContent()
    setActiveTabId(tabId)
    resetEditor()
  }, [saveCurrentEditorContent, resetEditor])

  const closeTab = useCallback((tabId: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === tabId)
      const newTabs = prev.filter((t) => t.id !== tabId)

      if (newTabs.length === 0) {
        const newTab = createTab({
          content: '# Untitled\n\n',
          sourceContent: '# Untitled\n\n',
        })
        setActiveTabId(newTab.id)
        resetEditor()
        return [newTab]
      }

      if (tabId === activeTabIdRef.current) {
        const newActiveIdx = Math.min(idx, newTabs.length - 1)
        setActiveTabId(newTabs[newActiveIdx].id)
        resetEditor()
      }

      return newTabs
    })
  }, [])

  const handleTabClose = useCallback((tabId: string) => {
    const tab = tabsRef.current.find((t) => t.id === tabId)
    if (!tab) return
    if (tab.isDirty) {
      const fileName = tab.filePath ? tab.filePath.split(/[\\/]/).pop()! : 'Untitled'
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
    // Grace period: skip spurious markdownUpdated events fired right after the
    // editor becomes ready (Milkdown emits them during initial normalization).
    if (editorReadyAtRef.current && Date.now() - editorReadyAtRef.current < 500) return
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
    if (tab.viewMode === 'wysiwyg') {
      const md = editorRef.current?.getMarkdown() ?? tab.content
      updateTab(tab.id, { viewMode: 'source', sourceContent: md })
    } else {
      updateTab(tab.id, { viewMode: 'wysiwyg', content: tab.sourceContent })
      resetEditor()
    }
  }, [updateTab, resetEditor])

  // Auto-save every 3 minutes
  useEffect(() => {
    const id = setInterval(() => {
      const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current)
      if (tab?.isDirty && tab.filePath) {
        handleSave()
      }
    }, AUTO_SAVE_INTERVAL)
    return () => clearInterval(id)
  }, [handleSave])

  // Poll for editor readiness
  useEffect(() => {
    if (editorReady || activeTab.viewMode !== 'wysiwyg') return
    const id = setInterval(() => {
      if (editorRef.current?.ready) {
        setEditorReady(true)
        editorReadyAtRef.current = Date.now()
        // Release justLoadedRef now; the 500ms timestamp guard in
        // handleEditorChange absorbs Milkdown's spurious init-time
        // markdownUpdated callbacks (fixes false "modified" state).
        justLoadedRef.current = false
        clearInterval(id)
      }
    }, 100)
    return () => clearInterval(id)
  }, [editorReady, activeTab.viewMode])

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
      } else if (mod && e.key === '/') {
        e.preventDefault()
        toggleViewMode()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave, handleOpen, handleNewTab, toggleViewMode])

  // Tauri v2 drag-drop — open dropped file in a new tab
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
            if (existingTab.id !== activeTabIdRef.current) {
              saveCurrentEditorContent()
              setActiveTabId(existingTab.id)
              resetEditor()
            }
          } else {
            loadFile(mdFile)
          }
        }
      } else if (event.payload.type === 'leave') {
        setIsDragging(false)
      }
    })
    return () => {
      unlistenPromise.then((fn) => fn())
    }
  }, [loadFile, saveCurrentEditorContent, resetEditor])

  const handleSidebarFileOpen = useCallback((path: string) => {
    const existingTab = tabsRef.current.find((t) => t.filePath === path)
    if (existingTab) {
      if (existingTab.id !== activeTabIdRef.current) {
        saveCurrentEditorContent()
        setActiveTabId(existingTab.id)
        resetEditor()
      }
    } else {
      loadFile(path)
    }
  }, [loadFile, saveCurrentEditorContent, resetEditor])

  const currentContent = activeTab.viewMode === 'source' ? activeTab.sourceContent : activeTab.content

  return (
    <div className="app">
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onTabClick={handleTabClick}
        onTabClose={handleTabClose}
        onNewTab={handleNewTab}
        theme={theme}
        onToggleTheme={toggleTheme}
        viewMode={activeTab.viewMode}
        onToggleViewMode={toggleViewMode}
      />
      <Toolbar
        editor={editorRef.current}
        disabled={activeTab.viewMode === 'source' || !editorReady}
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
            filePath={activeTab.filePath}
            theme={theme}
            onFileOpen={handleSidebarFileOpen}
          />
        )}
        <div
          className="editor-wrapper"
          ref={editorContainerRef}
          style={{ ['--editor-font-size' as string]: `${fontSize}px` }}
        >
          {activeTab.viewMode === 'wysiwyg' ? (
            <main className="editor-container">
              {!editorReady && (
                <div
                  className="content-preview"
                  dangerouslySetInnerHTML={{ __html: markdownToHtml(activeTab.content) }}
                />
              )}
              <div style={editorReady ? undefined : { position: 'absolute', opacity: 0, pointerEvents: 'none' }}>
                {EditorModule && (
                  <EditorModule
                    key={editorKey}
                    defaultValue={activeTab.content}
                    onChange={handleEditorChange}
                    editorRef={editorRef}
                  />
                )}
              </div>
            </main>
          ) : (
            <SourceView value={activeTab.sourceContent} onChange={handleSourceChange} />
          )}
          <StatusBar content={currentContent} fontSize={fontSize} />
        </div>
      </div>
      {isDragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-text">Drop to open in new tab</div>
        </div>
      )}
      {closeConfirm && (
        <dialog
          open
          className="close-confirm-dialog"
          onClick={(e) => { if (e.target === e.currentTarget) handleCloseConfirmCancel() }}
        >
          <div className="close-confirm-content">
            <p>Save changes to &quot;{closeConfirm.tabName}&quot;?</p>
            <div className="close-confirm-actions">
              <button className="close-confirm-btn primary" onClick={handleCloseConfirmSave}>Save</button>
              <button className="close-confirm-btn" onClick={handleCloseConfirmDiscard}>Don&apos;t Save</button>
              <button className="close-confirm-btn" onClick={handleCloseConfirmCancel}>Cancel</button>
            </div>
          </div>
        </dialog>
      )}
    </div>
  )
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Inline formatting applied to table cell text (already HTML-escaped).
function applyInline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
}

export function markdownToHtml(md: string): string {
  // Basic markdown to HTML conversion for export
  // Extract YAML frontmatter first — otherwise its closing `---` would turn
  // the metadata lines into a setext-style heading / stray <hr>.
  let frontmatterHtml = ''
  const fmMatch = md.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
  let body = md
  if (fmMatch) {
    frontmatterHtml = `<pre class="frontmatter">${escapeHtml(fmMatch[1])}</pre>`
    body = md.slice(fmMatch[0].length)
  }

  // Extract fenced code blocks into placeholders BEFORE any other rule runs —
  // otherwise line-based rules mangle their contents (a `# comment` would
  // become a heading, each interior line would get wrapped in <p>, etc).
  // `(?:```|$)` also handles a trailing unclosed fence (runs to EOF, like GFM).
  const codeBlocks: string[] = []
  body = body.replace(/```(\w*)[ \t]*\r?\n([\s\S]*?)(?:```|$)/g, (_m, lang: string, code: string) => {
    codeBlocks.push(`<pre><code class="language-${lang}">${escapeHtml(code.replace(/\r?\n$/, ''))}</code></pre>`)
    return `\x00CB${codeBlocks.length - 1}\x00`
  })

  // Extract GFM tables (header row + `---` delimiter row + body rows).
  const tables: string[] = []
  body = body.replace(/^\|[^\n]*\|[ \t]*\r?\n\|[ :|-]*\|[ \t]*(?:\r?\n\|[^\n]*\|[ \t]*)*/gm, (block) => {
    const rows = block.replace(/\r/g, '').split('\n')
    const splitRow = (line: string) =>
      line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
    const head = splitRow(rows[0]).map((c) => `<th>${applyInline(escapeHtml(c))}</th>`).join('')
    const bodyRows = rows
      .slice(2)
      .map((r) => `<tr>${splitRow(r).map((c) => `<td>${applyInline(escapeHtml(c))}</td>`).join('')}</tr>`)
      .join('')
    tables.push(`<table><thead><tr>${head}</tr></thead><tbody>${bodyRows}</tbody></table>`)
    return `\x00TB${tables.length - 1}\x00`
  })

  const html = escapeHtml(body)
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Images
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Headings
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Horizontal rule (must run before bold/italic to prevent *** from partial match)
    .replace(/^(\-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '<hr />')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // Strikethrough
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    // Blockquote
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    // Unordered list
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Ordered list
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Paragraphs (lines not already in tags; \x00 placeholder lines skipped)
    .replace(/^(?!\x00)(?!<[hblpuoi]|<li|<hr|<pre|<code|<blockquote|<strong|<em|<del)(.+)$/gm, '<p>$1</p>')
    // Merge consecutive list items
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
    // Restore code blocks and tables
    .replace(/\x00CB(\d+)\x00/g, (_m, i: string) => codeBlocks[Number(i)])
    .replace(/\x00TB(\d+)\x00/g, (_m, i: string) => tables[Number(i)])

  return frontmatterHtml + html
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
  `
}

export default App
