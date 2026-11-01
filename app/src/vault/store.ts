import type { VaultData } from '../domain/types';

type Listener = () => void;

interface UndoEntry {
  label: string;
  data: VaultData;
}

/**
 * The single in-memory copy of the unlocked vault. Updates are immutable, so undo just keeps the
 * previous root (structural sharing makes that cheap). Every update is handed to `persist`, which
 * debounces and writes the encrypted file.
 */
export class VaultStore {
  private data: VaultData;
  private listeners = new Set<Listener>();
  private undoStack: UndoEntry[] = [];

  constructor(initial: VaultData, private persist: (data: VaultData) => void) {
    this.data = initial;
  }

  get = (): VaultData => this.data;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Apply a change. Pass a label to make it undoable ("Deleted expense"). */
  update(fn: (data: VaultData) => VaultData, undoLabel?: string): void {
    const prev = this.data;
    const next = fn(prev);
    if (next === prev) return;
    if (undoLabel) {
      this.undoStack.push({ label: undoLabel, data: prev });
      if (this.undoStack.length > 20) this.undoStack.shift();
    } else {
      // Undo restores a whole earlier state, so it is only safe while nothing else has changed since.
      this.undoStack = [];
    }
    this.set(next);
  }

  /** Replace without an undo entry (catch-up, imports after confirmation). */
  replace(next: VaultData): void {
    this.undoStack = [];
    if (next !== this.data) this.set(next);
  }

  undo(): string | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.set(entry.data);
    return entry.label;
  }

  private set(next: VaultData): void {
    this.data = next;
    this.persist(next);
    this.listeners.forEach(l => l());
  }
}
