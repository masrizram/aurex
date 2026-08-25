// Test setup jsdom untuk dashboard UI regression tests.
import "@testing-library/jest-dom/vitest";

// Polyfill matchMedia (tidak ada di jsdom) — dipakai ThemeProvider
// (prefers-color-scheme) dan komponen Radix UI.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// ResizeObserver dipakai sidebar Radix (ScrollArea).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

// getComputedStyle feature-detection Radix.
Object.defineProperty(Element.prototype, "scrollIntoView", {
  writable: true,
  value: () => {},
});
