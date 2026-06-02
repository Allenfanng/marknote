import { useState, useCallback, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import Editor, { type EditorHandle } from './components/Editor'
import TabBar, { type Tab } from './components/TabBar'
import Toolbar from './components/Toolbar'
import SourceView from './components/SourceView'
import Sidebar from './components/Sidebar'
import StatusBar from './components/StatusBar'
import './App.css'

const MD_EXTENSIONS = ['.md', '.markdown', '.txt']
const AUTO_SAVE_INTERVAL = 3 * 60 * 1000

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
  const [editorReady, setEditorReady] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [editorKey, setEditorKey] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [closeConfirm, setCloseConfirm] = useState<{ tabId: string; tabName: string } | null>(null)
  const justLoadedRef = useRef(true)

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
    setEditorKey((k) => k + 1)
  }, [])

  useEffect(() => {
    document.body.setAttribute('data-theme', theme)
  }, [theme])

  const loadFile = useCallback(async (path: string) => {
    try {
      const text = await invoke<string>('read_file', { path })
      const newTab = createTab({
        filePath: path,
        content: text,
        sourceContent: text,
      })
      setTabs((prev) => [...prev, newTab])
      setActiveTabId(newTab.id)
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
    const unlisten = listen<string>('file-opened', (event) => {
      loadFile(event.payload)
    })
    return () => { unlisten.then((fn) => fn()) }
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
    }
  }, [])

  const handleExportPdf = useCallback(() => {
    const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current)
    if (!tab) return
    const md = tab.viewMode === 'wysiwyg' && editorRef.current?.ready
      ? editorRef.current.getMarkdown()
      : (tab.viewMode === 'source' ? tab.sourceContent : tab.content)
    const html = markdownToHtml(md)
    const css = getExportCss()
    const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>MarkNote Export</title>
<style>${css}</style>
</head>
<body><div class="markdown-body">${html}</div></body>
</html>`
    const blob = new Blob([fullHtml], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const win = window.open(url, '_blank')
    if (win) {
      win.onload = () => { win.print() }
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
      updateTab(tab.id, { viewMode: 'wysiwyg' })
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
        justLoadedRef.current = false
        clearInterval(id)
      }
    }, 100)
    return () => clearInterval(id)
  }, [editorReady, activeTab.viewMode])

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
        <div className="editor-wrapper">
          {activeTab.viewMode === 'wysiwyg' ? (
            <main className="editor-container">
              {!editorReady && (
                <div
                  className="content-preview"
                  dangerouslySetInnerHTML={{ __html: markdownToHtml(activeTab.content) }}
                />
              )}
              <div style={editorReady ? undefined : { position: 'absolute', opacity: 0, pointerEvents: 'none' }}>
                <Editor
                  key={editorKey}
                  defaultValue={activeTab.content}
                  onChange={handleEditorChange}
                  editorRef={editorRef}
                />
              </div>
            </main>
          ) : (
            <SourceView value={activeTab.sourceContent} onChange={handleSourceChange} />
          )}
          <StatusBar content={currentContent} />
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

function markdownToHtml(md: string): string {
  // Basic markdown to HTML conversion for export
  let html = md
    // Escape HTML entities first
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Code blocks (fenced)
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
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
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // Strikethrough
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    // Blockquote
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    // Horizontal rule
    .replace(/^---$/gm, '<hr />')
    // Unordered list
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Ordered list
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Paragraphs (lines not already in tags)
    .replace(/^(?!<[hblpuoi]|<li|<hr|<pre|<code|<blockquote|<strong|<em|<del)(.+)$/gm, '<p>$1</p>')
    // Merge consecutive list items
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)

  return html
}

function getExportCss(): string {
  return `
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
      color: #1a1a2e;
      line-height: 1.7;
    }
    h1 { font-size: 2em; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.3em; }
    h2 { font-size: 1.5em; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.3em; }
    h3 { font-size: 1.25em; }
    code { background: #f1f3f5; padding: 2px 6px; border-radius: 3px; font-family: 'Consolas', monospace; font-size: 0.9em; }
    pre { background: #f8f9fa; padding: 16px; border-radius: 6px; overflow-x: auto; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 4px solid #d1d5db; padding-left: 16px; color: #6b7280; margin: 0; }
    img { max-width: 100%; }
    a { color: #4a6fa5; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #d1d5db; padding: 8px 16px; }
    th { background: #f1f3f5; }
    ul, ol { padding-left: 2em; }
  `
}

export default App
