import type { PhotoHold, PhotoOutbox } from "@/lib/photo-capture";

const DB_NAME = "adel-field";
const STORE = "photo-outbox";

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available."));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the photo outbox."));
  });
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Photo outbox request failed."));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openDb();
  try {
    const transaction = database.transaction(STORE, mode);
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Photo outbox transaction failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Photo outbox transaction aborted."));
    });
    const value = await requestToPromise(run(transaction.objectStore(STORE)));
    await done;
    return value;
  } finally {
    database.close();
  }
}

export function idbPhotoOutbox(): PhotoOutbox {
  return {
    async list() {
      try {
        const rows = await withStore("readonly", (store) => store.getAll() as IDBRequest<PhotoHold[]>);
        return [...rows].sort((left, right) => left.createdAt - right.createdAt);
      } catch {
        return [];
      }
    },
    async put(record) {
      await withStore("readwrite", (store) => store.put(record));
    },
    async delete(id) {
      try {
        await withStore("readwrite", (store) => store.delete(id));
      } catch {
        // A missing browser store should not block the visit.
      }
    },
  };
}
