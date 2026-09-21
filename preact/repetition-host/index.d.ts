import type { JSX } from 'preact';

export interface RepetitionEntry<T> {
  readonly id: string;
  readonly index: number;
  readonly value: T;
}

export declare function render<T>(
  readSnapshot: () => readonly RepetitionEntry<T>[],
  renderGroup: (
    readValue: () => T,
    readIndex: () => number,
    id: string,
  ) => JSX.Element,
): JSX.Element;
