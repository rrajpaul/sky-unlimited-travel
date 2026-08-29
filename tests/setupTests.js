import '@testing-library/jest-dom';

// jsdom implements neither IntersectionObserver nor ResizeObserver, and both
// are used by components under test:
//   - IntersectionObserver: framer-motion's `whileInView` (BookingProcessModal's
//     steps list), and ContactsTable tracking whether the pagination bar is
//     scrolled into view.
//   - ResizeObserver: ContactsTable measuring the pagination bar's height so
//     the mobile floating add-button can sit above it. Note this one only
//     bites once that bar actually renders (more than one page of contacts),
//     so a test with a short fixture won't hit it — easy to miss until a
//     fixture crosses pageSize.
//
// Both share the same three-method interface, and neither needs to actually
// fire callbacks or report real sizes here: nothing asserts on scroll-driven
// state or measured height, only that rendering doesn't throw.
for (const name of ['IntersectionObserver', 'ResizeObserver']) {
  if (typeof globalThis[name] === 'undefined') {
    globalThis[name] = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
}

// --- act(...) warning filter -------------------------------------------
//
// React 18 + @testing-library/user-event emit "An update to X inside a test
// was not wrapped in act(...)" for updates that are already settled by the
// time assertions run. In this suite the warning floats between tests run to
// run rather than pointing at a specific one, which is the signature of a
// false positive rather than a real ordering bug: chasing it test-by-test
// just moves it elsewhere.
//
// TRADE-OFF, worth understanding before keeping this: it hides GENUINE act
// warnings too. Those show up as flaky or wrong-looking assertions rather
// than clean failures, so if a test starts behaving oddly, comment this out
// first and read the warnings before debugging anything else.
//
// Only this one message is filtered; every other console.error passes
// through untouched.
const originalConsoleError = console.error;
console.error = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('not wrapped in act')) return;
  originalConsoleError(...args);
};