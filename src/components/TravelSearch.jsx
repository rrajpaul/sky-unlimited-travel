import { useEffect, useRef, useState, Component } from 'react';

const AVIASALES_LINK = 'https://aviasales.tpx.lu/3ribBZKz';

const tabs = [
  { id: 'flights', label: '✈ Flights' },
  //{ id: 'hotels', label: '🏨 Hotels' },
];

const WIDGETS = {
  flights: {
    scriptSrc:
      'https://tpwdg.com/content?currency=usd&campaign_id=100&promo_id=7879&plain=false&border_radius=0&color_focused=%2332a8dd&special=%23C4C4C4&secondary=%23FFFFFF&light=%23FFFFFF&dark=%23262626&color_icons=%2332a8dd&color_button=%2332a8dd&primary_override=%2332a8dd&searchUrl=www.aviasales.com%2Fsearch&locale=en&powered_by=true&show_hotels=true&shmarker=741464&trs=543823',
    containerId: 'tp-flights-widget',
  },
  //hotels: {
  //  scriptSrc:
  //    'https://tpwdg.com/content?currency=usd&promo_id=4497&campaign_id=137&powered_by=true&amount=3&category=4&city_id=2&locale=en&shmarker=741464&trs=543823',
  //  containerId: 'tp-hotels-widget',
  //},
};

// Error Boundary to catch unexpected widget script crashes
class WidgetErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error('TravelWidget error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-10 text-gray-400 text-sm">
          <span className="text-2xl mb-2">✈</span>
          <p>Search unavailable right now.</p>
          <a
            href={AVIASALES_LINK}
            target="_blank"
            rel="noopener noreferrer sponsored"
            className="mt-3 text-xs font-semibold text-[#1a2947] underline underline-offset-2 hover:text-[#2c426e]"
          >
            Search flights on Aviasales instead
          </a>
        </div>
      );
    }
    return this.props.children;
  }
}

function TravelWidget({ type }) {
  const containerRef = useRef(null);
  const [blocked, setBlocked] = useState(false);
  const { scriptSrc, containerId } = WIDGETS[type];

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clear previous widget content + any injected iframes/styles
    container.replaceChildren();

    const script = document.createElement('script');
    script.src = scriptSrc;
    script.async = true;
    script.charset = 'utf-8';

    // Detect if script is blocked (adblocker / strict privacy browser)
    script.onerror = () => setBlocked(true);

    container.appendChild(script);

    return () => {
      // Best-effort cleanup: remove injected content
      container.innerHTML = '';
    };
  }, [scriptSrc]);

  if (blocked) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-gray-400 text-sm">
        <span className="text-2xl mb-2">
          {type === 'hotels' ? '🏨' : '✈'}
        </span>

        <p>
          {type === 'hotels'
            ? 'Hotel search unavailable right now.'
            : 'Flight search unavailable right now.'}
        </p>

        <a
          href={
            type === 'hotels'
              ? 'https://www.hotellook.com/'
              : AVIASALES_LINK
          }
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="mt-3 text-xs font-semibold text-[#1a2947] underline"
        >
          {type === 'hotels'
            ? 'Search hotels instead'
            : 'Search flights on Aviasales instead'}
        </a>
      </div>
    );
  }

  return <div ref={containerRef} id={containerId} className="w-full min-h-[120px]" />;
}

export default function TravelSearch() {
  const [active, setActive] = useState('flights');

  return (
    <section className="bg-[#1a2947] py-16 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Heading */}
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold text-white tracking-tight">
            Search Flights & Hotels
          </h2>
          <p className="mt-2 text-white/60 text-sm">
            Find the best deals for your next adventure
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex justify-center mb-8">
          <div className="inline-flex bg-white/10 rounded-full p-1 gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActive(tab.id)}
                className={`px-6 py-2 rounded-full text-sm font-semibold transition-all duration-200 ${
                  active === tab.id
                    ? 'bg-white text-[#1a2947] shadow'
                    : 'text-white/70 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Widget container wrapped in Error Boundary */}
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden p-4 min-h-[160px]">
          <WidgetErrorBoundary key={active}>
            {active === 'flights' && <TravelWidget key="flights" type="flights" />}
            {/* {active === 'hotels' && <TravelWidget key="hotels" type="hotels" />} */}
          </WidgetErrorBoundary>
        </div>

        <p className="text-center text-white/30 text-xs mt-4">
          Powered by{' '}
          <a
            href={AVIASALES_LINK}
            target="_blank"
            rel="noopener noreferrer sponsored"
            className="underline underline-offset-2 hover:text-white/50 transition-colors"
          >
            Travelpayouts
          </a>
        </p>
      </div>
    </section>
  );
}