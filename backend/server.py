from fastapi import FastAPI, APIRouter, HTTPException, Query
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
import time
import unicodedata
import re
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
import uuid
from datetime import datetime, timezone
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Trafiklab API base URLs (no key required)
SL_TRANSPORT_BASE = "https://transport.integration.sl.se/v1"
SL_JOURNEYPLANNER_V2_BASE = "https://journeyplanner.integration.sl.se/v2"

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# ── Pydantic Models ──────────────────────────────────────────────

class StopSearchResult(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    global_id: Optional[str] = None
    locality: Optional[str] = None
    type: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    score: Optional[int] = None


class Departure(BaseModel):
    model_config = ConfigDict(extra="ignore")
    line: str
    destination: str
    display_time: str
    scheduled: Optional[str] = None
    expected: Optional[str] = None
    transport_mode: str
    deviations: Optional[List[str]] = None


class DeparturesResponse(BaseModel):
    site_id: str
    site_name: str
    departures: List[Departure]


class TripLeg(BaseModel):
    model_config = ConfigDict(extra="ignore")
    origin: str
    destination: str
    line: Optional[str] = None
    transport_mode: str
    departure_time: str
    arrival_time: str
    duration_minutes: int
    origin_lat: Optional[float] = None
    origin_lon: Optional[float] = None
    dest_lat: Optional[float] = None
    dest_lon: Optional[float] = None


class Trip(BaseModel):
    model_config = ConfigDict(extra="ignore")
    legs: List[TripLeg]
    total_duration: int
    departure_time: str
    arrival_time: str
    interchanges: int = 0


class TripPlanResponse(BaseModel):
    trips: List[Trip]


# ── HTTP Client ──────────────────────────────────────────────────

async def get_http_client():
    return httpx.AsyncClient(timeout=15.0)


# ── Sites Cache for fast local search ────────────────────────────

_sites_cache = {"data": None, "timestamp": None}
CACHE_TTL = 600  # 10 minutes


async def get_cached_sites():
    """Get full sites list with caching for instant local search"""
    current_time = time.time()

    if (
        _sites_cache["data"] is not None
        and _sites_cache["timestamp"] is not None
        and current_time - _sites_cache["timestamp"] < CACHE_TTL
    ):
        return _sites_cache["data"]

    async with await get_http_client() as http:
        response = await http.get(
            f"{SL_TRANSPORT_BASE}/sites", params={"expand": "true"}
        )
        if response.status_code != 200:
            if _sites_cache["data"] is not None:
                return _sites_cache["data"]
            raise HTTPException(status_code=502, detail="Failed to fetch stops")

        data = response.json()
        sites = data if isinstance(data, list) else data.get("sites", [])
        _sites_cache["data"] = sites
        _sites_cache["timestamp"] = current_time
        return sites


# ── Smart search helpers ─────────────────────────────────────────

# Curated station dataset with synonyms and popularity weights
STATION_DATA = [
    {"name": "T-Centralen", "mode": "Tunnelbana", "weight": 100, "keywords": ["centralen", "t-cen", "tcen", "tcentralen", "sergels torg", "åhléns city", "vasagatan"]},
    {"name": "Stockholm City", "mode": "Pendeltåg", "weight": 95, "keywords": ["centralstation", "centralen", "t-centralen", "stockholm c", "stockholmc"]},
    {"name": "Slussen", "mode": "Tunnelbana", "weight": 85, "keywords": ["södermalmstorg", "katarinahissen", "gamla stan", "söder"]},
    {"name": "Gullmarsplan", "mode": "Tunnelbana, Tvärbana", "weight": 80, "keywords": ["söderort", "johanneshov", "mårtensdal", "bytesterminal"]},
    {"name": "Odenplan", "mode": "Tunnelbana, Pendeltåg", "weight": 75, "keywords": ["vasastan", "oden", "odenplan plaza"]},
    {"name": "Fridhemsplan", "mode": "Tunnelbana", "weight": 70, "keywords": ["kungsholmen", "västermalmsgallerian", "s:t eriksplan"]},
    {"name": "Hötorget", "mode": "Tunnelbana", "weight": 68, "keywords": ["kungsgatan", "sveavägen", "konserthuset", "filmstaden"]},
    {"name": "Liljeholmen", "mode": "Tunnelbana, Tvärbana", "weight": 65, "keywords": ["liljeholmstorget", "trekanten"]},
    {"name": "Östermalmstorg", "mode": "Tunnelbana", "weight": 65, "keywords": ["stureplan", "biblioteksgatan", "saluhallen", "östermalm"]},
    {"name": "Medborgarplatsen", "mode": "Tunnelbana", "weight": 62, "keywords": ["medis", "söderhallarna", "götgatan", "björns trädgård"]},
    {"name": "Skanstull", "mode": "Tunnelbana", "weight": 60, "keywords": ["ringvägen", "ringen", "eriksdal", "söder"]},
    {"name": "Solna", "mode": "Pendeltåg, Tvärbana", "weight": 60, "keywords": ["mall of scandinavia", "mos", "strawberry arena", "friends"]},
    {"name": "Alvik", "mode": "Tunnelbana, Tvärbana, Nockebybanan", "weight": 58, "keywords": ["traneberg", "bromma", "tvärbanan"]},
    {"name": "Sundbyberg", "mode": "Tunnelbana, Pendeltåg, Tvärbana", "weight": 55, "keywords": ["sumpan", "marabouparken", "sturegatan"]},
    {"name": "Tekniska högskolan", "mode": "Tunnelbana, Roslagsbanan", "weight": 55, "keywords": ["kth", "östra station", "roslagsbanan", "valhallavägen"]},
    {"name": "Flemingsberg", "mode": "Pendeltåg", "weight": 50, "keywords": ["södertörns högskola", "karolinska huddinge", "huddinge sjukhus"]},
    {"name": "Älvsjö", "mode": "Pendeltåg", "weight": 50, "keywords": ["stockholmsmässan", "mässan"]},
    {"name": "Danderyds sjukhus", "mode": "Tunnelbana", "weight": 48, "keywords": ["ds", "sjukhuset", "danderyd", "bussterminal"]},
    {"name": "Globen", "mode": "Tunnelbana", "weight": 45, "keywords": ["tele2 arena", "avicii arena", "slakthusområdet"]},
    {"name": "Södertälje centrum", "mode": "Pendeltåg", "weight": 45, "keywords": ["södertälje", "kringlan", "tom tits"]},
    {"name": "Ropsten", "mode": "Tunnelbana, Lidingöbanan", "weight": 45, "keywords": ["värtahamnen", "lidingö", "hjorthagen", "värtan"]},
    {"name": "Täby centrum", "mode": "Roslagsbanan", "weight": 40, "keywords": ["täby c", "täby", "tibble"]},
    {"name": "Universitetet", "mode": "Tunnelbana, Roslagsbanan", "weight": 40, "keywords": ["stockholms universitet", "su", "frescati"]},
    {"name": "Kista", "mode": "Tunnelbana", "weight": 40, "keywords": ["kista galleria", "kistamässan", "silicon valley"]},
    {"name": "Skärholmen", "mode": "Tunnelbana", "weight": 38, "keywords": ["skhlm", "skärholmen c", "kungens kurva"]},
    {"name": "Vällingby", "mode": "Tunnelbana", "weight": 35, "keywords": ["vällingby c", "vällingby centrum"]},
    {"name": "Jakobsberg", "mode": "Pendeltåg", "weight": 35, "keywords": ["jakan", "barkarby"]},
    {"name": "Märsta", "mode": "Pendeltåg", "weight": 35, "keywords": ["arlanda", "sigtuna buss"]},
    {"name": "Farsta strand", "mode": "Tunnelbana, Pendeltåg", "weight": 30, "keywords": ["farsta"]},
    {"name": "Nynäshamn", "mode": "Pendeltåg", "weight": 20, "keywords": ["nynäs", "gotlandsfärjan", "färjeterminal"]},
]

def normalize_swedish(text: str) -> str:
    """Normalize Swedish characters for flexible matching."""
    replacements = {
        'å': 'a', 'ä': 'a', 'ö': 'o',
        'é': 'e', 'è': 'e', 'ü': 'u',
    }
    text = text.lower()
    for src, dst in replacements.items():
        text = text.replace(src, dst)
    return text

# Build lookup indices for fast synonym matching
_synonym_index: dict[str, list[dict]] = {}  # normalized keyword -> list of station entries

def _build_synonym_index():
    """Build a flat index: normalized keyword/name → station entries"""
    for station in STATION_DATA:
        # Index the station name itself (normalized, stripped of hyphens/spaces)
        for variant in _name_variants(station["name"]):
            _synonym_index.setdefault(variant, []).append(station)
        # Index each keyword
        for kw in station["keywords"]:
            for variant in _name_variants(kw):
                _synonym_index.setdefault(variant, []).append(station)

def _name_variants(name: str) -> list[str]:
    """Generate normalized variants of a name for matching.
    'T-Centralen' -> ['t-centralen', 'tcentralen', 't centralen']"""
    low = name.lower().strip()
    normed = normalize_swedish(low)
    no_hyphen = low.replace("-", "").replace(" ", "")
    normed_no_hyphen = normed.replace("-", "").replace(" ", "")
    return list({low, normed, no_hyphen, normed_no_hyphen})

_build_synonym_index()


def _strip_all(text: str) -> str:
    """Remove hyphens, spaces, and special chars for loose matching."""
    return re.sub(r'[\s\-/:,()]+', '', text.lower())


def match_synonyms(query: str) -> list[tuple[str, int]]:
    """Match query against synonym index. Returns list of (station_name, boosted_score)."""
    q = query.lower().strip()
    q_stripped = _strip_all(q)
    q_normed = normalize_swedish(q)
    q_normed_stripped = _strip_all(q_normed)

    hits: dict[str, int] = {}

    for key, stations in _synonym_index.items():
        matched = False
        # Exact keyword match
        if key == q or key == q_stripped or key == q_normed or key == q_normed_stripped:
            matched = True
        # Keyword starts with query
        elif key.startswith(q) or key.startswith(q_stripped) or key.startswith(q_normed) or key.startswith(q_normed_stripped):
            matched = True
        # Query starts with keyword (e.g. "tcentralen" starts with "tcen")
        elif q_stripped.startswith(key) or q_normed_stripped.startswith(key):
            matched = True

        if matched:
            for station in stations:
                name = station["name"]
                weight = station["weight"]
                # Score: base 2000 (always above normal matches) + weight for ordering
                score = 2000 + weight
                if name not in hits or hits[name] < score:
                    hits[name] = score

    return list(hits.items())


def score_match(query: str, name: str) -> int:
    """Score a stop name against a query. Higher = better match."""
    q = query.lower().strip()
    n = name.lower().strip()
    q_stripped = _strip_all(q)
    n_stripped = _strip_all(n)

    # Exact match
    if q == n or q_stripped == n_stripped:
        return 1000

    # Name starts with query (with and without hyphens/spaces)
    if n.startswith(q) or n_stripped.startswith(q_stripped):
        return 900

    # Word boundary match
    words = re.split(r'[\s/,()-]+', n)
    for word in words:
        if word.startswith(q):
            return 800

    # Contains
    if q in n or q_stripped in n_stripped:
        return 600

    # Swedish normalization
    nq = normalize_swedish(q)
    nn = normalize_swedish(n)
    nq_stripped = _strip_all(nq)
    nn_stripped = _strip_all(nn)

    if nn.startswith(nq) or nn_stripped.startswith(nq_stripped):
        return 700

    nwords = re.split(r'[\s/,()-]+', nn)
    for word in nwords:
        if word.startswith(nq):
            return 650

    if nq in nn or nq_stripped in nn_stripped:
        return 500

    return 0


# ── Routes ───────────────────────────────────────────────────────

@api_router.get("/")
async def root():
    return {"message": "Stockholm Transit Search API"}


@api_router.get("/stops/search")
async def search_stops(q: str = Query(..., min_length=2)):
    """Smart stop search — synonym matching + local cache + v2 stop-finder."""
    import asyncio

    results_map: dict[str, StopSearchResult] = {}

    # 0) Check synonym/keyword matches first (instant, in-memory)
    synonym_hits = match_synonyms(q)
    synonym_names = {name.lower() for name, _ in synonym_hits}
    synonym_scores = {name.lower(): score for name, score in synonym_hits}

    async def local_search():
        """Fast local search from cached sites, boosted by synonym data"""
        try:
            sites = await get_cached_sites()
            for site in sites:
                site_name = site.get("name", "")
                site_name_lower = site_name.lower()

                # Check if this site matches a synonym hit
                syn_score = 0
                for syn_name in synonym_names:
                    if syn_name == site_name_lower or syn_name in site_name_lower or site_name_lower.startswith(syn_name):
                        syn_score = synonym_scores.get(syn_name, 0)
                        break

                sc = score_match(q, site_name)

                # Use the higher of synonym score or direct match score
                final_score = max(sc, syn_score)

                if final_score > 0:
                    sid = str(site.get("id", ""))
                    results_map[sid] = StopSearchResult(
                        id=sid,
                        name=site_name,
                        global_id=str(site.get("gid", "")) if site.get("gid") else None,
                        locality=site.get("note") or None,
                        type=site.get("type", "STOP"),
                        lat=site.get("lat"),
                        lon=site.get("lon"),
                        score=final_score,
                    )
        except Exception as exc:
            logger.warning(f"Local search failed: {exc}")

    async def v2_search():
        """SL v2 stop-finder for fuzzy matching + global IDs + locality"""
        try:
            async with httpx.AsyncClient(timeout=3.0) as http:
                response = await http.get(
                    f"{SL_JOURNEYPLANNER_V2_BASE}/stop-finder",
                    params={"name_sf": q, "type_sf": "any", "any_obj_filter_sf": 2},
                )
                if response.status_code == 200:
                    data = response.json()
                    for loc in data.get("locations", []):
                        global_id = loc.get("id", "")
                        name = loc.get("disassembledName") or loc.get("name", "")
                        props = loc.get("properties", {})
                        short_id = props.get("stopId", "")
                        if short_id.startswith("18"):
                            short_id = short_id[2:]
                        short_id = short_id.lstrip("0") or short_id
                        coords = loc.get("coord", [None, None])
                        match_q = loc.get("matchQuality", 0)
                        locality = props.get("mainLocality") or loc.get("parent", {}).get("name")

                        if short_id and short_id not in results_map:
                            results_map[short_id] = StopSearchResult(
                                id=short_id, name=name, global_id=global_id,
                                locality=locality, type="STOP",
                                lat=coords[0] if len(coords) > 0 else None,
                                lon=coords[1] if len(coords) > 1 else None,
                                score=match_q,
                            )
                        elif short_id and short_id in results_map:
                            existing = results_map[short_id]
                            existing.global_id = global_id
                            if not existing.locality:
                                existing.locality = locality
                            if match_q > 0 and existing.score is not None:
                                existing.score = max(existing.score, match_q)
        except Exception as exc:
            logger.warning(f"V2 stop-finder failed/timed out: {exc}")

    # Run both searches in parallel, but don't wait for v2 if it's slow
    local_task = asyncio.create_task(local_search())
    v2_task = asyncio.create_task(v2_search())

    # Run local search first (instant), then wait for v2 to enrich with locality
    await local_task

    if len(results_map) == 0:
        # No local results - wait for v2 (up to 3s)
        try:
            await asyncio.wait_for(asyncio.shield(v2_task), timeout=3.0)
        except asyncio.TimeoutError:
            logger.info("V2 stop-finder timed out")
    else:
        # Have local results - wait up to 1.5s for v2 to add locality info
        try:
            await asyncio.wait_for(asyncio.shield(v2_task), timeout=1.5)
        except asyncio.TimeoutError:
            pass  # Return local results without v2 enrichment

    results = sorted(results_map.values(), key=lambda r: r.score or 0, reverse=True)
    return results[:15]


@api_router.get("/departures/{site_id}", response_model=DeparturesResponse)
async def get_departures(
    site_id: str, forecast: int = Query(60, description="Forecast in minutes")
):
    """Get real-time departures for a specific stop/station"""
    try:
        async with await get_http_client() as http:
            response = await http.get(
                f"{SL_TRANSPORT_BASE}/sites/{site_id}/departures",
                params={"forecast": forecast},
            )

            if response.status_code == 404:
                raise HTTPException(status_code=404, detail="Stop not found")

            if response.status_code != 200:
                logger.error(f"SL API error: {response.status_code}")
                if 400 <= response.status_code < 500:
                    raise HTTPException(status_code=404, detail="Stop not found or invalid ID")
                raise HTTPException(status_code=502, detail="Failed to fetch departures")

            data = response.json()
            departures = []
            raw_departures = data.get("departures", [])

            site_name = f"Stop {site_id}"
            if raw_departures and raw_departures[0].get("stop_area"):
                site_name = raw_departures[0]["stop_area"].get("name", site_name)

            for dep in raw_departures:
                line_info = dep.get("line", {})
                transport_mode = line_info.get("transport_mode", "BUS")
                scheduled = dep.get("scheduled")
                expected = dep.get("expected")
                display = dep.get("display", "")

                departures.append(
                    Departure(
                        line=line_info.get("designation", "?"),
                        destination=dep.get("destination", "Unknown"),
                        display_time=display or calculate_display_time(expected or scheduled),
                        scheduled=scheduled,
                        expected=expected,
                        transport_mode=transport_mode,
                        deviations=[d.get("message", "") for d in dep.get("deviations", [])]
                        if dep.get("deviations")
                        else None,
                    )
                )

            departures.sort(key=lambda x: x.expected or x.scheduled or "9999")

            return DeparturesResponse(
                site_id=site_id,
                site_name=site_name,
                departures=departures[:30],
            )

    except httpx.RequestError as exc:
        logger.error(f"HTTP request error: {exc}")
        raise HTTPException(status_code=502, detail="Failed to connect to SL API")


def calculate_display_time(time_str: Optional[str]) -> str:
    """Calculate display time from ISO timestamp"""
    if not time_str:
        return "?"
    try:
        dt = datetime.fromisoformat(time_str.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        diff = (dt - now).total_seconds() / 60

        if diff < 1:
            return "Nu"
        elif diff < 60:
            return f"{int(diff)} min"
        else:
            return dt.strftime("%H:%M")
    except Exception:
        return time_str


@api_router.get("/trips", response_model=TripPlanResponse)
async def plan_trip(
    origin_id: str = Query(..., description="Origin stop global ID"),
    dest_id: str = Query(..., description="Destination stop global ID"),
    date: Optional[str] = Query(None, description="Date in YYYY-MM-DD format (default: today)"),
    time: Optional[str] = Query(None, description="Time in HH:MM format (default: now)"),
    time_type: Optional[str] = Query("departure", description="Time type: 'departure' or 'arrival'"),
    num_trips: Optional[int] = Query(3, description="Number of trip options (max 3)"),
    transport_modes: Optional[str] = Query(None, description="Comma-separated transport modes: BUS,METRO,TRAIN,TRAM,SHIP"),
):
    """Plan a trip using SL Journey Planner v2 with advanced options"""
    try:
        async with await get_http_client() as http:
            params = {
                "name_origin": origin_id,
                "name_destination": dest_id,
                "type_origin": "any",
                "type_destination": "any",
                "calc_number_of_trips": min(num_trips, 3),
                "format": "json",
            }

            # Add date/time if provided
            if date:
                params["date"] = date
            if time:
                params["time"] = time
            if time_type in ["departure", "arrival"]:
                params["time_type"] = time_type

            # Add transport mode filter if provided
            if transport_modes:
                # Map to SL's format
                mode_map = {
                    "BUS": "bus",
                    "METRO": "metro",
                    "TRAIN": "train",
                    "TRAM": "tram",
                    "SHIP": "ship",
                }
                modes = [mode_map.get(m.upper(), m.lower()) for m in transport_modes.split(",")]
                params["transport_modes"] = ",".join(modes)

            response = await http.get(
                f"{SL_JOURNEYPLANNER_V2_BASE}/trips", params=params
            )

            logger.info(f"SL API response status: {response.status_code}")
            logger.info(f"SL API params: {params}")
            logger.info(f"SL API response text: {response.text[:500]}")

            if response.status_code != 200:
                logger.error(f"Journey planner error: {response.status_code}")
                logger.error(f"Response: {response.text}")
                return TripPlanResponse(trips=[])

            data = response.json()
            logger.info(f"SL API data keys: {data.keys() if isinstance(data, dict) else type(data)}")
            logger.info(f"SL API journeys count: {len(data.get('journeys', [])) if isinstance(data, dict) else 'N/A'}")
            trips = []

            for journey in data.get("journeys", []):
                legs = []
                for leg in journey.get("legs", []):
                    origin_data = leg.get("origin", {})
                    dest_data = leg.get("destination", {})
                    transport = leg.get("transportation", {})
                    product = transport.get("product", {})

                    # Get stop names (parent has the nice name)
                    origin_parent = origin_data.get("parent", {})
                    dest_parent = dest_data.get("parent", {})
                    origin_name = origin_parent.get("disassembledName") or origin_parent.get("name", origin_data.get("name", "?"))
                    dest_name = dest_parent.get("disassembledName") or dest_parent.get("name", dest_data.get("name", "?"))

                    # Get coordinates
                    origin_lat = origin_data.get("lat")
                    origin_lon = origin_data.get("lon")
                    dest_lat = dest_data.get("lat")
                    dest_lon = dest_data.get("lon")

                    # Get times
                    dep_time = origin_data.get("departureTimeEstimated") or origin_data.get("departureTimePlanned", "")
                    arr_time = dest_data.get("arrivalTimeEstimated") or dest_data.get("arrivalTimePlanned", "")

                    # Format times to HH:MM
                    dep_display = format_time(dep_time)
                    arr_display = format_time(arr_time)

                    # Calculate duration
                    duration = leg.get("duration", 0)
                    duration_min = duration // 60 if duration else 0

                    # Transport mode
                    product_name = product.get("name", "")
                    line_name = transport.get("disassembledName") or transport.get("number", "")

                    # Map SL product names to transport modes
                    if "tunnelbana" in product_name.lower():
                        mode = "METRO"
                    elif "buss" in product_name.lower() or "bus" in product_name.lower():
                        mode = "BUS"
                    elif "pendeltåg" in product_name.lower() or "tåg" in product_name.lower():
                        mode = "TRAIN"
                    elif "spårvagn" in product_name.lower() or "tram" in product_name.lower():
                        mode = "TRAM"
                    elif "båt" in product_name.lower() or "färja" in product_name.lower():
                        mode = "SHIP"
                    elif not line_name:
                        mode = "WALK"
                    else:
                        mode = "BUS"

                    legs.append(
                        TripLeg(
                            origin=origin_name,
                            destination=dest_name,
                            line=line_name if line_name else None,
                            transport_mode=mode,
                            departure_time=dep_display,
                            arrival_time=arr_display,
                            duration_minutes=duration_min,
                            origin_lat=origin_lat,
                            origin_lon=origin_lon,
                            dest_lat=dest_lat,
                            dest_lon=dest_lon,
                        )
                    )

                if legs:
                    total_duration = journey.get("tripRtDuration") or journey.get("tripDuration", 0)
                    trips.append(
                        Trip(
                            legs=legs,
                            total_duration=total_duration // 60,
                            departure_time=legs[0].departure_time,
                            arrival_time=legs[-1].arrival_time,
                            interchanges=journey.get("interchanges", 0),
                        )
                    )

            return TripPlanResponse(trips=trips)

    except httpx.RequestError as exc:
        logger.error(f"HTTP request error: {exc}")
        raise HTTPException(status_code=502, detail="Failed to connect to SL API")


def format_time(iso_str: str) -> str:
    """Format ISO time to HH:MM"""
    if not iso_str:
        return "?"
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        return dt.strftime("%H:%M")
    except Exception:
        return iso_str


@api_router.get("/lines")
async def get_lines(
    transport_mode: Optional[str] = Query(None, description="Filter: BUS, METRO, TRAIN, TRAM")
):
    """Get all lines, optionally filtered by transport mode"""
    try:
        async with await get_http_client() as http:
            response = await http.get(
                f"{SL_TRANSPORT_BASE}/lines",
                params={"transport_authority_id": 1},
            )
            if response.status_code != 200:
                raise HTTPException(status_code=502, detail="Failed to fetch lines")

            data = response.json()
            lines = data if isinstance(data, list) else data.get("lines", [])

            if transport_mode:
                lines = [
                    line
                    for line in lines
                    if line.get("transport_mode", "").upper() == transport_mode.upper()
                ]

            return {"lines": lines[:100]}

    except httpx.RequestError as exc:
        logger.error(f"HTTP request error: {exc}")
        raise HTTPException(status_code=502, detail="Failed to connect to SL API")


@api_router.get("/nearby")
async def nearby_stops(
    lat: float = Query(..., description="Latitude"),
    lon: float = Query(..., description="Longitude"),
    radius: int = Query(1000, description="Radius in meters"),
):
    """Find nearby stops using cached sites list and distance calculation"""
    import math

    def haversine(lat1, lon1, lat2, lon2):
        R = 6371000  # Earth radius in meters
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlam = math.radians(lon2 - lon1)
        a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
        return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    try:
        sites = await get_cached_sites()
        nearby = []

        for site in sites:
            s_lat = site.get("lat")
            s_lon = site.get("lon")
            if s_lat is None or s_lon is None:
                continue

            dist = haversine(lat, lon, s_lat, s_lon)
            if dist <= radius:
                nearby.append(
                    {
                        "id": str(site.get("id", "")),
                        "name": site.get("name", ""),
                        "locality": site.get("note") or None,
                        "lat": s_lat,
                        "lon": s_lon,
                        "distance": round(dist),
                    }
                )

        nearby.sort(key=lambda x: x["distance"])
        return {"stops": nearby[:20]}

    except Exception as exc:
        logger.error(f"Nearby search error: {exc}")
        raise HTTPException(status_code=502, detail="Failed to find nearby stops")


# ── App setup ────────────────────────────────────────────────────

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    """Pre-warm the sites cache on startup for instant first searches"""
    try:
        await get_cached_sites()
        logger.info("Sites cache pre-warmed successfully")
    except Exception as exc:
        logger.warning(f"Failed to pre-warm sites cache: {exc}")
