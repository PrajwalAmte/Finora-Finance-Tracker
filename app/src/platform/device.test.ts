import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickFile } from './device';

interface FakeInput {
  type: string;
  accept: string;
  multiple: boolean;
  style: Record<string, string>;
  files: unknown[] | null;
  removed: boolean;
  click: ReturnType<typeof vi.fn>;
  emit(name: string): void;
  remove(): void;
  addEventListener(name: string, fn: () => void): void;
}

/** Just enough DOM for the browser file picker. */
function fakeDom(): FakeInput[] {
  const inputs: FakeInput[] = [];
  vi.stubGlobal('document', {
    body: { appendChild: vi.fn() },
    createElement: () => {
      const listeners: Record<string, () => void> = {};
      const el: FakeInput = {
        type: '', accept: '', multiple: true, style: {}, files: null, removed: false,
        click: vi.fn(),
        emit: name => listeners[name]?.(),
        remove() { this.removed = true; },
        addEventListener: (name, fn) => { listeners[name] = fn; },
      };
      inputs.push(el);
      return el;
    },
  });
  return inputs;
}

afterEach(() => vi.unstubAllGlobals());

describe('pickFile in a browser', () => {
  it('opens the picker synchronously inside the tap, so Safari still counts it as a user gesture', () => {
    const [input] = (() => { const i = fakeDom(); void pickFile(['application/pdf']); return i; })();
    expect(input.click).toHaveBeenCalledTimes(1);
  });

  it('accepts both MIME types and extensions, and everything for */*', () => {
    const inputs = fakeDom();
    void pickFile(['application/pdf', 'text/csv']);
    expect(inputs[0].accept.split(',').sort()).toEqual(['.csv', '.pdf', 'application/pdf', 'text/csv']);
    void pickFile(['*/*']);
    expect(inputs[1].accept).toBe('');
  });

  it('resolves with the file bytes once chosen, however long the file takes to arrive', async () => {
    const inputs = fakeDom();
    const picked = pickFile(['application/pdf']);
    // A PDF still downloading from iCloud: the page regains focus long before `change` fires.
    await new Promise(r => setTimeout(r, 700));
    inputs[0].files = [{ name: 'cas.pdf', type: 'application/pdf', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }];
    inputs[0].emit('change');
    const file = await picked;
    expect(file).toMatchObject({ name: 'cas.pdf', mimeType: 'application/pdf' });
    expect(Array.from(file!.bytes)).toEqual([1, 2, 3]);
    expect(inputs[0].removed).toBe(true);
  });

  it('resolves null when the browser reports a cancel, and when nothing was chosen', async () => {
    const inputs = fakeDom();
    const a = pickFile(['application/pdf']);
    inputs[0].emit('cancel');
    expect(await a).toBeNull();
    const b = pickFile(['application/pdf']);
    inputs[1].files = [];
    inputs[1].emit('change');
    expect(await b).toBeNull();
  });
});
