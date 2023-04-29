import * as path from "https://deno.land/std@0.184.0/path/mod.ts";
import { fail } from "https://deno.land/std@0.184.0/testing/asserts.ts";
import {
  ChatHistory,
  FileSystem as FileSystemT,
  PermissionsManager as PermissionsManagerT,
  PluginContext as PluginContextT,
  PluginInstance,
  PluginSet as PluginSetT,
  RuntimeImplementation,
  SecretsStore as SecretsStoreT,
  TagImplementation,
} from "../plugins.d.ts";

const Allow = Symbol("Allow");
const Deny = Symbol("Deny");
const NotApplicable = Symbol("NotApplicable");

export class FileSystem implements FileSystemT {
  constructor(
    private permissions: PermissionsManagerT,
  ) {}

  mkdir: typeof Deno.mkdir = (path, options) => {
    this.permissions.assertPermission("filesystem", path, "write");
    return Deno.mkdir(path, options);
  }
  readDir: typeof Deno.readDir = (path) => {
    this.permissions.assertPermission("filesystem", path, "write");
    return Deno.readDir(path);
  }
  readTextFile: typeof Deno.readTextFile = (path, options) => {
    this.permissions.assertPermission("filesystem", path, "read");
    return Deno.readTextFile(path, options);
  }
  remove: typeof Deno.remove = (path, options) => {
    this.permissions.assertPermission("filesystem", path, "write");
    return Deno.remove(path, options);
  }
  rename: typeof Deno.rename = (oldpath, newpath) => {
    this.permissions.assertPermission("filesystem", oldpath, "write");
    this.permissions.assertPermission("filesystem", newpath, "write");
    return Deno.rename(oldpath, newpath);
  }
  stat: typeof Deno.stat = (path) => {
    this.permissions.assertPermission("filesystem", path, "read");
    return Deno.stat(path);
  }
  symlink: typeof Deno.symlink = (oldpath, newpath, options) => {
    this.permissions.assertPermission("filesystem", oldpath, "read");
    this.permissions.assertPermission("filesystem", newpath, "write");
    return Deno.symlink(oldpath, newpath, options);
  }
  writeTextFile: typeof Deno.writeTextFile = (path, data, options) => {
    this.permissions.assertPermission("filesystem", path, "write");
    return Deno.writeTextFile(path, data, options);
  }
}

export type AccessControlList = AccessControlListEntry[];

export interface AccessControlListEntry {
  resource: ["filesystem", string];
  permissions: ("read" | "write")[];
}

export class PermissionsManager implements PermissionsManagerT {
  private acls = {
    filesystem: new Map<string, Set<AccessControlListEntry["permissions"][number]>>(),
  };

  private validators = {
    filesystem: (aclEntry: [string, Set<"read" | "write">], requested: string, access?: "read" | "write"): typeof Allow | typeof Deny | typeof NotApplicable => {
      const canonicalPath = path.normalize(requested);
      const regex = path.globToRegExp(aclEntry[0]);
      if (!regex.exec(canonicalPath)) {
        return NotApplicable;
      }
      if (access) {
        return aclEntry[1].has(access) ? Allow : NotApplicable;
      }
      return aclEntry[1].has("read") && aclEntry[1].has("write") ? Allow : Deny;
    },
  };

  constructor(
    acl: AccessControlList,
  ) {
    for (const entry of acl) {
      const [resourceType, path] = entry.resource;
      if (!this.acls[resourceType]) {
        this.acls[resourceType] = new Map();
      }
      if (!this.acls[resourceType].has(path)) {
        this.acls[resourceType].set(path, new Set());
      }
      for (const permission of entry.permissions) {
        this.acls[resourceType].get(path)!.add(permission);
      }
    }
  }

  assertPermission(resourceType: "filesystem", path: string | URL, access?: "read" | "write") {
    if (!this.isPermitted(resourceType, path, access)) {
      return fail(`Permission denied: ${resourceType}:${path}` + (access ? `:${access}` : ""));
    }
  }

  isPermitted(resourceType: "filesystem", requested: string | URL, access?: "read" | "write"): boolean {
    if (!this.acls[resourceType]) {
      return false;
    }
    const validate = this.validators[resourceType] || fail(`No validator for resource type: ${resourceType}`);
    const pathString = requested instanceof URL ? path.fromFileUrl(requested) : requested;

    for (const aclEntry of this.acls[resourceType]) {
      const result = validate(aclEntry, pathString, access);
      if (result === NotApplicable) continue;
      return result === Allow;
    }
    return false;
  }
}

export class SecretsStore implements SecretsStoreT {
  #secrets = new Map<string, string>();

  // deno-lint-ignore require-await
  async exists(secretName: string): Promise<boolean> {
    return this.#secrets.has(secretName);
  }

  // deno-lint-ignore require-await
  async read(secretName: string): Promise<string> {
    return this.#secrets.get(secretName) || fail(`Secret not found: ${secretName}`);
  }

  // deno-lint-ignore require-await
  async store(secretName: string, secretValue: string): Promise<void> {
    this.#secrets.set(secretName, secretValue);
  }
}

export class PluginContext implements PluginContextT {
  filesystem: FileSystem;
  permissions: PermissionsManager;

  constructor(
    public readonly enabledPlugins: PluginSetT,
    public readonly chatHistory: ChatHistory,
    allowlist: AccessControlList,
  ) {
    this.permissions = new PermissionsManager(allowlist);
    this.filesystem = new FileSystem(this.permissions);
  }

  chatConfig = new Map<string,string>();
  secrets = new SecretsStore();
}

export class PluginSet implements PluginSetT {
  runtimes = new Map<string, RuntimeImplementation>();
  tags = new Map<string, TagImplementation>();

  constructor(
    public readonly plugins: PluginInstance[],
  ) {
    for (const plugin of plugins) {
      for (const [name, runtime] of Object.entries(plugin.runtimes || {})) {
        this.runtimes.set(name, runtime);
      }
      for (const [name, tag] of Object.entries(plugin.tags || {})) {
        this.tags.set(name, tag);
      }
    }
  }
}
