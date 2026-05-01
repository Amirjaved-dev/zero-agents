import { createContext, Script } from 'node:vm';

type IsolatedVm = typeof import('isolated-vm');

export interface SandboxResult {
  success: boolean;
  output: unknown;
  error?: string;
  executionTimeMs: number;
}

export interface ToolSandboxOptions {
  /**
   * Development-only fallback. Node's vm module is not a hard security boundary
   * for hostile generated code, so production callers should keep this false.
   */
  allowUnsafeNodeVmFallback?: boolean;
  /** Optional network allowlist for generated tool fetch() calls. Empty means any host. */
  allowedFetchHostnames?: string[];
  /** Maximum response body size copied back into the sandbox. Default: 1 MiB. */
  maxFetchResponseBytes?: number;
  /** Object keys that make a returned tool output count as failure. Default: ['error']. Empty disables this check. */
  errorOutputKeys?: string[];
  /** Default execution timeout for run() when no timeout argument is provided. Default: 3000. */
  timeoutMs?: number;
  beforeSandboxRun?: (toolCode: string, params: object) => void | Promise<void>;
  afterSandboxRun?: (result: SandboxResult) => void | Promise<void>;
}

export class ToolSandbox {
  private readonly allowUnsafeNodeVmFallback: boolean;
  private readonly allowedFetchHostnames: Set<string> | null;
  private readonly maxFetchResponseBytes: number;
  private readonly errorOutputKeys: string[];
  private readonly timeoutMs: number;
  private readonly beforeSandboxRun?: (toolCode: string, params: object) => void | Promise<void>;
  private readonly afterSandboxRun?: (result: SandboxResult) => void | Promise<void>;

  constructor(options: ToolSandboxOptions = {}) {
    this.allowUnsafeNodeVmFallback = options.allowUnsafeNodeVmFallback ?? false;
    this.allowedFetchHostnames = options.allowedFetchHostnames && options.allowedFetchHostnames.length > 0
      ? new Set(options.allowedFetchHostnames.map((host) => host.toLowerCase()))
      : null;
    this.maxFetchResponseBytes = options.maxFetchResponseBytes ?? 1024 * 1024;
    this.errorOutputKeys = options.errorOutputKeys ?? ['error'];
    this.timeoutMs = options.timeoutMs ?? 3000;
    this.beforeSandboxRun = options.beforeSandboxRun;
    this.afterSandboxRun = options.afterSandboxRun;
  }

  async run(toolCode: string, params: object, timeoutMs = this.timeoutMs): Promise<SandboxResult> {
    const startedAt = Date.now();
    await this.beforeSandboxRun?.(toolCode, params);

    try {
      const ivm = await this.loadIsolatedVm();
      const output = await this.runWithIsolatedVm(ivm, toolCode, params, timeoutMs);

      return this.finalizeResult({
        success: true,
        output,
        executionTimeMs: Date.now() - startedAt
      });
    } catch (error) {
      if (!this.isIsolatedVmLoadError(error)) {
        return this.finalizeResult(this.createFailureResult(error, startedAt));
      }

      if (!this.allowUnsafeNodeVmFallback) {
        return this.finalizeResult(this.createFailureResult(
          new Error('isolated-vm is unavailable and unsafe Node vm fallback is disabled'),
          startedAt
        ));
      }

      try {
        const output = await this.runWithNodeVm(toolCode, params, timeoutMs);

        return this.finalizeResult({
          success: true,
          output,
          executionTimeMs: Date.now() - startedAt
        });
      } catch (fallbackError) {
        return this.finalizeResult(this.createFailureResult(fallbackError, startedAt));
      }
    }
  }

  private async finalizeResult(result: SandboxResult): Promise<SandboxResult> {
    const semanticError = result.success ? this.getStructuredOutputError(result.output) : undefined;
    const finalized = semanticError
      ? { ...result, success: false, error: semanticError }
      : result;
    await this.afterSandboxRun?.(finalized);
    return finalized;
  }

  private getStructuredOutputError(output: unknown): string | undefined {
    if (this.errorOutputKeys.length === 0 || output === null || typeof output !== 'object' || Array.isArray(output)) {
      return undefined;
    }

    const record = output as Record<string, unknown>;
    const key = this.errorOutputKeys.find((candidate) => record[candidate] !== undefined && record[candidate] !== null);
    if (!key) return undefined;

    const value = record[key];
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  private async loadIsolatedVm(): Promise<IsolatedVm> {
    return import('isolated-vm');
  }

  private async runWithIsolatedVm(ivm: IsolatedVm, toolCode: string, params: object, timeoutMs: number): Promise<unknown> {
    const Isolate = (ivm as any).Isolate || (ivm as any).default?.Isolate;
    if (!Isolate) {
      throw new Error('isolated-vm: Isolate not found in module');
    }
    const ExternalCopy = (ivm as any).ExternalCopy || (ivm as any).default?.ExternalCopy;
    if (!ExternalCopy) {
      throw new Error('isolated-vm: ExternalCopy not found in module');
    }
    const Reference = (ivm as any).Reference || (ivm as any).default?.Reference;

    const isolate = new Isolate({ memoryLimit: 16 }) as InstanceType<IsolatedVm['Isolate']>;

    try {
      const context = await isolate.createContext();

      // Inject a fetch bridge so tools using fetch() stay inside the secure isolate.
      // The bridge serialises request options and response body through JSON (ExternalCopy-safe).
      if (Reference) {
        const fetchBridge = new Reference(async (url: string, optionsJson: string) => {
          const options: RequestInit = optionsJson ? (JSON.parse(optionsJson) as RequestInit) : {};
          const res = await this.limitedFetch(url, options, timeoutMs);
          const body = await this.readLimitedResponseBody(res);
          return JSON.stringify({ ok: res.ok, status: res.status, body });
        });
        await context.global.set('__fetchBridge', fetchBridge);
      }

      const result = await context.evalClosure(
        this.createSandboxSource(toolCode, !!Reference),
        [new ExternalCopy(params).copyInto()],
        { timeout: timeoutMs, result: { promise: true, copy: true } }
      );
      return result;
    } finally {
      isolate.dispose();
    }
  }

  private async runWithNodeVm(toolCode: string, params: object, timeoutMs: number): Promise<unknown> {
    const context = createContext({
      // Safe builtins
      Math,
      JSON,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Date,
      Promise,
      Symbol,
      Error,
      TypeError,
      RangeError,
      // Standard collections — LLM-generated tools use these regularly
      Map,
      Set,
      WeakMap,
      WeakSet,
      RegExp,
      ArrayBuffer,
      DataView,
      Intl,
      // Async timing (outer Promise.race enforces overall timeout)
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      // Network — intentionally available for tool execution
      fetch: (url: string, options?: RequestInit) => this.limitedFetch(url, options, timeoutMs),
      params: structuredClone(params)
    });
    const script = new Script(`(async () => { ${this.createSandboxSource(toolCode, false, 'params')} })()`);
    const result = script.runInContext(context, { timeout: timeoutMs });

    return Promise.race([
      result,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timeout')), timeoutMs);
      })
    ]);
  }

  private createSandboxSource(toolCode: string, hasFetchBridge = false, paramsRef = '$0'): string {
    const fetchSetup = hasFetchBridge
      ? `
      // Wrap the host fetch bridge into a standard fetch()-compatible API
      globalThis.fetch = async function(url, options) {
        const json = await __fetchBridge.apply(
          undefined,
          [String(url), JSON.stringify(options || {})],
          { arguments: { copy: true }, result: { promise: true, copy: true } }
        );
        const parsed = JSON.parse(json);
        return {
          ok: parsed.ok,
          status: parsed.status,
          text: async () => parsed.body,
          json: async () => JSON.parse(parsed.body)
        };
      };`
      : '';

    return `
      ${fetchSetup}

      // Preserve safe builtins before shadowing dangerous ones
      const Math = globalThis.Math;
      const JSON = globalThis.JSON;
      const Array = globalThis.Array;
      const Object = globalThis.Object;
      const String = globalThis.String;
      const Number = globalThis.Number;
      const Boolean = globalThis.Boolean;
      const Date = globalThis.Date;
      const Promise = globalThis.Promise;
      const Symbol = globalThis.Symbol;
      const Error = globalThis.Error;
      const Map = globalThis.Map;
      const Set = globalThis.Set;
      const WeakMap = globalThis.WeakMap;
      const WeakSet = globalThis.WeakSet;
      const RegExp = globalThis.RegExp;
      const ArrayBuffer = globalThis.ArrayBuffer;
      const DataView = globalThis.DataView;
      const Intl = globalThis.Intl;

      // Disable host-escape vectors
      globalThis.require = undefined;
      globalThis.process = undefined;
      globalThis.Function = undefined;
      globalThis.eval = undefined;

      const fs = undefined;
      const child_process = undefined;
      const net = undefined;
      const http = undefined;
      const require = undefined;
      const process = undefined;
      const global = undefined;
      const console = undefined;
      const Function = undefined;
      const eval = undefined;

      const execute = (${toolCode});
      return execute(${paramsRef});
    `;
  }

  private async limitedFetch(url: string, options: RequestInit = {}, timeoutMs: number): Promise<Response> {
    this.assertFetchAllowed(url);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();

    try {
      return await fetch(url, {
        ...options,
        signal: options.signal ?? controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private assertFetchAllowed(url: string): void {
    if (!this.allowedFetchHostnames) return;

    const hostname = new URL(url).hostname.toLowerCase();
    if (!this.allowedFetchHostnames.has(hostname)) {
      throw new Error(`fetch blocked for host: ${hostname}`);
    }
  }

  private async readLimitedResponseBody(response: Response): Promise<string> {
    const contentLength = response.headers.get('content-length');
    if (contentLength && Number(contentLength) > this.maxFetchResponseBytes) {
      throw new Error(`fetch response exceeded ${this.maxFetchResponseBytes} bytes`);
    }

    const body = await response.text();
    if (Buffer.byteLength(body, 'utf-8') > this.maxFetchResponseBytes) {
      throw new Error(`fetch response exceeded ${this.maxFetchResponseBytes} bytes`);
    }

    return body;
  }

  private createFailureResult(error: unknown, startedAt: number): SandboxResult {
    return {
      success: false,
      output: null,
      error: this.isTimeoutError(error) ? 'Timeout' : this.getErrorMessage(error),
      executionTimeMs: Date.now() - startedAt
    };
  }

  private isIsolatedVmLoadError(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.message.includes('No native build was found') ||
        error.message.includes('Cannot find module') ||
        error.message.includes('ERR_DLOPEN_FAILED') ||
        error.message.includes('isolated-vm:') ||
        error.message.includes('does not provide an export named'))
    );
  }

  private isTimeoutError(error: unknown): boolean {
    return /timeout|timed out/i.test(error instanceof Error ? error.message : String(error));
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
