/**
 * Applies a side-effect-free event to a state, returning the new state.
 * Always synchronous to avoid race conditions. Use a middleware if you need
 * to perform async operations.
 */
export interface StateReducer<State, Event> {
  (state: State, event: Event): State;
}

export interface MiddlewareStack<Event> {
  /** Dispatch a new secondary event and run it through all middlewares */
  dispatch(event: Event): Promise<void>;

  /** Proceed to run subsequent middlewares on an event */
  next(event: Event): Promise<void>;

  /**
   * Call skip() if you don't want an event to be handled by subsequent middlewares.
   * Allows you to pass down a modified event to the next middleware.
   *
   * Not calling either next() or skip() will result in an error
   * (to avoid unintentionally not calling next()).
   */
  skip(): void;
}

/**
 * Processes an event, potentially creating new events for results, side effects, etc.
 */
export interface EventMiddleware<State, EventIn, EventOut = EventIn> {
  (
    event: EventIn,
    stack: MiddlewareStack<EventIn | EventOut>,
    getState: () => State,
  ): Promise<void>;
}

export type UnsubscribeFn = () => void;

export interface StateStore<State, Event> {
  /** Dispatch an event, run it through middlewares, update state */
  dispatch(event: Event): Promise<State>;

  /** Returns the current state */
  getState(): State;

  /** Subscribe to state changes */
  subscribe(listener: (state: State, event: Event) => void): UnsubscribeFn;
}

export interface ExtendableStateStore<State, Event> extends StateStore<State, Event> {
  /** Register a new middleware to handle events */
  registerMiddlewares(...middlewares: EventMiddleware<State, Event>[]): void;

  /** Register a new reducer to handle events */
  registerReducers(...reducers: StateReducer<State, Event>[]): void;
}
