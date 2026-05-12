import { useState, useEffect, useCallback, useRef } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import axios from "axios";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { MapContainer, TileLayer, Polyline, Marker, Popup, Circle } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search,
  Star,
  MapPin,
  Clock,
  ArrowRight,
  Bus,
  Train,
  TramFront,
  Ship,
  RefreshCw,
  Navigation,
  AlertTriangle,
  History,
  LocateFixed,
  X,
  Footprints,
  Bell,
  BellOff,
  Map as MapIcon,
  List,
} from "lucide-react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const TRANSPORT_MODES = [
  { key: "ALL", label: "Alla", icon: null },
  { key: "BUS", label: "Buss", icon: Bus, color: "text-red-400" },
  { key: "METRO", label: "Tunnelbana", icon: Train, color: "text-blue-400" },
  { key: "TRAIN", label: "Pendeltåg", icon: Train, color: "text-green-400" },
  { key: "TRAM", label: "Spårvagn", icon: TramFront, color: "text-yellow-400" },
  { key: "SHIP", label: "Båt", icon: Ship, color: "text-cyan-400" },
];

// Line badge component
const LineBadge = ({ line, mode }) => {
  const modeClass = `line-badge-${mode?.toLowerCase() || "bus"}`;
  return (
    <span className={`line-badge ${modeClass}`} data-testid="line-badge">
      {line}
    </span>
  );
};

// Departure row component
const DepartureRow = ({ departure, stopId, onToggleAlert, isAlerted }) => {
  const hasDeviation = departure.deviations && departure.deviations.length > 0;
  return (
    <div
      className="departure-row flex items-center gap-4 p-4 border-b border-[#262626] hover:bg-[#1A1A1A]"
      data-testid="departure-board-row"
    >
      <LineBadge line={departure.line} mode={departure.transport_mode} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-white font-medium truncate">{departure.destination}</span>
          {hasDeviation && <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0" />}
        </div>
        {hasDeviation && (
          <p className="text-xs text-yellow-400/80 truncate mt-0.5">{departure.deviations[0]}</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        {onToggleAlert && (
          <button
            onClick={() => onToggleAlert(departure.line, departure.destination)}
            className={`p-1 rounded transition-colors ${isAlerted ? "text-yellow-400" : "text-neutral-600 hover:text-neutral-400"}`}
            title={isAlerted ? "Ta bort bevakning" : "Bevaka avgång"}
            data-testid="departure-alert-toggle"
          >
            {isAlerted ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
          </button>
        )}
        <span className="time-display text-2xl sm:text-3xl text-white">{departure.display_time}</span>
      </div>
    </div>
  );
};

// Skeleton loading
const DepartureSkeleton = () => (
  <div className="flex items-center gap-4 p-4 border-b border-[#262626]">
    <div className="skeleton w-12 h-8" />
    <div className="flex-1 space-y-2">
      <div className="skeleton w-3/4 h-4" />
      <div className="skeleton w-1/2 h-3" />
    </div>
    <div className="skeleton w-16 h-8" />
  </div>
);

// Stop name with locality display
const StopName = ({ name, locality, className = "" }) => (
  <span className={`truncate ${className}`}>
    {name}
    {locality && <span className="text-neutral-500 ml-1 text-xs">({locality})</span>}
  </span>
);

// ── Hooks ──────────────────────────────────────────

// Favorites hook
const useFavorites = () => {
  const [favorites, setFavorites] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("sl-favorites") || "[]");
    } catch { return []; }
  });

  const addFavorite = useCallback((stop) => {
    setFavorites((prev) => {
      if (prev.some((f) => f.id === stop.id)) return prev;
      const updated = [...prev, stop];
      localStorage.setItem("sl-favorites", JSON.stringify(updated));
      toast.success(`${stop.name} tillagd i favoriter`);
      return updated;
    });
  }, []);

  const removeFavorite = useCallback((stopId) => {
    setFavorites((prev) => {
      const updated = prev.filter((f) => f.id !== stopId);
      localStorage.setItem("sl-favorites", JSON.stringify(updated));
      toast.info("Borttagen från favoriter");
      return updated;
    });
  }, []);

  const isFavorite = useCallback((stopId) => favorites.some((f) => f.id === stopId), [favorites]);
  return { favorites, addFavorite, removeFavorite, isFavorite };
};

// Recent searches hook
const useRecentSearches = () => {
  const [recents, setRecents] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("sl-recent-searches") || "[]");
    } catch { return []; }
  });

  const addRecent = useCallback((stop) => {
    setRecents((prev) => {
      const filtered = prev.filter((r) => r.id !== stop.id);
      const updated = [stop, ...filtered].slice(0, 8);
      localStorage.setItem("sl-recent-searches", JSON.stringify(updated));
      return updated;
    });
  }, []);

  const clearRecents = useCallback(() => {
    localStorage.removeItem("sl-recent-searches");
    setRecents([]);
  }, []);

  return { recents, addRecent, clearRecents };
};

// Fix Leaflet default icon issue with bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const stopIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

const userIcon = new L.DivIcon({
  html: '<div style="width:16px;height:16px;border-radius:50%;background:#3B82F6;border:3px solid white;box-shadow:0 0 8px rgba(59,130,246,0.6)"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  className: "",
});

// Map recenter component
const RecenterMap = ({ lat, lon }) => {
  const map = useMap();
  useEffect(() => { if (lat && lon) map.setView([lat, lon], 15); }, [lat, lon, map]);
  return null;
};

// Notification hook for departure alerts
const useNotifications = () => {
  const [permission, setPermission] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "denied"
  );
  const [alerts, setAlerts] = useState(() => {
    try { return JSON.parse(localStorage.getItem("sl-alerts") || "[]"); }
    catch { return []; }
  });

  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return "denied";
    const perm = await Notification.requestPermission();
    setPermission(perm);
    return perm;
  }, []);

  const addAlert = useCallback((stopId, stopName, line, destination) => {
    setAlerts((prev) => {
      const key = `${stopId}-${line}-${destination}`;
      if (prev.some((a) => a.key === key)) return prev;
      const updated = [...prev, { key, stopId, stopName, line, destination, createdAt: Date.now() }];
      localStorage.setItem("sl-alerts", JSON.stringify(updated));
      toast.success(`Bevakning på för linje ${line} → ${destination}`);
      return updated;
    });
  }, []);

  const removeAlert = useCallback((key) => {
    setAlerts((prev) => {
      const updated = prev.filter((a) => a.key !== key);
      localStorage.setItem("sl-alerts", JSON.stringify(updated));
      toast.info("Bevakning borttagen");
      return updated;
    });
  }, []);

  const hasAlert = useCallback((stopId, line, destination) => {
    const key = `${stopId}-${line}-${destination}`;
    return alerts.some((a) => a.key === key);
  }, [alerts]);

  const sendNotification = useCallback((title, body) => {
    if (permission === "granted") {
      new Notification(title, { body, icon: "/favicon.ico", tag: `sl-${Date.now()}` });
    }
  }, [permission]);

  return { permission, alerts, requestPermission, addAlert, removeAlert, hasAlert, sendNotification };
};

// ── Main Component ──────────────────────────────────────────

const Home = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedStop, setSelectedStop] = useState(null);
  const [departures, setDepartures] = useState([]);
  const [isLoadingDepartures, setIsLoadingDepartures] = useState(false);
  const [activeTab, setActiveTab] = useState("departures");
  const [modeFilter, setModeFilter] = useState("ALL");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef(null);

  // Trip planner state
  const [tripFrom, setTripFrom] = useState(null);
  const [tripTo, setTripTo] = useState(null);
  const [tripFromQuery, setTripFromQuery] = useState("");
  const [tripToQuery, setTripToQuery] = useState("");
  const [tripFromResults, setTripFromResults] = useState([]);
  const [tripToResults, setTripToResults] = useState([]);
  const [trips, setTrips] = useState([]);
  const [isLoadingTrips, setIsLoadingTrips] = useState(false);
  const [tripDate, setTripDate] = useState("");
  const [tripTime, setTripTime] = useState("");
  const [tripTimeType, setTripTimeType] = useState("departure");
  const [tripTransportModes, setTripTransportModes] = useState([]);
  const [selectedTrip, setSelectedTrip] = useState(null);

  // Nearby stops state
  const [nearbyStops, setNearbyStops] = useState([]);
  const [isLoadingNearby, setIsLoadingNearby] = useState(false);
  const [locationError, setLocationError] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [nearbyView, setNearbyView] = useState("map"); // "map" or "list"
  const [locationPermissionAsked, setLocationPermissionAsked] = useState(false);
  const [initialStation, setInitialStation] = useState(null);

  // IP-based location fallback
  const getLocationByIP = async () => {
    try {
      const response = await axios.get('https://ipapi.co/json/');
      return {
        lat: response.data.latitude,
        lon: response.data.longitude,
        city: response.data.city
      };
    } catch (error) {
      // Fallback to Stockholm center if IP location fails
      return {
        lat: 59.3293,
        lon: 18.0686,
        city: 'Stockholm'
      };
    }
  };

  // Get default station (T-Centralen)
  const getDefaultStation = async () => {
    try {
      const response = await axios.get(`${API}/stops/search`, {
        params: { q: "T-Centralen" }
      });
      const tcentralen = response.data?.find(s => 
        s.name.toLowerCase().includes('t-centralen') || 
        s.name.toLowerCase().includes('t centralen')
      );
      if (tcentralen) {
        setInitialStation(tcentralen);
        setSelectedStop(tcentralen);
        await fetchDepartures(tcentralen.id);
      }
    } catch (error) {
      console.error('Failed to get default station:', error);
    }
  };

  // Initialize app with cached station or T-Centralen fallback
  useEffect(() => {
    const initializeApp = async () => {
      if (locationPermissionAsked) return;
      
      setLocationPermissionAsked(true);
      
      // Try to load last selected station first
      const lastStation = loadLastStation();
      if (lastStation) {
        setInitialStation(lastStation);
        setSelectedStop(lastStation);
        await fetchDepartures(lastStation.id);
      } else {
        // Fallback to T-Centralen if no cached station
        await getDefaultStation();
      }
    };

    initializeApp();
  }, [locationPermissionAsked]);

  // Fetch departures for a specific stop
  const fetchDepartures = async (stopId) => {
    setIsLoadingDepartures(true);
    try {
      const response = await axios.get(`${API}/departures/${stopId}`);
      const deps = response.data.departures || [];
      setDepartures(deps);
      return response.data;
    } catch (error) {
      console.error('Failed to fetch departures:', error);
      setDepartures([]);
      return null;
    } finally {
      setIsLoadingDepartures(false);
    }
  };

  // Fetch nearby stops helper
  const fetchNearbyStops = async (lat, lon) => {
    try {
      const response = await axios.get(`${API}/nearby`, {
        params: { lat, lon, radius: 1000 },
      });
      const stops = response.data.stops || [];
      setNearbyStops(stops);
      
      // If nearby stations found, select the closest one
      if (stops.length > 0) {
        const closestStop = stops[0];
        setInitialStation(closestStop);
        setSelectedStop(closestStop);
        await fetchDepartures(closestStop.id);
      }
    } catch (error) {
      console.error('Failed to fetch nearby stops:', error);
    }
  };

  const { favorites, addFavorite, removeFavorite, isFavorite } = useFavorites();
  const { recents, addRecent, clearRecents } = useRecentSearches();
  const { permission: notifPerm, alerts, requestPermission, addAlert, removeAlert, hasAlert, sendNotification } = useNotifications();

  // Last selected station caching
  const saveLastStation = useCallback((station) => {
    if (station) {
      localStorage.setItem('sl-last-station', JSON.stringify(station));
    }
  }, []);

  const loadLastStation = useCallback(() => {
    try {
      const cached = localStorage.getItem('sl-last-station');
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  }, []);

  // Close search dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Search stops with debounce + abort controller
  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const abortController = new AbortController();
    setIsSearching(true);

    const timer = setTimeout(async () => {
      try {
        const response = await axios.get(`${API}/stops/search`, {
          params: { q: searchQuery },
          signal: abortController.signal,
        });
        if (!abortController.signal.aborted) {
          setSearchResults(response.data);
          setIsSearching(false);
        }
      } catch (e) {
        if (!abortController.signal.aborted) {
          console.error("Search error:", e);
          setSearchResults([]);
          setIsSearching(false);
        }
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      abortController.abort();
      // Don't reset isSearching here - the next effect run will handle it
    };
  }, [searchQuery]);

  // Trip planner search (from)
  useEffect(() => {
    if (tripFromQuery.length < 2) { setTripFromResults([]); return; }
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const r = await axios.get(`${API}/stops/search`, { params: { q: tripFromQuery }, signal: abort.signal });
        if (!abort.signal.aborted) setTripFromResults(r.data);
      } catch (e) { if (!abort.signal.aborted) console.error(e); }
    }, 250);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [tripFromQuery]);

  // Trip planner search (to)
  useEffect(() => {
    if (tripToQuery.length < 2) { setTripToResults([]); return; }
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const r = await axios.get(`${API}/stops/search`, { params: { q: tripToQuery }, signal: abort.signal });
        if (!abort.signal.aborted) setTripToResults(r.data);
      } catch (e) { if (!abort.signal.aborted) console.error(e); }
    }, 250);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [tripToQuery]);

  // Auto-refresh departures + notification check
  useEffect(() => {
    if (!selectedStop) return;
    let mounted = true;
    const doFetch = async () => {
      setIsLoadingDepartures(true);
      try {
        const response = await axios.get(`${API}/departures/${selectedStop.id}`);
        if (mounted) {
          const deps = response.data.departures || [];
          setDepartures(deps);
          setSelectedStop((prev) => prev ? { ...prev, name: response.data.site_name } : prev);

          // Check departure alerts
          for (const dep of deps) {
            if (hasAlert(selectedStop.id, dep.line, dep.destination)) {
              const mins = dep.display_time;
              if (mins === "Nu" || mins === "1 min" || mins === "2 min" || mins === "3 min") {
                sendNotification(
                  `Linje ${dep.line} → ${dep.destination}`,
                  `Avgår ${mins} från ${response.data.site_name}`
                );
              }
            }
          }
        }
      } catch (e) {
        if (mounted) { setDepartures([]); }
      } finally {
        if (mounted) setIsLoadingDepartures(false);
      }
    };
    doFetch();
    const interval = setInterval(doFetch, 30000);
    return () => { mounted = false; clearInterval(interval); };
  }, [selectedStop?.id, hasAlert, sendNotification]);

  // Handle stop selection - always go to departures
  const handleSelectStop = (stop) => {
    setSelectedStop(stop);
    setInitialStation(stop);
    saveLastStation(stop);
    addRecent(stop);
    setSearchQuery("");
    setSearchResults([]);
    setModeFilter("ALL");
    setActiveTab("departures");
  };

  // Fetch nearby stops
  const handleFetchNearby = () => {
    if (!navigator.geolocation) {
      setLocationError("Geolokalisering stöds inte i din webbläsare");
      toast.error("Geolokalisering stöds inte i din webbläsare");
      return;
    }
    
    setIsLoadingNearby(true);
    setLocationError(null);
    
    try {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          try {
            const { latitude, longitude } = position.coords;
            setUserLocation({ lat: latitude, lon: longitude });
            
            const response = await axios.get(`${API}/nearby`, {
              params: { lat: latitude, lon: longitude, radius: 1000 },
            });
            
            setNearbyStops(response.data.stops || []);
            if (response.data.stops?.length === 0) {
              toast.info("Inga hållplatser hittades i närheten");
            } else {
              toast.success(`Hittade ${response.data.stops.length} hållplatser`);
              // Automatically switch to nearby tab to show results
              setActiveTab("nearby");
              setNearbyView("list"); // Default to list view
            }
          } catch (error) {
            console.error('Nearby stops error:', error);
            toast.error("Kunde inte hämta hållplatser i närheten");
            setLocationError("Kunde inte hämta hållplatser");
          } finally {
            setIsLoadingNearby(false);
          }
        },
        (error) => {
          console.error('Geolocation error:', error);
          let errorMessage = "Kunde inte hämta din position.";
          
          switch(error.code) {
            case error.PERMISSION_DENIED:
              errorMessage = "Platsåtkomst nekades. Tillåt platsåtkomst i webbläsaren.";
              break;
            case error.POSITION_UNAVAILABLE:
              errorMessage = "Position information är inte tillgänglig.";
              break;
            case error.TIMEOUT:
              errorMessage = "Position request tog för lång tid.";
              break;
            default:
              errorMessage = "Okänt fel vid hämtning av position.";
          }
          
          setLocationError(errorMessage);
          toast.error(errorMessage);
          setIsLoadingNearby(false);
        },
        { 
          enableHighAccuracy: false, // Changed to false for better compatibility
          timeout: 15000, // Increased timeout
          maximumAge: 60000 // Allow cached positions
        }
      );
    } catch (error) {
      console.error('Geolocation API error:', error);
      setLocationError("Geolokalisering misslyckades");
      toast.error("Geolokalisering misslyckades");
      setIsLoadingNearby(false);
    }
  };

  // Plan trip
  const handlePlanTrip = async () => {
    if (!tripFrom || !tripTo) { toast.error("Välj både start och mål"); return; }
    setIsLoadingTrips(true);
    try {
      const originId = tripFrom.global_id || tripFrom.id;
      const destId = tripTo.global_id || tripTo.id;
      const params = { 
        origin_id: originId, 
        dest_id: destId,
      };
      
      if (tripDate) params.date = tripDate;
      if (tripTime) params.time = tripTime;
      if (tripTimeType) params.time_type = tripTimeType;
      if (tripTransportModes.length > 0) params.transport_modes = tripTransportModes.join(",");
      
      const response = await axios.get(`${API}/trips`, { params });
      setTrips(response.data.trips);
      if (response.data.trips.length === 0) toast.info("Inga resor hittades");
    } catch (e) {
      toast.error("Kunde inte planera resa");
    } finally {
      setIsLoadingTrips(false);
    }
  };

  // Filtered departures
  const filteredDepartures = modeFilter === "ALL"
    ? departures
    : departures.filter((d) => d.transport_mode === modeFilter);

  return (
    <div className="min-h-screen bg-[#0A0A0A]">
      {/* Header with Search */}
      <header className="glass-header px-4 py-4">
        <div className="max-w-screen-xl mx-auto">
          <div className="flex items-center gap-4 mb-4">
            <div className="flex items-center gap-2">
              <Bus className="w-6 h-6 text-white" />
              <h1 className="font-display text-xl sm:text-2xl font-black text-white tracking-tight">
                SL Sök
              </h1>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <div className="live-pulse" />
              <span className="small-label">Live</span>
            </div>
          </div>

          
          {/* Main Search */}
          <div ref={searchRef}>
            <Command className="bg-[#141414] border border-[#262626] rounded-lg" shouldFilter={false}>
              <CommandInput
                placeholder="Sök station eller hållplats..."
                value={searchQuery}
                onValueChange={(v) => { setSearchQuery(v); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
                className="h-12 text-white"
                data-testid="global-search-input"
              />
              <div className="flex items-center gap-2 p-2 border-t border-[#262626]">
                <Button
                  onClick={handleFetchNearby}
                  disabled={isLoadingNearby}
                  variant="ghost"
                  size="sm"
                  className="text-neutral-400 hover:text-white"
                  data-testid="nearby-quick-button"
                >
                  {isLoadingNearby ? (
                    <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Hittar position...</>
                  ) : (
                    <><LocateFixed className="w-4 h-4 mr-2" />Hållplatser nära mig</>
                  )}
                </Button>
                {locationError && (
                  <span className="text-xs text-red-400">{locationError}</span>
                )}
              </div>
              {searchOpen && (
                <CommandList>
                  {isSearching && (
                    <CommandEmpty>
                      <div className="flex items-center justify-center gap-2 py-4">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Söker...</span>
                      </div>
                    </CommandEmpty>
                  )}
                  {!isSearching && searchQuery.length >= 2 && searchResults.length === 0 && (
                    <CommandEmpty>Inga resultat hittades</CommandEmpty>
                  )}
                  {/* Search Results */}
                  {searchResults.length > 0 && (
                    <CommandGroup heading="Hållplatser">
                      {searchResults.map((stop) => (
                        <CommandItem
                          key={stop.id}
                          value={`${stop.name}-${stop.id}`}
                          onSelect={() => { handleSelectStop(stop); setSearchOpen(false); }}
                          className="flex items-center gap-3 p-3 cursor-pointer hover:bg-[#1A1A1A]"
                          data-testid="search-result-item"
                        >
                          <MapPin className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <StopName name={stop.name} locality={stop.locality} className="text-white text-sm" />
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              isFavorite(stop.id) ? removeFavorite(stop.id) : addFavorite(stop);
                            }}
                            className={`favorite-btn flex-shrink-0 ${isFavorite(stop.id) ? "active" : "text-neutral-500"}`}
                            data-testid="favorite-toggle-button"
                          >
                            <Star className="w-4 h-4" fill={isFavorite(stop.id) ? "currentColor" : "none"} />
                          </button>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                  {/* Recent Searches - show when no active search query */}
                  {searchQuery.length < 2 && recents.length > 0 && (
                    <CommandGroup heading={
                      <div className="flex items-center justify-between">
                        <span>Senaste sökningar</span>
                        <button onClick={clearRecents} className="text-neutral-500 hover:text-white text-xs transition-colors" data-testid="clear-recent-searches">
                          Rensa
                        </button>
                      </div>
                    }>
                      {recents.map((stop) => (
                        <CommandItem
                          key={`recent-${stop.id}`}
                          value={`recent-${stop.name}-${stop.id}`}
                          onSelect={() => { handleSelectStop(stop); setSearchOpen(false); }}
                          className="flex items-center gap-3 p-3 cursor-pointer hover:bg-[#1A1A1A]"
                          data-testid="recent-search-item"
                        >
                          <History className="w-4 h-4 text-neutral-500 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <StopName name={stop.name} locality={stop.locality} className="text-white text-sm" />
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </CommandList>
              )}
            </Command>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-screen-xl mx-auto px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="bg-[#141414] border border-[#262626] p-1 mb-6">
            <TabsTrigger value="departures" className="data-[state=active]:bg-white data-[state=active]:text-black">
              <Clock className="w-4 h-4 mr-2" />
              Avgångar
            </TabsTrigger>
            <TabsTrigger value="planner" className="data-[state=active]:bg-white data-[state=active]:text-black">
              <Navigation className="w-4 h-4 mr-2" />
              Reseplanerare
            </TabsTrigger>
            <TabsTrigger value="nearby" className="data-[state=active]:bg-white data-[state=active]:text-black">
              <LocateFixed className="w-4 h-4 mr-2" />
              Nära mig
            </TabsTrigger>
          </TabsList>

          {/* ── Departures Tab ── */}
          <TabsContent value="departures" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Favorites Widget */}
              <div className="tech-card p-6">
                <h2 className="font-display text-lg font-bold text-white mb-4 flex items-center gap-2">
                  <Star className="w-5 h-5 text-yellow-400" />
                  Favoriter
                </h2>
                {favorites.length === 0 ? (
                  <p className="text-neutral-500 text-sm">Inga favoriter ännu. Sök och spara hållplatser.</p>
                ) : (
                  <div className="space-y-2">
                    {favorites.map((fav) => (
                      <button
                        key={fav.id}
                        onClick={() => handleSelectStop(fav)}
                        className={`w-full text-left p-3 rounded border transition-all ${
                          selectedStop?.id === fav.id
                            ? "bg-white/10 border-white/30"
                            : "bg-[#1A1A1A] border-[#262626] hover:border-white/20"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <MapPin className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                          <StopName name={fav.name} locality={fav.locality} className="text-white text-sm" />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Departures Board */}
              <div className="lg:col-span-2 tech-card">
                <div className="p-4 border-b border-[#262626]">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h2 className="font-display text-lg font-bold text-white">
                        {selectedStop ? selectedStop.name : "Välj en hållplats"}
                      </h2>
                      <p className="small-label mt-1">Nästa avgångar</p>
                    </div>
                    {selectedStop && (
                      <div className="flex items-center gap-2">
                        <button onClick={() => { setIsLoadingDepartures(true); axios.get(`${API}/departures/${selectedStop.id}`).then(r => { setDepartures(r.data.departures || []); }).finally(() => setIsLoadingDepartures(false)); }}
                          className="p-2 hover:bg-[#1A1A1A] rounded transition-colors" title="Uppdatera">
                          <RefreshCw className={`w-4 h-4 text-neutral-400 ${isLoadingDepartures ? "animate-spin" : ""}`} />
                        </button>
                        <button
                          onClick={() => isFavorite(selectedStop.id) ? removeFavorite(selectedStop.id) : addFavorite(selectedStop)}
                          className={`favorite-btn p-2 hover:bg-[#1A1A1A] rounded transition-colors ${isFavorite(selectedStop.id) ? "active" : "text-neutral-500"}`}
                          data-testid="favorite-toggle-button"
                        >
                          <Star className="w-4 h-4" fill={isFavorite(selectedStop.id) ? "currentColor" : "none"} />
                        </button>
                      </div>
                    )}
                  </div>
                  {/* Transport Mode Filter */}
                  {selectedStop && departures.length > 0 && (
                    <div className="flex flex-wrap gap-2" data-testid="transport-mode-filter">
                      {TRANSPORT_MODES.map((mode) => {
                        const isActive = modeFilter === mode.key;
                        const count = mode.key === "ALL" ? departures.length : departures.filter(d => d.transport_mode === mode.key).length;
                        if (mode.key !== "ALL" && count === 0) return null;
                        return (
                          <button
                            key={mode.key}
                            onClick={() => setModeFilter(mode.key)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all border ${
                              isActive
                                ? "bg-white text-black border-white"
                                : "bg-transparent text-neutral-400 border-[#262626] hover:border-white/30"
                            }`}
                            data-testid={`filter-${mode.key.toLowerCase()}`}
                          >
                            {mode.icon && <mode.icon className={`w-3 h-3 ${isActive ? "text-black" : mode.color}`} />}
                            {mode.label}
                            <span className={`ml-1 ${isActive ? "text-black/60" : "text-neutral-600"}`}>{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <ScrollArea className="h-[400px]">
                  {!selectedStop ? (
                    <div className="p-8 text-center">
                      <Search className="w-12 h-12 text-neutral-600 mx-auto mb-4" />
                      <p className="text-neutral-500">Sök efter en hållplats för att se avgångar</p>
                    </div>
                  ) : isLoadingDepartures ? (
                    <div>{[...Array(5)].map((_, i) => <DepartureSkeleton key={i} />)}</div>
                  ) : filteredDepartures.length === 0 ? (
                    <div className="p-8 text-center">
                      <Clock className="w-12 h-12 text-neutral-600 mx-auto mb-4" />
                      <p className="text-neutral-500">
                        {modeFilter !== "ALL" ? "Inga avgångar med valt trafikslag" : "Inga avgångar hittades"}
                      </p>
                      {modeFilter !== "ALL" && (
                        <button onClick={() => setModeFilter("ALL")} className="text-white/60 text-sm mt-2 hover:text-white underline">
                          Visa alla
                        </button>
                      )}
                    </div>
                  ) : (
                    filteredDepartures.map((dep, i) => (
                      <DepartureRow
                        key={`${dep.line}-${dep.destination}-${i}`}
                        departure={dep}
                        stopId={selectedStop?.id}
                        isAlerted={hasAlert(selectedStop?.id, dep.line, dep.destination)}
                        onToggleAlert={(line, dest) => {
                          if (hasAlert(selectedStop?.id, line, dest)) {
                            removeAlert(`${selectedStop?.id}-${line}-${dest}`);
                          } else {
                            if (notifPerm !== "granted") {
                              requestPermission().then((p) => {
                                if (p === "granted") addAlert(selectedStop?.id, selectedStop?.name, line, dest);
                                else toast.error("Tillåt notifikationer i webbläsaren");
                              });
                            } else {
                              addAlert(selectedStop?.id, selectedStop?.name, line, dest);
                            }
                          }
                        }}
                      />
                    ))
                  )}
                </ScrollArea>
              </div>
            </div>
          </TabsContent>

          {/* ── Trip Planner Tab ── */}
          <TabsContent value="planner" className="space-y-6">
            <div className={`grid gap-6 ${trips.length > 0 ? "grid-cols-1 lg:grid-cols-2" : ""}`}>
              {/* Input Form */}
              <div className="tech-card p-6">
                <h2 className="font-display text-lg font-bold text-white mb-6">Planera din resa</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                {/* From */}
                <div className="space-y-2">
                  <label className="small-label">Från</label>
                  <div className="relative">
                    <Input
                      value={tripFrom ? `${tripFrom.name}${tripFrom.locality ? ` (${tripFrom.locality})` : ""}` : tripFromQuery}
                      onChange={(e) => { setTripFromQuery(e.target.value); setTripFrom(null); }}
                      placeholder="Ange startpunkt..."
                      className="bg-[#1A1A1A] border-[#262626] text-white h-12"
                      data-testid="trip-planner-from-input"
                    />
                    {tripFrom && (
                      <button onClick={() => { setTripFrom(null); setTripFromQuery(""); }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                    {tripFromResults.length > 0 && !tripFrom && (
                      <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-[#141414] border border-[#262626] rounded-lg max-h-48 overflow-y-auto">
                        {tripFromResults.map((stop) => (
                          <button key={stop.id}
                            onClick={() => { setTripFrom(stop); setTripFromQuery(""); setTripFromResults([]); }}
                            className="w-full text-left px-4 py-3 hover:bg-[#1A1A1A] flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-neutral-400" />
                            <StopName name={stop.name} locality={stop.locality} className="text-white text-sm" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {/* To */}
                <div className="space-y-2">
                  <label className="small-label">Till</label>
                  <div className="relative">
                    <Input
                      value={tripTo ? `${tripTo.name}${tripTo.locality ? ` (${tripTo.locality})` : ""}` : tripToQuery}
                      onChange={(e) => { setTripToQuery(e.target.value); setTripTo(null); }}
                      placeholder="Ange slutpunkt..."
                      className="bg-[#1A1A1A] border-[#262626] text-white h-12"
                      data-testid="trip-planner-to-input"
                    />
                    {tripTo && (
                      <button onClick={() => { setTripTo(null); setTripToQuery(""); }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                    {tripToResults.length > 0 && !tripTo && (
                      <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-[#141414] border border-[#262626] rounded-lg max-h-48 overflow-y-auto">
                        {tripToResults.map((stop) => (
                          <button key={stop.id}
                            onClick={() => { setTripTo(stop); setTripToQuery(""); setTripToResults([]); }}
                            className="w-full text-left px-4 py-3 hover:bg-[#1A1A1A] flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-neutral-400" />
                            <StopName name={stop.name} locality={stop.locality} className="text-white text-sm" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Advanced Options */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="space-y-2">
                  <label className="small-label">Datum (valfritt)</label>
                  <Input
                    type="date"
                    value={tripDate}
                    onChange={(e) => setTripDate(e.target.value)}
                    className="bg-[#1A1A1A] border-[#262626] text-white h-12"
                  />
                </div>
                <div className="space-y-2">
                  <label className="small-label">Tid (valfritt)</label>
                  <Input
                    type="time"
                    value={tripTime}
                    onChange={(e) => setTripTime(e.target.value)}
                    className="bg-[#1A1A1A] border-[#262626] text-white h-12"
                  />
                </div>
                <div className="space-y-2">
                  <label className="small-label">Tidstyp</label>
                  <select
                    value={tripTimeType}
                    onChange={(e) => setTripTimeType(e.target.value)}
                    className="w-full bg-[#1A1A1A] border border-[#262626] text-white h-12 px-3 rounded"
                  >
                    <option value="departure">Avgång</option>
                    <option value="arrival">Ankomst</option>
                  </select>
                </div>
              </div>

              {/* Transport Mode Filter */}
              <div className="space-y-2 mb-6">
                <label className="small-label">Trafikslag (valfritt)</label>
                <div className="flex flex-wrap gap-2">
                  {TRANSPORT_MODES.slice(1).map((mode) => (
                    <button
                      key={mode.key}
                      onClick={() => {
                        setTripTransportModes(prev =>
                          prev.includes(mode.key)
                            ? prev.filter(m => m !== mode.key)
                            : [...prev, mode.key]
                        );
                      }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all border ${
                        tripTransportModes.includes(mode.key)
                          ? "bg-white text-black border-white"
                          : "bg-transparent text-neutral-400 border-[#262626] hover:border-white/30"
                      }`}
                    >
                      {mode.icon && <mode.icon className={`w-3 h-3 ${tripTransportModes.includes(mode.key) ? "text-black" : mode.color}`} />}
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <Button onClick={handlePlanTrip} disabled={!tripFrom || !tripTo || isLoadingTrips}
                  className="flex-1 md:w-auto bg-white text-black hover:bg-neutral-200 font-semibold h-12 px-8"
                  data-testid="trip-planner-submit">
                  {isLoadingTrips ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Söker...</> : <><Search className="w-4 h-4 mr-2" />Sök resa</>}
                </Button>
                <Button 
                  onClick={() => {
                    setTripDate("");
                    setTripTime("");
                    setTripTimeType("departure");
                    setTripNumResults(5);
                    setTripTransportModes([]);
                  }}
                  variant="outline"
                  className="bg-transparent border-[#262626] text-neutral-400 hover:text-white hover:border-white/30 h-12 px-6"
                >
                  Rensa filter
                </Button>
              </div>
            </div>

            {/* Trip Results */}
            {trips.length > 0 && (
              <div className="tech-card">
                <div className="p-4 border-b border-[#262626]">
                  <h3 className="font-display font-bold text-white">Resealternativ</h3>
                  <p className="small-label mt-1">{tripFrom?.name} → {tripTo?.name}</p>
                </div>
                <div className="divide-y divide-[#262626]">
                  {trips.map((trip, ti) => (
                    <div key={ti} 
                      className={`p-4 hover:bg-[#1A1A1A] transition-colors cursor-pointer ${selectedTrip === ti ? "bg-[#1A1A1A]" : ""}`}
                      onClick={() => setSelectedTrip(selectedTrip === ti ? null : ti)}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <span className="time-display text-xl text-white">{trip.departure_time}</span>
                          <ArrowRight className="w-4 h-4 text-neutral-500" />
                          <span className="time-display text-xl text-white">{trip.arrival_time}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {trip.interchanges > 0 && (
                            <Badge variant="outline" className="border-[#262626] text-neutral-400 text-xs">
                              {trip.interchanges} byte
                            </Badge>
                          )}
                          <Badge variant="outline" className="border-[#262626] text-neutral-400">
                            {trip.total_duration} min
                          </Badge>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {trip.legs.map((leg, li) => (
                          <div key={li} className="flex items-center gap-1">
                            {li > 0 && <ArrowRight className="w-3 h-3 text-neutral-500" />}
                            {leg.line ? (
                              <LineBadge line={leg.line} mode={leg.transport_mode} />
                            ) : (
                              <Badge variant="outline" className="border-neutral-600 text-neutral-400">
                                <Footprints className="w-3 h-3 mr-1" />
                                Gång
                              </Badge>
                            )}
                          </div>
                        ))}
                      </div>
                      {/* Expanded details for selected trip */}
                      {selectedTrip === ti && (
                        <div className="mt-4 pt-4 border-t border-[#262626]">
                          {/* Leg details */}
                          <div className="space-y-3 text-sm mb-4">
                            {trip.legs.map((leg, li) => (
                              <div key={li} className="flex items-start gap-2 text-neutral-400">
                                <span className="text-neutral-500">{li + 1}.</span>
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-white">{leg.origin}</span>
                                    <ArrowRight className="w-3 h-3" />
                                    <span className="text-white">{leg.destination}</span>
                                  </div>
                                  <div className="text-xs text-neutral-500 mt-0.5">
                                    {leg.departure_time} → {leg.arrival_time} ({leg.duration_minutes} min)
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                          {/* Map */}
                          <div className="h-64 rounded-lg overflow-hidden">
                            <MapContainer
                              style={{ height: "100%", width: "100%" }}
                              center={(() => {
                                // Calculate center from trip coordinates
                                const coords = trip.legs
                                  .filter(leg => leg.origin_lat && leg.origin_lon)
                                  .map(leg => [leg.origin_lat, leg.origin_lon]);
                                if (coords.length === 0) return [59.3293, 18.0686];
                                const avgLat = coords.reduce((sum, c) => sum + c[0], 0) / coords.length;
                                const avgLon = coords.reduce((sum, c) => sum + c[1], 0) / coords.length;
                                return [avgLat, avgLon];
                              })()}
                              zoom={12}
                              scrollWheelZoom={false}
                            >
                              <TileLayer
                                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                              />
                              {trip.legs.map((leg, li) => {
                                if (leg.origin_lat && leg.origin_lon && leg.dest_lat && leg.dest_lon) {
                                  const positions = [
                                    [leg.origin_lat, leg.origin_lon],
                                    [leg.dest_lat, leg.dest_lon]
                                  ];
                                  return (
                                    <div key={li}>
                                      <Polyline
                                        positions={positions}
                                        color={leg.transport_mode === "WALK" ? "#666" : "#fff"}
                                        weight={3}
                                        opacity={0.8}
                                      />
                                      <Marker position={[leg.origin_lat, leg.origin_lon]}>
                                        <Popup>{leg.origin}</Popup>
                                      </Marker>
                                      <Marker position={[leg.dest_lat, leg.dest_lon]}>
                                        <Popup>{leg.destination}</Popup>
                                      </Marker>
                                    </div>
                                  );
                                }
                                return null;
                              })}
                            </MapContainer>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            </div>
          </TabsContent>

          {/* ── Nearby Tab ── */}
          <TabsContent value="nearby" className="space-y-6">
            <div className="tech-card p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display text-lg font-bold text-white flex items-center gap-2">
                  <LocateFixed className="w-5 h-5" />
                  Hållplatser nära dig
                </h2>
                <div className="flex items-center gap-2">
                  {nearbyStops.length > 0 && (
                    <div className="flex bg-[#1A1A1A] border border-[#262626] rounded overflow-hidden" data-testid="nearby-view-toggle">
                      <button onClick={() => setNearbyView("map")}
                        className={`p-2 transition-colors ${nearbyView === "map" ? "bg-white text-black" : "text-neutral-400 hover:text-white"}`}>
                        <MapIcon className="w-4 h-4" />
                      </button>
                      <button onClick={() => setNearbyView("list")}
                        className={`p-2 transition-colors ${nearbyView === "list" ? "bg-white text-black" : "text-neutral-400 hover:text-white"}`}>
                        <List className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  <Button onClick={handleFetchNearby} disabled={isLoadingNearby}
                    className="bg-white text-black hover:bg-neutral-200 font-semibold" data-testid="nearby-button">
                    {isLoadingNearby ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Söker...</> : <><LocateFixed className="w-4 h-4 mr-2" />Hitta nära mig</>}
                  </Button>
                </div>
              </div>

              {locationError && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm mb-4">
                  <AlertTriangle className="w-4 h-4 inline mr-2" />{locationError}
                </div>
              )}

              {nearbyStops.length === 0 && !isLoadingNearby && (
                <p className="text-neutral-500 text-sm">
                  Tryck på "Hitta nära mig" för att visa hållplatser inom 1 km.
                </p>
              )}

              {/* Map View */}
              {nearbyStops.length > 0 && nearbyView === "map" && userLocation && (
                <div className="rounded-lg overflow-hidden border border-[#262626] mb-4" style={{ height: "400px" }} data-testid="nearby-map">
                  <MapContainer
                    key={`${userLocation.lat}-${userLocation.lon}`} // Force re-render on location change
                    center={[userLocation.lat, userLocation.lon]}
                    zoom={15}
                    style={{ height: "100%", width: "100%" }}
                    zoomControl={true}
                    scrollWheelZoom={false}
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://carto.com/">CARTO</a>'
                      url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                    />
                    
                    {/* User location marker */}
                    <Marker position={[userLocation.lat, userLocation.lon]} icon={userIcon}>
                      <Popup><span className="text-sm font-semibold">Din position</span></Popup>
                    </Marker>

                    {/* 1km radius circle */}
                    <Circle center={[userLocation.lat, userLocation.lon]} radius={1000}
                      pathOptions={{ color: "#3B82F6", fillColor: "#3B82F6", fillOpacity: 0.05, weight: 1 }} />

                    {/* Stop markers */}
                    {nearbyStops.map((stop) => (
                      <Marker key={`stop-${stop.id}`} position={[stop.lat, stop.lon]} icon={stopIcon}>
                        <Popup>
                          <div className="text-sm min-w-[140px]">
                            <div className="font-bold">{stop.name}</div>
                            {stop.locality && <div className="text-gray-500 text-xs">{stop.locality}</div>}
                            <div className="text-gray-400 text-xs mt-1">{stop.distance}m bort</div>
                            <button
                              onClick={() => handleSelectStop({ ...stop, global_id: null })}
                              className="mt-2 w-full text-center bg-blue-500 text-white text-xs py-1.5 px-3 rounded hover:bg-blue-600 transition-colors"
                              data-testid="map-popup-departures-btn"
                            >
                              Visa avgångar
                            </button>
                          </div>
                        </Popup>
                      </Marker>
                    ))}
                  </MapContainer>
                </div>
              )}

              {/* List View */}
              {nearbyStops.length > 0 && nearbyView === "list" && (
                <div className="space-y-2">
                  {nearbyStops.map((stop) => (
                    <button
                      key={stop.id}
                      onClick={() => handleSelectStop({ ...stop, global_id: null })}
                      className="w-full text-left p-4 bg-[#1A1A1A] border border-[#262626] rounded hover:border-white/20 transition-all"
                      data-testid="nearby-stop-item"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <MapPin className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                          <div>
                            <StopName name={stop.name} locality={stop.locality} className="text-white text-sm font-medium" />
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-neutral-500 text-sm font-mono">{stop.distance}m</span>
                          <ArrowRight className="w-4 h-4 text-neutral-600" />
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Active Alerts Section */}
            {alerts.length > 0 && (
              <div className="tech-card p-6">
                <h3 className="font-display text-lg font-bold text-white mb-4 flex items-center gap-2">
                  <Bell className="w-5 h-5 text-yellow-400" />
                  Aktiva bevakningar
                </h3>
                <div className="space-y-2">
                  {alerts.map((alert) => (
                    <div key={alert.key} className="flex items-center justify-between p-3 bg-[#1A1A1A] border border-[#262626] rounded">
                      <div className="flex items-center gap-3">
                        <LineBadge line={alert.line} mode="BUS" />
                        <div>
                          <p className="text-white text-sm">{alert.destination}</p>
                          <p className="text-neutral-500 text-xs">{alert.stopName}</p>
                        </div>
                      </div>
                      <button onClick={() => removeAlert(alert.key)}
                        className="text-neutral-500 hover:text-red-400 transition-colors p-1" data-testid="remove-alert-btn">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>

      <Toaster position="bottom-right" theme="dark" />
    </div>
  );
};

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;
