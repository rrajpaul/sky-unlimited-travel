import { useEffect, useRef, useState, Component } from 'react';

const tabs = [
  { id: 'flights', label: '✈ Flights' },
  { id: 'hotels', label: '🏨 Hotels' },
];

const WIDGETS = {
  flights: {
    scriptSrc: 'https://tp.media/content?currency=usd&trs=386781&shmarker=741464&show_hotels=false&powered_by=true&locale=en&searchUrl=www.aviasales.com%2Fsearch&primary=%231a2947&color_button=%23ffffff&color_button_text=%231a2947&color_border=%231a2947&border_radius=8&plain=true&no_labels=&widget=aviasales&campaign_id=100',
    containerId: 'tp-flights-widget',
  },
  hotels: {
    scriptSrc: 'https://tp.media/content?currency=usd&trs=386781&shmarker=741464&show_hotels=true&show_flights=false&powered_by=true&locale=en&searchUrl=hotellook.com%2F&primary=%231a2947&color_button=%23ffffff&color_button_text=%231a2947&color_border=%231a2947&border_radius=8&plain=true&widget=hotellook&campaign_id=101',
    containerId: 'tp-hotels-widget',
  },
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
          <p className="text-xs mt-1">Try refreshing or disabling your ad blocker.</p>
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
    container.innerHTML = '';

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
        <span className="text-2xl mb-2">🚫</span>
        <p>Widget blocked by your browser or ad blocker.</p>
        <p className="text-xs mt-1">Disable it to search flights and hotels here.</p>
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
            {active === 'hotels' && <TravelWidget key="hotels" type="hotels" />}
          </WidgetErrorBoundary>
        </div>

        <p className="text-center text-white/30 text-xs mt-4">
          Powered by Travelpayouts
        </p>
      </div>
    </section>
  );
}