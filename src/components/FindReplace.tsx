import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { ChevronDown, ChevronRight, X, ArrowUp, ArrowDown, CaseSensitive } from 'lucide-react'
import type { EditorHandle } from './Editor'

/**
 * 查找替换面板（WYSIWYG / 源码模式通用）。
 *
 * WYSIWYG：匹配高亮与跳转/替换全在 ProseMirror 插件（findPlugin）侧，
 * 本组件只做编排与 UI。
 * 源码模式：textarea 无法内嵌高亮，做「匹配计数 + 选中跳转 + 滚动定位」，
 * 替换直接改 content 后恢复光标。
 */

interface FindReplaceProps {
  mode: 'wysiwyg' | 'source'
  editor: EditorHandle | null
  editorReady: boolean
  textareaRef: RefObject<HTMLTextAreaElement | null>
  content: string
  onChange: (value: string) => void
  showReplace: boolean
  onToggleShowReplace: (v: boolean) => void
  onClose: () => void
}

interface Match {
  from: number
  to: number
}

const MAX_MATCHES = 5000

function computeMatches(content: string, query: string, caseSensitive: boolean): Match[] {
  if (!query) return []
  const hay = caseSensitive ? content : content.toLowerCase()
  const needle = caseSensitive ? query : query.toLowerCase()
  const out: Match[] = []
  let idx = hay.indexOf(needle)
  while (idx !== -1 && out.length < MAX_MATCHES) {
    out.push({ from: idx, to: idx + needle.length })
    idx = hay.indexOf(needle, idx + needle.length)
  }
  return out
}

/** textarea 里把指定字符偏移滚到可见位置 */
function scrollSelectionIntoView(ta: HTMLTextAreaElement, from: number) {
  const line = ta.value.slice(0, from).split('\n').length
  const style = getComputedStyle(ta)
  const lineHeight = parseFloat(style.lineHeight) || 22
  const target = (line - 1) * lineHeight - ta.clientHeight / 3
  ta.scrollTop = Math.max(0, target)
}

export default function FindReplace({
  mode,
  editor,
  editorReady,
  textareaRef,
  content,
  onChange,
  showReplace,
  onToggleShowReplace,
  onClose,
}: FindReplaceProps) {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [sourceMatches, setSourceMatches] = useState<Match[]>([])
  const [sourceActive, setSourceActive] = useState(0)
  const [wysiwygInfo, setWysiwygInfo] = useState({ total: 0, active: -1 })
  const findInputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // 打开即聚焦查找框
  useEffect(() => {
    findInputRef.current?.focus()
    findInputRef.current?.select()
  }, [])

  // Esc 全局关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // 查询变更：WYSIWYG 下发插件；源码模式本地算。
  // setState 均在 setTimeout 回调里（异步），非同步级联；规则静态报错，显式豁免
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (mode === 'wysiwyg') {
      if (!editor || !editorReady) return
      clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        editor.findSetQuery(query, caseSensitive)
        setWysiwygInfo(editor.getFindState())
      }, 200)
      return () => clearTimeout(debounceRef.current)
    }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const matches = computeMatches(content, query, caseSensitive)
      setSourceMatches(matches)
      setSourceActive(0)
    }, 200)
    return () => clearTimeout(debounceRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, caseSensitive, mode, editor, editorReady])

  // WYSIWYG 匹配数在文档变化后刷新
  useEffect(() => {
    if (mode !== 'wysiwyg' || !editor || !editorReady) return
    setWysiwygInfo(editor.getFindState())
  }, [mode, editor, editorReady, content])
  /* eslint-enable react-hooks/set-state-in-effect */

  const total = mode === 'wysiwyg' ? wysiwygInfo.total : sourceMatches.length
  const active = mode === 'wysiwyg' ? wysiwygInfo.active : sourceMatches.length > 0 ? sourceActive : -1

  const goNext = () => {
    if (mode === 'wysiwyg') {
      editor?.findNext()
      if (editor) setWysiwygInfo(editor.getFindState())
      return
    }
    if (sourceMatches.length === 0) return
    const next = (sourceActive + 1) % sourceMatches.length
    setSourceActive(next)
    const ta = textareaRef.current
    if (ta) {
      ta.focus()
      ta.setSelectionRange(sourceMatches[next].from, sourceMatches[next].to)
      scrollSelectionIntoView(ta, sourceMatches[next].from)
    }
  }

  const goPrev = () => {
    if (mode === 'wysiwyg') {
      editor?.findPrev()
      if (editor) setWysiwygInfo(editor.getFindState())
      return
    }
    if (sourceMatches.length === 0) return
    const prev = (sourceActive - 1 + sourceMatches.length) % sourceMatches.length
    setSourceActive(prev)
    const ta = textareaRef.current
    if (ta) {
      ta.focus()
      ta.setSelectionRange(sourceMatches[prev].from, sourceMatches[prev].to)
      scrollSelectionIntoView(ta, sourceMatches[prev].from)
    }
  }

  const replaceOne = () => {
    if (!query) return
    if (mode === 'wysiwyg') {
      editor?.replaceCurrent(replacement)
      return
    }
    if (sourceMatches.length === 0) return
    const m = sourceMatches[sourceActive] ?? sourceMatches[0]
    const next = content.slice(0, m.from) + replacement + content.slice(m.to)
    onChange(next)
  }

  const replaceAll = () => {
    if (!query) return
    if (mode === 'wysiwyg') {
      editor?.replaceAll(replacement)
      return
    }
    const matches = computeMatches(content, query, caseSensitive)
    if (matches.length === 0) return
    // 从后往前替换，避免位置偏移
    let next = content
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i]
      next = next.slice(0, m.from) + replacement + next.slice(m.to)
    }
    onChange(next)
  }

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) goPrev()
      else goNext()
    }
  }

  const matchLabel = useMemo(() => {
    if (!query) return ''
    if (total === 0) return '无结果'
    return `${Math.max(active, 0) + 1}/${total}`
  }, [query, total, active])

  const disabled = mode === 'wysiwyg' && !editorReady

  return (
    <div className="find-replace">
      <div className="fr-row">
        <button
          className="fr-btn"
          title={showReplace ? '收起替换' : '展开替换'}
          onClick={() => onToggleShowReplace(!showReplace)}
        >
          {showReplace ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <input
          ref={findInputRef}
          className={`fr-input${query && total === 0 ? ' fr-input-empty' : ''}`}
          placeholder="查找"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
          spellCheck={false}
        />
        {query && <span className="fr-count">{matchLabel}</span>}
        <button className="fr-btn" title="上一个 (Shift+Enter)" onClick={goPrev} disabled={total === 0 || disabled}>
          <ArrowUp size={14} />
        </button>
        <button className="fr-btn" title="下一个 (Enter)" onClick={goNext} disabled={total === 0 || disabled}>
          <ArrowDown size={14} />
        </button>
        <button
          className={`fr-btn${caseSensitive ? ' active' : ''}`}
          title="区分大小写"
          onClick={() => setCaseSensitive((v) => !v)}
        >
          <CaseSensitive size={14} />
        </button>
        <button className="fr-btn" title="关闭 (Esc)" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      {showReplace && (
        <div className="fr-row">
          <div className="fr-indent" />
          <input
            className="fr-input"
            placeholder="替换为"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={onInputKeyDown}
            spellCheck={false}
          />
          <button className="fr-btn-text" title="替换当前匹配" onClick={replaceOne} disabled={total === 0 || disabled}>
            替换
          </button>
          <button className="fr-btn-text" title="替换全部匹配" onClick={replaceAll} disabled={total === 0 || disabled}>
            全部替换
          </button>
        </div>
      )}
    </div>
  )
}
