import { ensureDir } from "std/fs/mod.ts";
import { PluginInstance, SessionController } from "../types/plugins.d.ts";
import { FeatureRegistry, RegistryNamespace as RegistryNamespaceT, Session, SessionControllerID, SessionID } from "../types/session.d.ts";

export class Runtime {
  constructor(
    public readonly plugins: PluginInstance[],
    public readonly features: FeatureRegistry,
    private sessionStorage: SessionStorage,
  ) {}

  // deno-lint-ignore ban-types
  async createSession<C extends {} = Record<string, unknown>>(
    controllerID: SessionControllerID,
    config?: C,
  ): Promise<Session<C>> {
    const id = crypto.randomUUID() as SessionID;
    const controller = this.features.controllers.get(controllerID) as SessionController<Session<C>>;
    const session = await controller.createSession(id, config ?? {} as C, this.features);
    await this.sessionStorage.store(session);
    return session;
  }

  loadSession(id: SessionID): Promise<Session> {
    return this.sessionStorage.load(id);
  }

  async latestSessionID(): Promise<SessionID | null> {
    const sessionIDs = await this.sessionStorage.list();
    return sessionIDs[sessionIDs.length - 1] ?? null;
  }
}

export function loadRuntime(plugins: PluginInstance[], sessionsRootPath: string) {
  const features: FeatureRegistry = {
    controllers: BasicRegistryNamespace.fromPlugins("session controller", plugins, (plugin: PluginInstance) => plugin.controllers),
    models: BasicRegistryNamespace.fromPlugins("model", plugins, (plugin: PluginInstance) => plugin.models),
    tools: BasicRegistryNamespace.fromPlugins("tool", plugins, (plugin: PluginInstance) => plugin.tools),
  };
  const sessionStorage = new SessionStorage(sessionsRootPath, features);
  return new Runtime(plugins, features, sessionStorage);
}

class SessionStorage {
  constructor(
    public readonly path: string,
    private features: FeatureRegistry,
  ) {}

  async list(): Promise<SessionID[]> {
    const sessionIDs: SessionID[] = [];
    for await (const dirEntry of Deno.readDir(this.path)) {
      if (dirEntry.isDirectory && !dirEntry.name.match(/^[\._]/)) {
        sessionIDs.push(dirEntry.name as SessionID);
      }
    }
    return sessionIDs;
  }

  async load(id: SessionID): Promise<Session> {
    let metadata: { id: SessionID; config: Record<string, unknown>; controller: SessionControllerID };
    const sessionPath = `${this.path}/${id}`;
    const metadataPath = `${sessionPath}/meta.json`;

    try {
      metadata = JSON.parse(await Deno.readTextFile(metadataPath));
    } catch (err) {
      throw new Error(`Failed to load session metadata from ${metadataPath}: ${err.message}`);
    }

    const controller = this.features.controllers.get(metadata.controller);
    const serialized = await Deno.readTextFile(`${sessionPath}/session.json`);
    const session = controller.deserializeSession(serialized, this.features);
    return session;
  }

  async store(session: Session): Promise<void> {
    const sessionPath = `${this.path}/${session.id}`;
    await ensureDir(sessionPath);

    const metadata = JSON.stringify({
      id: session.id,
      config: session.context.config,
      controller: session.controller.id,
    });
    const serialized = await session.controller.serializeSession(session);

    await Promise.all([
      Deno.writeTextFile(`${sessionPath}/meta.json`, metadata),
      Deno.writeTextFile(`${sessionPath}/session.json`, serialized),
    ]);
  }
}

export class BasicRegistryNamespace<T> implements RegistryNamespaceT<T> {
  constructor(
    private subject: string,
    private items: Map<string, T>,
  ) {}

  static fromPlugins<T>(
    subject: string,
    plugins: PluginInstance[],
    getAll: (plugin: PluginInstance) => Map<string, T>,
  ): BasicRegistryNamespace<T> {
    const map = new Map<string, T>();
    for (const plugin of plugins) {
      for (const [name, item] of getAll(plugin)) {
        if (map.has(name)) {
          throw new Error(`Duplicate ${subject} name: ${name}`);
        }
        map.set(name, item);
      }
    }
    return new BasicRegistryNamespace(subject, map);
  }

  get(name: string): T {
    const item = this.items.get(name);
    if (!item) {
      throw new Error(`Unknown ${this.subject}: ${name}`);
    }
    return item;
  }

  has(name: string): boolean {
    return this.items.has(name);
  }

  keys(): IterableIterator<string> {
    return this.items.keys();
  }
}
