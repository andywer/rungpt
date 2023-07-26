import { debug } from "debug/mod.ts";
import { EventMiddleware, ExtendableStateStore, MiddlewareStack, StateReducer } from "../types/state.d.ts";

const debugEventDispatch = debug("store:dispatch");

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

  private readonly subscriptions = new Set<(state: State, event: Event) => void>();

  constructor(
    initialState: State,
    private reducers: StateReducer<State, Event>[],
    private middlewares: EventMiddleware<State, Event>[] = [],
  ) {
    this.state = initialState;
    this.combinedReducer = chainReducers(...reducers);
    this.middlewareStack = new EventMiddlewareImpl(middlewares, () => this.state, (event) => this.dispatch(event));
  }

  dispatch(event: Event): [updatedState: State, execution: Promise<void>] {
    debugEventDispatch("%o", event);

    const next = this.combinedReducer(this.state, event);
    const [stack, controller] = this.middlewareStack.createStack();

    const middlewareExecution = stack.next(event).then(() => controller.assertHasBeenCalled());

    this.state = next;
    for (const listener of this.subscriptions) {
      try {
        listener(next, event);
      } catch (error) {
        console.error(error);
      }
    }

    return [next, middlewareExecution];
  }

  getState(): State {
    return this.state;
  }

  registerMiddlewares(...middlewares: EventMiddleware<State, Event>[]): void {
    this.middlewares.push(...middlewares);
    this.middlewareStack = new EventMiddlewareImpl(middlewares, () => this.state, (event) => this.dispatch(event));
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
  initialState: State,
  reducers: StateReducer<State, Event>[],
  middlewares: EventMiddleware<State, Event>[] = [],
): StateStore<State, Event> {
  return new StateStore(initialState, reducers, middlewares);
}

class EventMiddlewareImpl<State, Event> {
  constructor(
    protected middlewares: EventMiddleware<State, Event>[],
    protected readonly getState: () => State,
    protected readonly dispatch: StateStore<State, Event>["dispatch"],
  ) { }

  createStack(): [MiddlewareStack<Event>, { assertHasBeenCalled(): void }] {
    return this.createSubstack(this.middlewares[0] ?? null, this.middlewares.slice(1));
  }

  protected createSubstack(
    current: EventMiddleware<State, Event>,
    remaining: EventMiddleware<State, Event>[],
  ): [MiddlewareStack<Event>, { assertHasBeenCalled(): void }] {
    const next = remaining[0] ?? null;
    let hasBeenCalled = false;

    const controller = {
      assertHasBeenCalled: () => {
        if (!hasBeenCalled) {
          throw new Error(`Middleware "${current.name}" did not call next() or skip()`);
        }
      },
    };

    const stack: MiddlewareStack<Event> = {
      dispatch: async (event) => {
        const [_newState, execution] = this.dispatch(event);
        await execution;
      },
      next: async (event) => {
        hasBeenCalled = true;

        if (!next) {
          return;
        }

        const [substack, subcontroller] = this.createSubstack(next, remaining.slice(1));
        await next(event, substack, this.getState);

        subcontroller.assertHasBeenCalled();
      },
      skip: () => {
        hasBeenCalled = true;
      },
    };

    return [stack, controller];
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
