export type NoticeState<T> =
  | { kind: 'idle' }
  | { kind: 'pending'; refs: T[]; deadline: number }
  | { kind: 'sending' | 'sent' | 'canceled' | 'failed'; refs: T[] }

export const undoWindow = 5000
export function undoQueue<T>(
  timer: { now(): number; after(ms: number, callback: () => void): () => void },
  deliver: (refs: T[]) => Promise<boolean>,
  changed: (state: NoticeState<T>) => void,
) {
  let state: NoticeState<T> = { kind: 'idle' }
  let clear: (() => void) | undefined
  function show(next: NoticeState<T>) {
    clear?.()
    clear = undefined
    state = next
    changed(next)
  }
  function result(kind: 'sent' | 'canceled' | 'failed', refs: T[]) {
    show({ kind, refs })
    clear = timer.after(3000, () => show({ kind: 'idle' }))
  }
  async function send() {
    if (state.kind !== 'pending' && state.kind !== 'failed') return
    const sending = { kind: 'sending' as const, refs: state.refs }
    show(sending)
    const ok = await deliver(sending.refs).catch(() => false)
    if (state === sending) result(ok ? 'sent' : 'failed', sending.refs)
  }
  return {
    enqueue(refs: T[]) {
      if (!refs.length) return
      show({
        kind: 'pending',
        refs: state.kind === 'pending' ? [...state.refs, ...refs] : [...refs],
        deadline: timer.now() + undoWindow,
      })
      clear = timer.after(undoWindow, () => void send())
    },
    undo() {
      if (state.kind === 'pending') result('canceled', state.refs)
    },
    send,
  }
}
