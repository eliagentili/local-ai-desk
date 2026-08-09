// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The updater installs itself: it checks 15 s after launch, then every six hours,
 * and replaces the running application. The behaviours pinned here are the ones
 * whose failure the user pays for.
 *
 * - a rejected signature must stop the install and say so, never fall through;
 * - a download that finishes while jobs are running must wait, because
 *   relaunching mid-job loses the work in flight;
 * - `check()` must not re-enter, or the periodic timer stacks checks on top of a
 *   download in progress.
 */

const check = vi.fn();
const relaunch = vi.fn();
const getVersion = vi.fn(async () => "1.0.0");

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => getVersion() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: (options?: unknown) => check(options) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: () => relaunch() }));

const { useAppUpdater } = await import("../src/hooks/useAppUpdater");

interface FakeUpdate {
  version: string;
  currentVersion: string;
  body: string | null;
  date: string | null;
  download: ReturnType<typeof vi.fn>;
  install: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function fakeUpdate(overrides: Partial<FakeUpdate> = {}): FakeUpdate {
  return {
    version: "1.1.0",
    currentVersion: "1.0.0",
    body: "Note",
    date: "2026-08-09",
    download: vi.fn(async (onEvent?: (event: unknown) => void) => {
      onEvent?.({ event: "Started", data: { contentLength: 2_048 } });
      onEvent?.({ event: "Progress", data: { chunkLength: 2_048 } });
      onEvent?.({ event: "Finished", data: {} });
    }),
    install: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    ...overrides,
  };
}

beforeEach(() => {
  check.mockReset();
  relaunch.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("useAppUpdater", () => {
  it("blocca l'installazione quando la firma non è valida e lo dice all'utente", async () => {
    const update = fakeUpdate({
      download: vi.fn(async () => {
        throw new Error("Failed to verify the signature of the update archive");
      }),
    });
    check.mockResolvedValue(update);

    const { result } = renderHook(() => useAppUpdater(false));
    await act(async () => {
      await result.current.checkForUpdates();
    });
    expect(result.current.phase).toBe("available");

    await act(async () => {
      await result.current.downloadAndInstall();
    });

    expect(result.current.phase).toBe("error");
    expect(result.current.error).toMatch(/firma/i);
    expect(update.install).not.toHaveBeenCalled();
  });

  it("con lavori in corso scarica ma non installa", async () => {
    const update = fakeUpdate();
    check.mockResolvedValue(update);

    const { result } = renderHook(() => useAppUpdater(true));
    await act(async () => {
      await result.current.checkForUpdates();
    });
    await act(async () => {
      await result.current.downloadAndInstall();
    });

    expect(update.download).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("downloaded");
    expect(update.install).not.toHaveBeenCalled();
    // The bytes still have to be reported, otherwise the panel shows a stalled
    // bar next to a "downloaded" label.
    expect(result.current.downloadedBytes).toBe(2_048);
    expect(result.current.progress).toBe(100);

    // And the restart must stay refused while the jobs are alive.
    await act(async () => {
      await result.current.restart();
    });
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("installa e riavvia solo quando la coda è libera", async () => {
    const update = fakeUpdate();
    check.mockResolvedValue(update);

    const { result } = renderHook(() => useAppUpdater(false));
    await act(async () => {
      await result.current.checkForUpdates();
    });
    await act(async () => {
      await result.current.downloadAndInstall();
    });

    expect(update.install).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("ready");

    await act(async () => {
      await result.current.restart();
    });
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it("non rientra: due controlli sovrapposti interrogano il canale una volta sola", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    check.mockImplementation(async () => {
      await gate;
      return null;
    });

    const { result } = renderHook(() => useAppUpdater(false));
    await act(async () => {
      const first = result.current.checkForUpdates();
      const second = result.current.checkForUpdates();
      release?.();
      await Promise.all([first, second]);
    });

    expect(check).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("current");
  });

  it("non controlla il canale mentre un download è in corso", async () => {
    let releaseDownload: (() => void) | null = null;
    const download = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        releaseDownload = resolve;
      });
    });
    check.mockResolvedValue(fakeUpdate({ download }));

    const { result } = renderHook(() => useAppUpdater(false));
    await act(async () => {
      await result.current.checkForUpdates();
    });
    expect(check).toHaveBeenCalledTimes(1);

    await act(async () => {
      // The download is still in flight — its promise only settles below — so a
      // periodic check landing here must find the updater busy and give up.
      const installing = result.current.downloadAndInstall();
      await result.current.checkForUpdates();
      expect(check).toHaveBeenCalledTimes(1);
      expect(download).toHaveBeenCalledTimes(1);
      releaseDownload?.();
      await installing;
    });

    expect(check).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("ready");
  });

  it("traduce un canale non raggiungibile senza mostrare il messaggio grezzo", async () => {
    check.mockRejectedValue(new Error("Could not fetch a valid release JSON from the remote"));

    const { result } = renderHook(() => useAppUpdater(false));
    await act(async () => {
      await result.current.checkForUpdates();
    });

    expect(result.current.phase).toBe("error");
    expect(result.current.error).toMatch(/canale aggiornamenti/i);
  });

  it("ricorda la preferenza sui controlli automatici", async () => {
    check.mockResolvedValue(null);
    const { result } = renderHook(() => useAppUpdater(false));

    act(() => {
      result.current.setAutomaticChecks(false);
    });

    expect(result.current.automaticChecks).toBe(false);
    expect(window.localStorage.getItem("local-ai-desk:update-checks-enabled:v1")).toBe("false");
  });
});
