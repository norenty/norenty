import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));

const { debounce, DEBOUNCE_REALTIME_MS } = await import("./realtime");

// Ítem 9.33: una ráfaga de eventos de realtime (varios hitos completándose seguidos)
// no debe relanzar el callback una vez por evento -- debe coalescerse en una sola
// llamada tras la ráfaga, para no disparar N veces el abanico de cálculos OSRM.
describe("debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesce varias llamadas seguidas en una sola, tras la ventana de espera", () => {
    const fn = vi.fn();
    const d = debounce(fn, DEBOUNCE_REALTIME_MS);

    d();
    d();
    d();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(DEBOUNCE_REALTIME_MS);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("cada llamada reinicia el temporizador (no dispara si sigue llegando actividad)", () => {
    const fn = vi.fn();
    const d = debounce(fn, DEBOUNCE_REALTIME_MS);

    d();
    vi.advanceTimersByTime(DEBOUNCE_REALTIME_MS - 100);
    d(); // llega justo antes de que expirase -- reinicia
    vi.advanceTimersByTime(DEBOUNCE_REALTIME_MS - 100);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("cancel() impide que se ejecute una llamada pendiente", () => {
    const fn = vi.fn();
    const d = debounce(fn, DEBOUNCE_REALTIME_MS);

    d();
    d.cancel();
    vi.advanceTimersByTime(DEBOUNCE_REALTIME_MS * 2);
    expect(fn).not.toHaveBeenCalled();
  });

  it("tras dispararse una vez, una llamada posterior programa una ejecución nueva", () => {
    const fn = vi.fn();
    const d = debounce(fn, DEBOUNCE_REALTIME_MS);

    d();
    vi.advanceTimersByTime(DEBOUNCE_REALTIME_MS);
    expect(fn).toHaveBeenCalledTimes(1);

    d();
    vi.advanceTimersByTime(DEBOUNCE_REALTIME_MS);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
