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
    if (kind !== 'failed') clear = timer.after(3000, () => show({ kind: 'idle' }))
  }
  function pending(refs: T[], deadline = timer.now() + undoWindow) {
    show({ kind: 'pending', refs, deadline })
    clear = timer.after(Math.max(0, deadline - timer.now()), () => void send())
  }
  function failed(refs: T[]) {
    if (state.kind === 'pending') pending([...refs, ...state.refs], state.deadline)
    else result('failed', state.kind === 'failed' ? [...refs, ...state.refs] : refs)
  }
  async function send() {
    if (state.kind !== 'pending' && state.kind !== 'failed') return
    const sending = { kind: 'sending' as const, refs: state.refs }
    show(sending)
    const ok = await deliver(sending.refs).catch(() => false)
    if (!ok) failed(sending.refs)
    else if (state === sending) result('sent', sending.refs)
  }
  return {
    enqueue(refs: T[]) {
      if (!refs.length) return
      pending(state.kind === 'pending' || state.kind === 'failed' ? [...state.refs, ...refs] : [...refs])
    },
    undo() {
      if (state.kind === 'pending' || state.kind === 'failed') result('canceled', state.refs)
    },
    send,
  }
}
