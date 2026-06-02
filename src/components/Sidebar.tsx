import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { FolderOpen, Clock, FileText } from 'lucide-react'

interface SidebarProps {
  filePath: string | null
  theme: 'light' | 'dark'
  onFileOpen: (path: string) => void
}

type Tab = 'directory' | 'recent'

export default function Sidebar({ filePath, theme, onFileOpen }: SidebarProps) {
  const [tab, setTab] = useState<Tab>('directory')
  const [dirFiles, setDirFiles] = useState<string[]>([])
  const [recentFiles, setRecentFiles] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  // Load directory files
  const loadDirFiles = useCallback(async () => {
    if (!filePath) {
      setDirFiles([])
      return
    }
    try {
      const dir = filePath.split(/[\\/]/).slice(0, -1).join('/')
      if (!dir) { setDirFiles([]); return }
      const files = await invoke<string[]>('list_dir_files', { dirPath: dir })
      setDirFiles(files)
      setError(null)
    } catch (e) {
      setError(String(e))
      setDirFiles([])
    }
  }, [filePath])

  // Load recent files
  const loadRecentFiles = useCallback(async () => {
    try {
      const files = await invoke<string[]>('get_recent_files')
      setRecentFiles(files)
      setError(null)
    } catch (e) {
      setError(String(e))
      setRecentFiles([])
    }
  }, [])

  useEffect(() => {
    if (tab === 'directory') loadDirFiles()
    else loadRecentFiles()
  }, [tab, loadDirFiles, loadRecentFiles])

  // Refresh directory when filePath changes
  useEffect(() => {
    if (tab === 'directory') loadDirFiles()
  }, [filePath, tab, loadDirFiles])

  const files = tab === 'directory' ? dirFiles : recentFiles

  const getFileName = (path: string) => path.split(/[\\/]/).pop() ?? path

  return (
    <div className="sidebar" data-theme={theme}>
      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab ${tab === 'directory' ? 'active' : ''}`}
          onClick={() => setTab('directory')}
          data-tooltip="当前目录"
        >
          <FolderOpen size={14} />
        </button>
        <button
          className={`sidebar-tab ${tab === 'recent' ? 'active' : ''}`}
          onClick={() => setTab('recent')}
          data-tooltip="最近文件"
        >
          <Clock size={14} />
        </button>
      </div>
      <div className="sidebar-content">
        {error && <div className="sidebar-error">{error}</div>}
        {files.length === 0 && !error && (
          <div className="sidebar-empty">
            {tab === 'directory' ? '打开文件以查看目录' : '暂无最近文件'}
          </div>
        )}
        {files.map((file) => (
          <button
            key={file}
            className={`sidebar-file-item ${file === filePath ? 'current' : ''}`}
            onClick={() => onFileOpen(file)}
            title={file}
          >
            <FileText size={14} />
            <span className="sidebar-file-name">{getFileName(file)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
