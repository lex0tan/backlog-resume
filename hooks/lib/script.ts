import type { EngineInterface } from 'claude-code'

export function scriptPath($: EngineInterface): string {
  return `${$.plugin.root}/scripts/backlog.mjs`
}

/**
 * Runs the CLI in the session's folder and returns its JSON. stdout that is not JSON, or a process
 * that cannot start, becomes `{ status: 'error', message }`.
 */
export async function runScript($: EngineInterface, args: string[]): Promise<Record<string, unknown>> {
  try {
    const run = await $.process.run(['node', scriptPath($), '--cwd', await $.session.cwd(), ...args], { timeoutMs: 60_000 })
    try {
      return JSON.parse(run.stdout) as Record<string, unknown>
    } catch {
      return { status: 'error', message: (run.stderr || run.stdout).slice(0, 200) }
    }
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}
