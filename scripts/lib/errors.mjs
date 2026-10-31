// Custom errors with structured context. The CLI turns them into
// { status: 'error', code: '<ClassName>', message, ...context }.

export class BacklogError extends Error {
  /**
   * @param {string} message
   * @param {Record<string, unknown>} [context]
   */
  constructor(message, context = {}) {
    super(message)
    this.name = new.target.name
    this.code = new.target.name
    this.context = context
  }

  toJSON() {
    return { status: 'error', code: this.code, message: this.message, ...this.context }
  }
}

export class ConfigError extends BacklogError {
  constructor(file, reason) {
    super(`Invalid configuration in ${file}: ${reason}`, { file, reason })
  }
}

export class LanguageNotFoundError extends BacklogError {
  constructor(language, path) {
    super(`Language "${language}" not found (looked for ${path})`, { language, path })
  }
}

export class IndexNotFoundError extends BacklogError {
  constructor(path) {
    super(`Index file not found: ${path}`, { path })
  }
}

export class ItemNotFoundError extends BacklogError {
  constructor(id) {
    super(`Item not found: ${id}`, { id })
  }
}

export class AmbiguousIdError extends BacklogError {
  constructor(id, matches) {
    super(`Ambiguous ID ${id}: ${matches.join(', ')}`, { id, matches })
  }
}

export class WorkstreamNotFoundError extends BacklogError {
  constructor(id) {
    super(`Workstream not found: ${id}`, { id })
  }
}

export class InvalidInputError extends BacklogError {
  constructor(field, reason) {
    super(`Invalid ${field}: ${reason}`, { field, reason })
  }
}

export class UsageError extends BacklogError {
  constructor(message) {
    super(message)
  }
}
