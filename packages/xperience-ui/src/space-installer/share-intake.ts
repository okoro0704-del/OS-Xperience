/**
 * SP3 share intake. A `.space` file shared to OS Xperience (Web Share Target, where the browser
 * supports it) is received by the service worker, which keeps it in this one-slot inbox and opens
 * `/?ox-share=space`. The app takes it exactly once; it is then identified by content like any import.
 * Nothing is trusted because of how it arrived.
 */
export const SHARE_INBOX_DB = "digiconomy-space-inbox";
export const SHARE_PARAM = "ox-share";
const STORE = "inbox";
const KEY = "shared";
/** A shared file is offered for this long; older ones are discarded unread. */
const MAX_AGE_MS = 10 * 60 * 1000;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SHARE_INBOX_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function takeSharedSpaceFile(location: Location = window.location): Promise<{ name: string; bytes: Uint8Array } | null> {
  const url = new URL(location.href);
  if (url.searchParams.get(SHARE_PARAM) !== "space" || typeof indexedDB === "undefined") return null;
  url.searchParams.delete(SHARE_PARAM);
  history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  const db = await open();
  try {
    const row = await new Promise<{ name: string; file: Blob; at: number } | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const request = store.get(KEY);
      request.onsuccess = () => { store.delete(KEY); resolve(request.result); };
      request.onerror = () => reject(request.error);
    });
    if (!row || Date.now() - row.at > MAX_AGE_MS) return null;
    return { name: row.name, bytes: new Uint8Array(await row.file.arrayBuffer()) };
  } finally {
    db.close();
  }
}
