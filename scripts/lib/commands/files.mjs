// `files`: absolute paths of every backlog file, for the guards. Reads the loaded trees only: no git, no file system walk.

import { join } from 'node:path'
import { identity } from '../paths.mjs'
import { posix } from '../text.mjs'

/** @param {import('../workspace.mjs').Workspace} ws */
export function files(ws) {
  const projects = ws.projects.map((p) => {
    const seen = new Set()
    const list = []
    for (const node of [p.tree.top, ...p.tree.nodes]) {
      if (node.exists === false) continue
      const path = join(p.root, node.file)
      if (seen.has(identity(path))) continue
      seen.add(identity(path))
      list.push(posix(path))
    }
    return { rel: p.rel, root: posix(p.root), files: list }
  })
  return { status: 'ok', projects }
}
