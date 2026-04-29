# SL Sök - Stockholm Transit Search App

## Problem Statement
Build an app that can search buses in Stockholm's länstrafik better than the official app using Trafiklab's free API.

## Architecture
- **Backend**: FastAPI proxy for Trafiklab APIs (SL Transport v1 + SL Journey Planner v2)
- **Frontend**: React with Shadcn UI, dark terminal theme
- **Database**: MongoDB (available but not heavily used - local storage for favorites)
- **APIs**: No API keys required

## Core Requirements
- Fast station search with autocomplete (better than native SL app)
- Real-time departures board
- Trip planner
- Favorites with local storage
- Dark theme

## What's Been Implemented (2026-04-15 → 2026-04-20)
- Smart search with Swedish character normalization (å→a, ä→a, ö→o)
- Dual-source search: cached sites list + SL v2 stop-finder with relevance scoring
- **Stop disambiguation with locality (ort)** - stops show municipality (e.g. "Alby centrum (Botkyrka)")
- Real-time departures from SL Transport API
- **Transport mode filter** on departures board (Alla, Buss, Tunnelbana, Pendeltåg, Spårvagn, Båt)
- Trip planner using SL Journey Planner v2
- Favorites with localStorage persistence
- **Recent searches history** (last 8, persisted in localStorage, with clear button)
- **Nearby stops** using browser geolocation + haversine distance calculation
- **Leaflet map view** in "Nära mig" with dark CARTO tiles, user location, 1km radius, stop markers with popups
- **Departure notifications** using Browser Notification API with bell toggle per departure
- **Map → Departures flow**: clicking any stop (map popup, list, search) navigates to departures
- Dark terminal-themed UI (Chivo + IBM Plex Sans fonts)
- Auto-refresh departures every 30 seconds
- Pre-warmed sites cache on startup
- AbortController pattern for race-condition-free search

## Prioritized Backlog
- P0: ✅ All core features implemented
- P1: ✅ Transport mode filter - DONE
- P1: ✅ Recent searches history - DONE
- P1: ✅ Stop disambiguation with locality - DONE
- P1: ✅ Nearby stops with geolocation - DONE
- P1: ✅ Map view with Leaflet - DONE
- P1: ✅ Departure notifications - DONE
- P1: ✅ Nearby → Departures navigation - DONE
- P2: Offline mode with service worker
- P2: Commuter clock (daily route auto-alerts)
