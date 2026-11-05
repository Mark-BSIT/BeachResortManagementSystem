export type UiEventName =
  | "loginSucceeded"
  | "logoutRequested"
  | "catalogLoaded"
  | "bookingSubmitted"
  | "screenChanged";

type Listener = (payload: Record<string, unknown>) => void;

class UiEventBus {
  private listeners = new Map<UiEventName, Set<Listener>>();

  on(name: UiEventName, listener: Listener): () => void {
    const set = this.listeners.get(name) ?? new Set<Listener>();

    set.add(listener);
    this.listeners.set(name, set);

    return () => {
      set.delete(listener);
    };
  }

  emit(name: UiEventName, payload: Record<string, unknown> = {}) {
    this.listeners.get(name)?.forEach((listener) => listener(payload));
  }
}

export const uiEvents = new UiEventBus();