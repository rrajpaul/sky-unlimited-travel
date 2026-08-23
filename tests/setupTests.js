// Location: tests/setupTests.js
import '@testing-library/jest-dom';

// jsdom doesn't implement IntersectionObserver. BookingProcessModal's real
// framer-motion usage includes `whileInView` on the steps list, which
// depends on it. This minimal stub is enough to satisfy framer-motion's
// internal check — it doesn't need to actually fire callbacks correctly for
// the test's purposes, since we're not asserting on scroll-triggered state.
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class IntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}