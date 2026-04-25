import ivm from 'isolated-vm';

export interface SandboxResult {
  success: boolean;
  output: any;
  error?: string;
  executionTimeMs: number;
}

export class ToolSandbox {
  async run(toolCode: string, params: object, timeoutMs = 3000): Promise<SandboxResult> {
    const startedAt = Date.now();
    let isolate: ivm.Isolate | undefined;

    try {
      isolate = new ivm.Isolate({ memoryLimit: 16 });
      const context = await isolate.createContext();

      const output = await context.evalClosure(
        `
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
        const Promise = undefined;
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
        `,
        [new ivm.ExternalCopy(params).copyInto()],
        {
          timeout: timeoutMs,
          result: { promise: true, copy: true }
        }
      );

      return {
        success: true,
        output,
        executionTimeMs: Date.now() - startedAt
      };
    } catch (error) {
      return {
        success: false,
        output: null,
        error: this.isTimeoutError(error) ? 'Timeout' : this.getErrorMessage(error),
        executionTimeMs: Date.now() - startedAt
      };
    } finally {
      isolate?.dispose();
    }
  }

  private isTimeoutError(error: unknown): boolean {
    return error instanceof Error && error.message.toLowerCase().includes('timeout');
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
