export interface Slot<T> {
  value: T;
  [key: string]: T | ((suffix: string) => string);
  join(suffix: string): string;
}

export declare class Pipeline<T> {
  constructor(config: { initial: T; transform: (value: T) => T });
  readonly slot: Slot<T>;
  run(): T;
}

export declare function select<T>(config: {
  kind: 'typed';
  value: T;
  transform: (value: T) => T;
}): T;
export declare function select(config: {
  kind: 'unknown';
  value: unknown;
}): unknown;

export declare function foreignValue(): unknown;
export declare function pass<T>(value: T): T;
export declare function pass(value: unknown): unknown;
