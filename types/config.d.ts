export interface Configurable<T, C extends ConfigTemplate = ConfigTemplate> {
  readonly template: C;
  instantiate(config: ConfigTypeFromTemplate<C>): Promise<T> | T;
}

export interface ConfigTemplate {
  [key: string]: ConfigItemTemplate;
}

///////////////////////////
// Config template schema:

// deno-lint-ignore ban-types
type ConfigItemDef<T, D extends {}> = {
  template: D;
  value: T;
};

interface ConfigItemTemplates {
  "id": ConfigItemDef<string, {
    references: string;
  }>;
  "options": ConfigItemDef<string, {
    options: string[];
  }>;
}

export type ConfigItemType = keyof ConfigItemTemplates;

export type ConfigItemTemplate<T extends ConfigItemType = ConfigItemType> =
  { type: T, optional?: boolean } & ConfigItemTemplates[T]["template"];

export type ConfigTypeFromTemplate<C extends ConfigTemplate> = {
  [K in keyof C]: C[K] extends ConfigItemTemplate<infer T>
    ? ConfigTypeFromItemTemplate<T>
    : never;
}

export type ConfigTypeFromItemTemplate<T extends ConfigItemType> = ConfigItemTemplates[T] extends ConfigItemTemplate<infer T>
  ? ConfigItemTemplates[T]["value"]
  : never;
