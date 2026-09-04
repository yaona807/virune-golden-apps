export class Pipeline {
  constructor(config) {
    this.config = config;
    this.slot = {
      value: config.initial,
      join(suffix) {
        return `${this.value}${suffix}`;
      },
    };
  }

  run() {
    return this.config.transform(this.slot.value);
  }
}

export function select(config) {
  return config.kind === 'typed' ? config.transform(config.value) : config.value;
}

export function foreignValue() {
  return { opaque: true };
}

export function pass(value) {
  return value;
}
