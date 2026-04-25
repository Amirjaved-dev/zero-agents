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
    let isolate: InstanceType<IsolatedVm['Isolate']> | undefined;

    try {
      isolate = new ivm.Isolate({ memoryLimit: 16 });
      const context = await isolate.createContext();

      return context.evalClosure(this.createSandboxSource(toolCode), [new ivm.ExternalCopy(params).copyInto()], {
        timeout: timeoutMs,
        result: { promise: true, copy: true }
      });
    } finally {
      isolate?.dispose();
    }
  }

  private async runWithNodeVm(toolCode: string, params: object, timeoutMs: number): Promise<unknown> {
    const context = createContext({
      Math,
      JSON,
      Array,
      Object,
      String,
      Number,
      Date,
      params: structuredClone(params)
    });
    const script = new Script(`(async () => { ${this.createSandboxSource(toolCode).split('$0').join('params')} })()`);
    const result = script.runInContext(context, { timeout: timeoutMs });

    return Promise.race([
      result,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timeout')), timeoutMs);
      })
    ]);
  }

  private createSandboxSource(toolCode: string): string {
    return `
      const Math = globalThis.Math;
      const JSON = globalThis.JSON;
      const Array = globalThis.Array;
      const Object = globalThis.Object;
      const String = globalThis.String;
      const Number = globalThis.Number;
      const Date = globalThis.Date;

      globalThis.fetch = undefined;
      globalThis.require = undefined;
      globalThis.process = undefined;
      globalThis.Function = undefined;
      globalThis.eval = undefined;

      const fs = undefined;
      const child_process = undefined;
      const net = undefined;
      const http = undefined;
      const fetch = undefined;
      const require = undefined;
      const process = undefined;
      const global = undefined;
      const console = undefined;
      const setTimeout = undefined;
      const setInterval = undefined;
      const setImmediate = undefined;
      const Function = undefined;
      const eval = undefined;
      const RegExp = undefined;
      const Map = undefined;
      const Set = undefined;
      const WeakMap = undefined;
      const WeakSet = undefined;
      const ArrayBuffer = undefined;
      const SharedArrayBuffer = undefined;
      const DataView = undefined;
      const Proxy = undefined;
      const Reflect = undefined;
      const Atomics = undefined;
      const Intl = undefined;

      const execute = (${toolCode});
      return execute($0);
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
        error.message.includes('ERR_DLOPEN_FAILED'))
    );
  }

  private isTimeoutError(error: unknown): boolean {
    return /timeout|timed out/i.test(error instanceof Error ? error.message : String(error));
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
