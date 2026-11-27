import { dedupe } from '../dedupe'
import type { Failure, Source } from '../../core/model'
import { runCli, commandLabel } from '../cli'
class ReadFailure extends Error {
  constructor(readonly failure: Failure) {
    super(failure.message)
  }
}
export function reader(binary: 'orca' | 'gh', path: string) {
  return async <T>(args: string[], normalize: (v: unknown) => T): Promise<T> => {
    const execute = () => runCli(binary, args, path)
    const result = await (args.includes('--method') ? execute() : dedupe(JSON.stringify([binary, path, args]), execute))
    if (!result.ok) throw new ReadFailure(result)
    try {
      return normalize(result.value)
    } catch (error) {
      throw new ReadFailure({
        ok: false,
        command: commandLabel(binary, args),
        message: String(error),
        next: 'Check the CLI version and refresh the board.',
      })
    }
  }
}
export async function source<T>(command: string, load: () => Promise<T>): Promise<Source<T>> {
  try {
    return { ok: true, value: await load() }
  } catch (error) {
    return error instanceof ReadFailure
      ? error.failure
      : { ok: false, command, message: String(error), next: 'Check the connection and refresh.' }
  }
}
