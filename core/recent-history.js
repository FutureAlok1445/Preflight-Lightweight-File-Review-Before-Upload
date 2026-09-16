/**
 * core/recent-history.js
 * Session-scoped lightweight history manager for Preflight operations.
 * Stores up to 20 metadata-only entries in chrome.storage.session.
 * Never stores large binary objects.
 */
(function (global) {
  "use strict";

  const Preflight = global.Preflight || (global.Preflight = {});
  const STORAGE_KEY = "preflight:recentHistory";
  const MAX_ENTRIES = 20;

  async function getStorage() {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.session) {
      return chrome.storage.session;
    }
    // In-memory fallback if session storage is unavailable
    if (!global.__preflightSessionHistoryFallback) {
      global.__preflightSessionHistoryFallback = [];
    }
    return null;
  }

  /**
   * Adds an entry to recent history.
   * entry: { filename, format, originalSize, outputSize, savedPercent, status }
   */
  async function addEntry(entry) {
    if (!entry) return;
    try {
      const storage = await getStorage();
      let list = [];

      if (storage) {
        const stored = await storage.get(STORAGE_KEY);
        list = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
      } else {
        list = global.__preflightSessionHistoryFallback || [];
      }

      const rawName = String(entry.filename || "file");
      const truncatedName = rawName.length > 60 ? rawName.slice(0, 57) + "…" : rawName;

      const newEntry = {
        id: Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        filename: truncatedName,
        format: entry.format || "unknown",
        originalSize: Number(entry.originalSize) || 0,
        outputSize: Number(entry.outputSize) || 0,
        savedPercent: typeof entry.savedPercent === "number" ? entry.savedPercent.toFixed(1) : "0.0",
        timestamp: new Date().toISOString(),
        status: entry.status === "Failed" ? "Failed" : "Success"
      };

      list.unshift(newEntry);
      if (list.length > MAX_ENTRIES) {
        list = list.slice(0, MAX_ENTRIES);
      }

      if (storage) {
        await storage.set({ [STORAGE_KEY]: list });
      } else {
        global.__preflightSessionHistoryFallback = list;
      }
      return newEntry;
    } catch (err) {
      console.warn("Could not save recent history entry:", err);
      return null;
    }
  }

  async function getAll() {
    try {
      const storage = await getStorage();
      if (storage) {
        const stored = await storage.get(STORAGE_KEY);
        return Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
      }
      return global.__preflightSessionHistoryFallback || [];
    } catch (err) {
      console.warn("Could not read recent history:", err);
      return [];
    }
  }

  async function clearAll() {
    try {
      const storage = await getStorage();
      if (storage) {
        await storage.set({ [STORAGE_KEY]: [] });
      } else {
        global.__preflightSessionHistoryFallback = [];
      }
      return true;
    } catch (err) {
      console.warn("Could not clear recent history:", err);
      return false;
    }
  }

  Preflight.recentHistory = {
    addEntry,
    getAll,
    clearAll,
    MAX_ENTRIES
  };
})(typeof window !== "undefined" ? window : globalThis);
