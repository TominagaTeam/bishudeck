/**
 * Editor-wide event bus. Plugins subscribe here rather than reaching into
 * stores directly, which keeps the set of things a plugin can observe explicit.
 */

export interface EditorEvents {
  'project:loaded': { title: string; slideCount: number };
  'project:saved': { path: string };
  'document:changed': { slideId: string | null };
  'slide:changed': { index: number };
  /**
   * A command asking for a particular slide to be shown, because the one the
   * user was on has moved or been removed. Distinct from `slide:changed`, which
   * reports where the editor already is: this is a request, and it is how a
   * command reaches the UI without `core` depending on it.
   */
  'slide:focusRequest': { index: number };
  'selection:changed': { uid: string | null };
  'mode:changed': { mode: 'edit' | 'preview' };
  'stage:ready': { slideId: string };
  error: { message: string; cause?: unknown };
}

type Handler<K extends keyof EditorEvents> = (payload: EditorEvents[K]) => void;

export class EventBus {
  #handlers = new Map<keyof EditorEvents, Set<Handler<never>>>();

  on<K extends keyof EditorEvents>(event: K, handler: Handler<K>): () => void {
    let set = this.#handlers.get(event);
    if (!set) {
      set = new Set();
      this.#handlers.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => {
      set!.delete(handler as Handler<never>);
    };
  }

  emit<K extends keyof EditorEvents>(event: K, payload: EditorEvents[K]): void {
    const set = this.#handlers.get(event);
    if (!set) return;
    for (const handler of Array.from(set) as Handler<K>[]) {
      try {
        handler(payload);
      } catch (cause) {
        // A misbehaving listener must not take down whichever action emitted.
        console.error(`[EventBus] handler for "${String(event)}" threw`, cause);
      }
    }
  }
}

export const editorEvents = new EventBus();
