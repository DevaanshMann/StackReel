export const FileMode = { ReadOnly: "r" };

export const storage = {
  document: "file:///Documents",
  files: new Map<string, string>(),
  directories: new Set<string>(),
  interruptMove: false,
  blockedDeletion: "",
  blockedListing: "",
  blockedRead: "",
  nextMedia: 0,
};

class Entry {
  uri: string;

  constructor(origin: string | Entry, ...parts: string[]) {
    this.uri = [typeof origin === "string" ? origin : origin.uri, ...parts].join("/");
  }

  get name() {
    return this.uri.slice(this.uri.lastIndexOf("/") + 1);
  }

  get parentDirectory(): Directory {
    return new Directory(this.uri.slice(0, this.uri.lastIndexOf("/")));
  }
}

export class File extends Entry {
  get exists() {
    return storage.files.has(this.uri);
  }

  delete() {
    if (this.uri === storage.blockedDeletion) throw new Error("Couldn’t delete file");
    storage.files.delete(this.uri);
  }

  textSync() {
    if (this.uri === storage.blockedRead) throw new Error("Cannot read file");
    const text = storage.files.get(this.uri);
    if (text === undefined) throw new Error("File is missing");
    return text;
  }

  writeSync(data: string) {
    if (!this.parentDirectory.exists) throw new Error("Parent directory is missing");
    storage.files.set(this.uri, data);
  }

  async move(destination: File) {
    this.moveSync(destination);
  }

  get size() {
    return storage.files.get(this.uri)?.length ?? 0;
  }

  open(mode: string) {
    if (mode !== FileMode.ReadOnly || !this.exists || this.uri === storage.blockedRead)
      throw new Error("Cannot open file");
    return { size: this.size, close() {} };
  }

  async copy(destination: File) {
    destination.writeSync(this.textSync());
  }

  moveSync(destination: File) {
    if (storage.interruptMove) throw new Error("Interrupted write");
    if (destination.exists) throw new Error("Destination already exists");
    destination.writeSync(this.textSync());
    this.delete();
    this.uri = destination.uri;
  }
}

export class Directory extends Entry {
  get exists() {
    return storage.directories.has(this.uri);
  }

  create({ intermediates = false, idempotent = false } = {}) {
    if (storage.files.has(this.uri)) throw new Error("A file already exists at this path");
    if (this.exists) {
      if (!idempotent) throw new Error("Directory already exists");
      return;
    }
    if (!this.parentDirectory.exists) {
      if (!intermediates) throw new Error("Parent directory is missing");
      this.parentDirectory.create({ intermediates, idempotent });
    }
    storage.directories.add(this.uri);
  }

  list() {
    if (!this.exists || this.uri === storage.blockedListing) throw new Error("Cannot list directory");
    const isChild = (uri: string) => uri.slice(0, uri.lastIndexOf("/")) === this.uri;
    return [
      ...[...storage.directories].filter(isChild).map((uri) => new Directory(uri)),
      ...[...storage.files.keys()].filter(isChild).map((uri) => new File(uri)),
    ];
  }

  delete() {
    for (const entry of this.list()) entry.delete();
    storage.directories.delete(this.uri);
  }
}

export const Paths = {
  cache: new Directory("file:///Caches"),
  get document() {
    return new Directory(storage.document);
  },
};
