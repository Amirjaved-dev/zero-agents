import { createContext, Script } from 'node:vm';

type IsolatedVm = typeof import('isolated-vm');

export interface SandboxResult {
  success: boolean;
  output: any;
  error?: string;
  executionTimeMs: number;
}

export class ToolSandbox {
  async run(toolCode: string, params: object, timeoutMs = 3000): Promise<SandboxResult> {
    const startedAt = Date.now();

    try {
      const ivm = await this.loadIsolatedVm();
      const output = await this.runWithIsolatedVm(ivm, toolCode, params, timeoutMs);

      return {
        success: true,
        output,
        executionTimeMs: Date.now() - startedAt
      };
    } catch (error) {
      if (!this.isIsolatedVmLoadError(error)) {
        return this.createFailureResult(error, startedAt);
      }

      try {
        const output = await this.runWithNodeVm(toolCode, params, timeoutMs);

        return {
          success: true,
          output,
          executionTimeMs: Date.now() - startedAt
        };
      } catch (fallbackError) {
        return this.createFailureResult(fallbackError, startedAt);
      }
    }
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
          const res = await fetch(url, options);
          const body = await res.text();
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
      fetch,
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
