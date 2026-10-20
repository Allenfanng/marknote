/**
 * 查找替换（WYSIWYG）：ProseMirror 插件。
 *
 * 插件自身只维护「匹配区间列表 + 高亮 decorations」；跳转/替换的编排
 * 在 EditorHandle 的方法里（通过 plugin meta 与 getState 交互），这样
 * React 层（FindReplace 组件）不接触 ProseMirror 细节。
 */
import { $prose } from '@milkdown/utils'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'

export interface FindMatch {
  from: number
  to: number
}

export interface FindState {
  query: string
  caseSensitive: boolean
  matches: FindMatch[]
  active: number
  decos: DecorationSet
}

export type FindMeta =
  | { type: 'query'; query: string; caseSensitive: boolean }
  | { type: 'active'; active: number }

export const findPluginKey = new PluginKey<FindState>('marknote-find')

const emptyState: FindState = {
  query: '',
  caseSensitive: false,
  matches: [],
  active: 0,
  decos: DecorationSet.empty,
}

/** 扫描全部 text node，收集所有匹配区间（跨节点边界不匹配，与多数编辑器一致） */
export function findMatches(
  doc: EditorState['doc'],
  query: string,
  caseSensitive: boolean,
): FindMatch[] {
  const out: FindMatch[] = []
  if (!query) return out
  const needle = caseSensitive ? query : query.toLowerCase()
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    const text = caseSensitive ? node.text : node.text.toLowerCase()
    let idx = text.indexOf(needle)
    while (idx !== -1) {
      out.push({ from: pos + idx, to: pos + idx + needle.length })
      idx = text.indexOf(needle, idx + needle.length)
    }
    return
  })
  return out
}

function buildDecos(state: EditorState, matches: FindMatch[], active: number): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty
  return DecorationSet.create(
    state.doc,
    matches.map((m, i) =>
      Decoration.inline(m.from, m.to, {
        class: i === active ? 'find-match find-match-active' : 'find-match',
      }),
    ),
  )
}

export const findPlugin = $prose(() => {
  return new Plugin<FindState>({
    key: findPluginKey,
    state: {
      init: () => emptyState,
      apply: (tr, prev, _oldState, newState) => {
        const meta = tr.getMeta(findPluginKey) as FindMeta | undefined
        if (meta?.type === 'query') {
          const matches = findMatches(newState.doc, meta.query, meta.caseSensitive)
          const active = 0
          return {
            query: meta.query,
            caseSensitive: meta.caseSensitive,
            matches,
            active,
            decos: buildDecos(newState, matches, active),
          }
        }
        if (meta?.type === 'active') {
          const active = Math.max(0, Math.min(meta.active, prev.matches.length - 1))
          return { ...prev, active, decos: buildDecos(newState, prev.matches, active) }
        }
        // 文档变化（含替换）后重算匹配；选区变化只跟随 map（高亮位置不变）
        if (tr.docChanged && prev.query) {
          const matches = findMatches(newState.doc, prev.query, prev.caseSensitive)
          const active = prev.active < matches.length ? prev.active : 0
          return { ...prev, matches, active, decos: buildDecos(newState, matches, active) }
        }
        if (prev.decos !== DecorationSet.empty) {
          return { ...prev, decos: prev.decos.map(tr.mapping, tr.doc) }
        }
        return prev
      },
    },
    props: {
      decorations: (state) => findPluginKey.getState(state)?.decos ?? DecorationSet.empty,
    },
  })
})

/** 把光标定位到某个匹配上（供跳转/替换后使用） */
export function selectMatch(state: EditorState, match: FindMatch): TextSelection {
  return TextSelection.create(state.doc, match.from, match.to)
}
