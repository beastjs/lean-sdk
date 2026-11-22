/**
 * ==============================================================================
 * Error codes emitted by the Lean Math SDK.
 *
 * These codes are stable identifiers intended for programmatic handling.
 * ------------------------------------------------------------------------------
 */
export type LeanMathErrorCode =
  | 'SDK_ERROR'
  | 'VALIDATION_ERROR'
  | 'RUNTIME_INITIALIZATION_ERROR'
  | 'COMPILATION_ERROR'
  | 'EXECUTION_ERROR'
  | 'TIMEOUT_ERROR'
  | 'WORKER_ERROR'
  | 'MODULE_LOAD_ERROR'
  | 'DISPOSED_ERROR'

/**
 * Additional structured information attached to SDK errors.
 */
export type LeanMathErrorDetails = Record<string, unknown>

/**
 * Base error for all errors originating from the Lean Math SDK.
 *
 * Provides:
 * - Stable error codes
 * - Structured details
 * - Original error causes
 * - JSON serialization
 */
export class LeanMathError extends Error {
  readonly code: LeanMathErrorCode
  readonly details: LeanMathErrorDetails | undefined

  constructor(
    message: string,
    options: {
      code?: LeanMathErrorCode | undefined
      details?: LeanMathErrorDetails | undefined
      cause?: unknown
    } = {}
  ) {
    super(message, { cause: options.cause })

    this.name = 'LeanMathError'
    this.code = options.code ?? 'SDK_ERROR'
    this.details = options.details

    // Maintains proper prototype behavior when transpiled.
    Object.setPrototypeOf(this, new.target.prototype)
  }

  /**
   * Converts the error into a serializable object.
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      details: this.details,
      cause:
        this.cause instanceof Error
          ? {
              name: this.cause.name,
              message: this.cause.message
            }
          : this.cause
    }
  }
}

/**
 * Thrown when SDK input or configuration is invalid.
 */
export class ValidationError extends LeanMathError {
  constructor(message: string, details?: LeanMathErrorDetails, cause?: unknown) {
    super(message, {
      code: 'VALIDATION_ERROR',
      details,
      cause
    })

    this.name = 'ValidationError'
  }
}

/**
 * Thrown when the Lean runtime cannot initialize.
 */
export class RuntimeInitializationError extends LeanMathError {
  constructor(message: string, cause?: unknown) {
    super(message, {
      code: 'RUNTIME_INITIALIZATION_ERROR',
      cause
    })

    this.name = 'RuntimeInitializationError'
  }
}

/**
 * Thrown when Lean source code fails to compile.
 */
export class LeanCompilationError extends LeanMathError {
  readonly source: string | undefined
  readonly diagnostics: string | undefined

  constructor(
    message: string,
    options: {
      source?: string
      diagnostics?: string
      cause?: unknown
    } = {}
  ) {
    super(message, {
      code: 'COMPILATION_ERROR',
      details: {
        diagnostics: options.diagnostics
      },
      cause: options.cause
    })

    this.name = 'LeanCompilationError'
    this.source = options.source
    this.diagnostics = options.diagnostics
  }
}

/**
 * Thrown when compiled Lean code fails during execution.
 */
export class LeanExecutionError extends LeanMathError {
  constructor(message: string, details?: LeanMathErrorDetails, cause?: unknown) {
    super(message, {
      code: 'EXECUTION_ERROR',
      details,
      cause
    })

    this.name = 'LeanExecutionError'
  }
}

/**
 * Thrown when an operation exceeds its allowed execution time.
 */
export class LeanTimeoutError extends LeanMathError {
  readonly timeoutMs: number

  constructor(timeoutMs: number, cause?: unknown) {
    super(`Lean execution timed out after ${timeoutMs}ms.`, {
      code: 'TIMEOUT_ERROR',
      details: { timeoutMs },
      cause
    })

    this.name = 'LeanTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

/**
 * Thrown when the Lean worker encounters an unexpected failure.
 */
export class LeanWorkerError extends LeanMathError {
  constructor(message: string, cause?: unknown) {
    super(message, {
      code: 'WORKER_ERROR',
      cause
    })

    this.name = 'LeanWorkerError'
  }
}

/**
 * Thrown when Lean cannot load an imported module.
 */
export class LeanModuleLoadError extends LeanMathError {
  readonly moduleName: string

  constructor(moduleName: string, cause?: unknown) {
    super(`Failed to load Lean module "${moduleName}".`, {
      code: 'MODULE_LOAD_ERROR',
      details: { moduleName },
      cause
    })

    this.name = 'LeanModuleLoadError'
    this.moduleName = moduleName
  }
}

/**
 * Thrown when an operation is attempted on a disposed SDK instance.
 */
export class LeanMathDisposedError extends LeanMathError {
  constructor(message = 'The Lean Math SDK instance has been disposed.') {
    super(message, {
      code: 'DISPOSED_ERROR'
    })

    this.name = 'LeanMathDisposedError'
  }
}

/**
 * Type guard for identifying SDK errors.
 */
export function isLeanMathError(error: unknown): error is LeanMathError {
  return error instanceof LeanMathError
}

/**
 * Converts an unknown value into a useful Error instance.
 *
 * Useful when handling errors from workers, RPCs, or external libraries.
 */
export function normalizeError(error: unknown, fallbackMessage = 'An unexpected error occurred.'): Error {
  if (error instanceof Error) {
    return error
  }

  if (typeof error === 'string') {
    return new Error(error)
  }

  if (error === null || error === undefined) {
    return new Error(fallbackMessage)
  }

  try {
    return new Error(JSON.stringify(error))
  } catch {
    return new Error(fallbackMessage)
  }
}
