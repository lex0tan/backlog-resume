// Runs fn with the named environment variables set, then puts back what was there. Child processes started inside fn
// inherit them, so tests never build a copy of the whole environment to hand to a child process.
export function withEnv(vars, fn) {
  const before = Object.fromEntries(Object.keys(vars).map((name) => [name, process.env[name]]))
  Object.assign(process.env, vars)
  try {
    return fn()
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}
