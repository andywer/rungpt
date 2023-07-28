import { Debug, debug } from "debug/mod.ts";
import { EventMiddleware, ExtendableStateStore, MiddlewareStack, StateReducer } from "../types/state.d.ts";

export type StoreEvent<State, Event> = {
  dispatch: [action: Event];
  stateChange: [action: Event, next: State, prev: State];
  trace: [source: Event, secondary: Event];
}

/**
 * Side-effect-free extendable state management.
 *
 * Dispatch events to update the state, register reducers to update the state
 * in response to events, and register middlewares to customize behavior further.
 */
class StateStore<State, Event> implements ExtendableStateStore<State, Event> {
  protected middlewareStack: EventMiddlewareImpl<State, Event>;
  protected combinedReducer: StateReducer<State, Event>;
  protected state: State;

  private debugDispatch: Debug;

  private readonly subscriptions = new Set<(state: State, event: Event) => void>();

  constructor(
    name: string,
    initialState: State,
    private reducers: StateReducer<State, Event>[],
    private middlewares: EventMiddleware<State, Event>[] = [],
  ) {
    this.state = initialState;
    this.combinedReducer = chainReducers(...reducers);
    this.middlewareStack = new EventMiddlewareImpl(middlewares, () => this.state, (event) => this.dispatch(event));
    this.debugDispatch = debug(`store:${name}:dispatch`);
  }

  async dispatch(event: Event): Promise<State> {
    // deno-lint-ignore no-explicit-any
    if ((event as any).debug !== false) {
      this.debugDispatch("%o", event);
    }

    await this.middlewareStack.execute(event, (resultingEvent) => {
      const next = this.combinedReducer(this.state, resultingEvent);
      this.state = next;

      for (const listener of this.subscriptions) {
        try {
          listener(next, resultingEvent);
        } catch (error) {
          console.error(error);
        }
      }
    });

    return this.state;
  }

  getState(): State {
    return this.state;
  }

  registerMiddlewares(...middlewares: EventMiddleware<State, Event>[]): void {
    this.middlewares.push(...middlewares);
    this.middlewareStack = new EventMiddlewareImpl(this.middlewares, () => this.state, (event) => this.dispatch(event));
  }

  registerReducers(...reducers: StateReducer<State, Event>[]): void {
    this.reducers.push(...reducers);
    this.combinedReducer = chainReducers(...this.reducers);
  }

  subscribe(listener: (state: State, event: Event) => void): () => void {
    this.subscriptions.add(listener);
    return () => this.subscriptions.delete(listener);
  }
}

export function createStateStore<State, Event>(
  name: string,
  initialState: State,
  reducers: StateReducer<State, Event>[],
  middlewares: EventMiddleware<State, Event>[] = [],
): StateStore<State, Event> {
  return new StateStore(name, initialState, reducers, middlewares);
}

class EventMiddlewareImpl<State, Event> {
  constructor(
    protected middlewares: EventMiddleware<State, Event>[],
    protected readonly getState: () => State,
    protected readonly dispatch: StateStore<State, Event>["dispatch"],
  ) { }

  execute(event: Event, sink: (event: Event) => Promise<void> | void): Promise<void> {
    return this._execute(this.middlewares, event, sink);
  }

  protected async _execute(
    middlewares: EventMiddleware<State, Event>[],
    event: Event,
    sink: (event: Event) => Promise<void> | void,
  ): Promise<void> {
    if (middlewares.length === 0) {
      return sink(event);
    }

    const current = middlewares[0]!;
    let hasBeenCalled = false;

    const stack: MiddlewareStack<Event> = {
      dispatch: async (event) => {
        await this.dispatch(event);
      },
      next: async (event) => {
        hasBeenCalled = true;
        await this._execute(middlewares.slice(1), event, sink);
      },
      skip: () => {
        hasBeenCalled = true;
      },
    };

    await current(event, stack, this.getState);

    if (!hasBeenCalled) {
      throw new Error(`Middleware "${current.name}" did not call next() or skip()`);
    }
  }
}

export function chainReducers<State, Event>(
  ...reducers: StateReducer<State, Event>[]
): StateReducer<State, Event> {
  return (state: State, action: Event) => {
    let nextState = state;
    for (const reducer of reducers) {
      nextState = reducer(nextState, action);
    }
    return nextState;
  };
}
