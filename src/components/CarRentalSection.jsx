import { useEffect, useRef, useState, Component } from 'react';

const RENTALCARS_LINK = 'https://www.rentalcars.com/';

const CAR_WIDGET = {
  scriptSrc:
    'https://tpwdg.com/content?campaign_id=10&promo_id=4480&color_button_text=%23ffffff&color_input_text=%23000000&color_text=%23000000&color_button=%2355a539&color_background=%23ffca28&show_logo=true&plain=true&border_radius=5&powered_by=true&locale=en&shmarker=741464&trs=543823',
  containerId: 'tp-car-rental-widget',
};

// Error Boundary to catch unexpected widget script crashes
class CarWidgetErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error('CarRentalWidget error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-10 text-gray-400 text-sm">
          <span className="text-2xl mb-2">🚗</span>
          <p>Car search unavailable right now.</p>
          <a
            href={RENTALCARS_LINK}
            target="_blank"
            rel="noopener noreferrer sponsored"
            className="mt-3 text-xs font-semibold text-[#1a2947] underline underline-offset-2 hover:text-[#2c426e]"
          >
            Search car rentals instead
          </a>
        </div>
      );
    }
    return this.props.children;
  }
}

function CarRentalWidget() {
  const containerRef = useRef(null);
  const [blocked, setBlocked] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(false);
  const { scriptSrc, containerId } = CAR_WIDGET;

  // Same deferred-load strategy as the flights widget: let the page's own
  // critical resources finish first, then load this third-party script so
  // it doesn't compete for bandwidth/main-thread during initial render.
  useEffect(() => {
    let idleHandle;
    let timeoutHandle;

    const triggerLoad = () => setShouldLoad(true);

    const scheduleLoad = () => {
      if ('requestIdleCallback' in window) {
        idleHandle = window.requestIdleCallback(triggerLoad, { timeout: 2000 });
      } else {
        timeoutHandle = setTimeout(triggerLoad, 1500);
      }
    };

    if (document.readyState === 'complete') {
      scheduleLoad();
    } else {
      window.addEventListener('load', scheduleLoad, { once: true });
    }

    return () => {
      window.removeEventListener('load', scheduleLoad);
      if (idleHandle && 'cancelIdleCallback' in window) window.cancelIdleCallback(idleHandle);
      if (timeoutHandle) clearTimeout(timeoutHandle);
    };
  }, []);

  useEffect(() => {
    if (!shouldLoad) return;

    const container = containerRef.current;
    if (!container) return;

    container.replaceChildren();

    const script = document.createElement('script');
    script.src = scriptSrc;
    script.async = true;
    script.charset = 'utf-8';

    script.onerror = () => setBlocked(true);

    container.appendChild(script);

    return () => {
      container.innerHTML = '';
    };
  }, [shouldLoad, scriptSrc]);

  if (blocked) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-gray-400 text-sm">
        <span className="text-2xl mb-2">🚗</span>
        <p>Car search unavailable right now.</p>
        <a
          href={RENTALCARS_LINK}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="mt-3 text-xs font-semibold text-[#1a2947] underline"
        >
          Search car rentals instead
        </a>
      </div>
    );
  }

  return (
    <div className="w-full min-h-[120px]">
      {shouldLoad ? (
        <div ref={containerRef} id={containerId} className="w-full min-h-[120px]" />
      ) : (
        <div className="w-full min-h-[120px] flex items-center justify-center text-gray-300 text-sm animate-pulse">
          Loading car rental search…
        </div>
      )}
    </div>
  );
}

export default function CarRentalSection() {
  return (
    <section className="bg-white py-16 px-4 border-t border-slate-100">
      <div className="max-w-4xl mx-auto">
        {/* Heading */}
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold text-[#1a2947] tracking-tight">
            🚗 Economy Car Rentals
          </h2>
          <p className="mt-2 text-slate-500 text-sm">
            Compare deals on affordable rides for your trip
          </p>
        </div>

        {/* Widget container wrapped in Error Boundary */}
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden p-4 min-h-[160px] ring-1 ring-slate-100">
          <CarWidgetErrorBoundary>
            <CarRentalWidget />
          </CarWidgetErrorBoundary>
        </div>

        <p className="text-center text-slate-300 text-xs mt-4">
          Powered by{' '}
          <a
            href={RENTALCARS_LINK}
            target="_blank"
            rel="noopener noreferrer sponsored"
            className="underline underline-offset-2 hover:text-slate-400 transition-colors"
          >
            Travelpayouts
          </a>
        </p>
      </div>
    </section>
  );
}