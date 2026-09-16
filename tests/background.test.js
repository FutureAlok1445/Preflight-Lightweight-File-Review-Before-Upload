import { describe, it, expect, vi, beforeEach } from "vitest";

describe("Background Service Worker Window Deduplication & Routing", () => {
  let messageListener;
  let onRemovedListener;
  let chromeMock;

  beforeEach(async () => {
    vi.resetModules();

    chromeMock = {
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onMessage: {
          addListener: vi.fn((fn) => {
            messageListener = fn;
          })
        },
        getURL: vi.fn((p) => `chrome-extension://id/${p}`)
      },
      windows: {
        create: vi.fn(),
        get: vi.fn(),
        update: vi.fn(),
        onRemoved: {
          addListener: vi.fn((fn) => {
            onRemovedListener = fn;
          })
        }
      },
      storage: {
        local: { get: vi.fn(), set: vi.fn() },
        session: { get: vi.fn(), set: vi.fn(), remove: vi.fn() }
      },
      tabs: {
        captureVisibleTab: vi.fn(),
        query: vi.fn(),
        sendMessage: vi.fn()
      },
      scripting: {
        executeScript: vi.fn()
      }
    };

    globalThis.chrome = chromeMock;
    await import("../background.js");
  });

  it("reuses existing window when already open (deduplication)", async () => {
    chromeMock.storage.session.get.mockResolvedValue({ "preflight:workspaceWindowId": 42 });
    chromeMock.windows.get.mockResolvedValue({ id: 42 });
    chromeMock.windows.update.mockResolvedValue({ id: 42, focused: true });

    const sendResponse = vi.fn();
    const isAsync = messageListener({ type: "OPEN_OPTIMIZER" }, {}, sendResponse);
    expect(isAsync).toBe(true);

    // Wait for internal async execution
    await new Promise((r) => setTimeout(r, 20));

    expect(chromeMock.windows.update).toHaveBeenCalledWith(42, { focused: true });
    expect(chromeMock.windows.create).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, reused: true });
  });

  it("creates a new popup window when stored ID is stale or window was closed", async () => {
    chromeMock.storage.session.get.mockResolvedValue({ "preflight:workspaceWindowId": 99 });
    chromeMock.windows.get.mockRejectedValue(new Error("Window not found"));
    chromeMock.windows.create.mockResolvedValue({ id: 105 });

    const sendResponse = vi.fn();
    messageListener({ type: "OPEN_OPTIMIZER" }, {}, sendResponse);

    await new Promise((r) => setTimeout(r, 20));

    expect(chromeMock.windows.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "popup",
        width: 960,
        height: 680
      })
    );
    expect(chromeMock.storage.session.set).toHaveBeenCalledWith({ "preflight:workspaceWindowId": 105 });
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, windowId: 105 });
  });

  it("responds with error when windows.create fails", async () => {
    chromeMock.storage.session.get.mockResolvedValue({});
    chromeMock.windows.create.mockRejectedValue(new Error("Creation blocked"));

    const sendResponse = vi.fn();
    messageListener({ type: "OPEN_OPTIMIZER" }, {}, sendResponse);

    await new Promise((r) => setTimeout(r, 20));

    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "Creation blocked" });
  });

  it("cleans up session window ID when workspace window is removed", async () => {
    chromeMock.storage.session.get.mockResolvedValue({ "preflight:workspaceWindowId": 42 });
    await onRemovedListener(42);
    expect(chromeMock.storage.session.remove).toHaveBeenCalledWith("preflight:workspaceWindowId");
  });

  it("rejects unknown message types via allowlist guard", () => {
    const sendResponse = vi.fn();
    const handled = messageListener({ type: "UNKNOWN_TYPE" }, {}, sendResponse);
    expect(handled).toBe(false);
  });
});
