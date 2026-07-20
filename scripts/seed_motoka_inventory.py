#!/usr/bin/env python3
"""
Motoka inventory ingestion via RockAuto (rockauto-api).

Fetches structured auto-parts for high-volume Nigerian-market vehicles,
converts USD → NGN with configurable FX + markup, and upserts into the
Ladipo Supabase schema used by Motoka:

  ladipo_parts
  ladipo_part_inventory
  ladipo_part_compatibility

Matches backend rules in:
  - src/controllers/adminLadipo.controller.js (normalizeProductPayload)
  - src/services/ladipo/ladipo.service.js (upsertCompatibilityEntries)
  - scripts/lib/ladipoCanonicalCategories.js (canonical category UUIDs)
  - supabase/migrations/065_ladipo_catalog_reseed.sql

Usage (local validation — Camry + C300 only by default):
  .venv-seed/bin/python scripts/seed_motoka_inventory.py --dry-run
  .venv-seed/bin/python scripts/seed_motoka_inventory.py --limit 50

Production / full Nigerian fleet (after local is proven):
  .venv-seed/bin/python scripts/seed_motoka_inventory.py --full --years-per-model 2

Env (from repo .env or process):
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
"""

from __future__ import annotations

import argparse
import asyncio
import os
import random
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlparse

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    load_dotenv = None

try:
    from rockauto_api import RockAutoClient
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "Missing rockauto-api. Install with:\n"
        "  python3 -m venv .venv-seed && "
        ".venv-seed/bin/pip install -r scripts/requirements-motoka-inventory.txt"
    ) from exc

try:
    from supabase import Client, create_client
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "Missing supabase-py. Install with:\n"
        "  .venv-seed/bin/pip install -r scripts/requirements-motoka-inventory.txt"
    ) from exc


# ---------------------------------------------------------------------------
# Configurable market localization (override via CLI)
# ---------------------------------------------------------------------------

DEFAULT_EXCHANGE_RATE = 1600.0  # NGN per 1 USD
DEFAULT_MARKUP_FACTOR = 1.35  # shipping + clearing + platform
DEFAULT_ROUND_TO = 100  # nearest ₦100 (use 1000 for nearest thousand)
DEFAULT_STOCK_QTY = 50
DEFAULT_SELLER_LABEL = "Motoka"
DEFAULT_CONDITION = "new"  # DB enum: new | tokunbo | nigerian_used
DEFAULT_REQUEST_DELAY = 2.5  # seconds between model fetches
DEFAULT_PARTS_PER_CATEGORY = 12
DEFAULT_LIMIT = 200

# Canonical category UUIDs from migration 065 / ladipoCanonicalCategories.js
CANONICAL = {
    "SPARE_PARTS": "c1000000-0000-0000-0000-000000000001",
    "BRAKE_WHEEL_HUB": "c1000000-0000-0000-0000-000000000002",
    "SUSPENSION": "c1000000-0000-0000-0000-000000000003",
    "ENGINE_PARTS": "c1000000-0000-0000-0000-000000000004",
    "STEERING_PARTS": "c1000000-0000-0000-0000-000000000005",
    "EXHAUST": "c1000000-0000-0000-0000-000000000006",
    "SERVICING_PARTS": "c1000000-0000-0000-0000-000000000007",
    "OIL_FILTER": "c1000000-0000-0000-0000-000000000008",
    "AIR_FILTER": "c1000000-0000-0000-0000-000000000009",
    "SPARK_PLUGS": "c1000000-0000-0000-0000-000000000010",
    "FUEL_FILTER": "c1000000-0000-0000-0000-000000000011",
    "TIMING_BELTS": "c1000000-0000-0000-0000-000000000012",
    "LUBRICANTS_FLUIDS": "c1000000-0000-0000-0000-000000000013",
    "ENGINE_OIL": "c1000000-0000-0000-0000-000000000014",
    "GEAR_OIL": "c1000000-0000-0000-0000-000000000015",
    "BRAKE_FLUID_COOLANT": "c1000000-0000-0000-0000-000000000016",
    "TYRES_WHEELS": "c1000000-0000-0000-0000-000000000017",
    "CAR_TYRES": "c1000000-0000-0000-0000-000000000018",
    "ALLOY_WHEELS": "c1000000-0000-0000-0000-000000000019",
    "ELECTRICAL_BATTERIES": "c1000000-0000-0000-0000-000000000020",
    "CAR_BATTERIES": "c1000000-0000-0000-0000-000000000021",
    "BULBS_LIGHTING": "c1000000-0000-0000-0000-000000000022",
    "ALTERNATORS": "c1000000-0000-0000-0000-000000000023",
    "CAR_ACCESSORIES": "c1000000-0000-0000-0000-000000000024",
    "INTERIOR": "c1000000-0000-0000-0000-000000000025",
    "EXTERIOR": "c1000000-0000-0000-0000-000000000026",
}

# Display paths matching Motoka taxonomy (parent · leaf)
CATEGORY_PATH = {
    CANONICAL["BRAKE_WHEEL_HUB"]: "Spare Parts · Brake & Wheel Hub/Bearings",
    CANONICAL["SUSPENSION"]: "Spare Parts · Suspension Parts",
    CANONICAL["ENGINE_PARTS"]: "Spare Parts · Engine Parts",
    CANONICAL["STEERING_PARTS"]: "Spare Parts · Steering Parts",
    CANONICAL["EXHAUST"]: "Spare Parts · Exhaust System",
    CANONICAL["OIL_FILTER"]: "Servicing Parts · Oil Filter",
    CANONICAL["AIR_FILTER"]: "Servicing Parts · Air Filter",
    CANONICAL["SPARK_PLUGS"]: "Servicing Parts · Spark Plugs",
    CANONICAL["FUEL_FILTER"]: "Servicing Parts · Fuel Filter",
    CANONICAL["TIMING_BELTS"]: "Servicing Parts · Timing Belts & Kits",
    CANONICAL["ENGINE_OIL"]: "Lubricants / Fluids · Engine Oil",
    CANONICAL["GEAR_OIL"]: "Lubricants / Fluids · Gear Oil & ATF",
    CANONICAL["BRAKE_FLUID_COOLANT"]: "Lubricants / Fluids · Brake Fluid & Coolant",
    CANONICAL["CAR_TYRES"]: "Tyres & Wheels · Car Tyres",
    CANONICAL["ALLOY_WHEELS"]: "Tyres & Wheels · Alloy Wheels & Hubcaps",
    CANONICAL["CAR_BATTERIES"]: "Electrical & Batteries · Car Batteries",
    CANONICAL["BULBS_LIGHTING"]: "Electrical & Batteries · Bulbs & Lighting",
    CANONICAL["ALTERNATORS"]: "Electrical & Batteries · Alternators & Starters",
    CANONICAL["INTERIOR"]: "Car Accessories · Interior Accessories",
    CANONICAL["EXTERIOR"]: "Car Accessories · Exterior Accessories",
    CANONICAL["SPARE_PARTS"]: "Spare Parts",
}

# RockAuto category group names → Motoka category_id
ROCKAUTO_CATEGORY_MAP: Dict[str, str] = {
    "Brake & Wheel Hub": CANONICAL["BRAKE_WHEEL_HUB"],
    "Suspension": CANONICAL["SUSPENSION"],
    "Engine": CANONICAL["ENGINE_PARTS"],
    "Steering": CANONICAL["STEERING_PARTS"],
    "Exhaust & Emission": CANONICAL["EXHAUST"],
    "Air & Fuel Delivery": CANONICAL["AIR_FILTER"],
    "Belts & Cooling": CANONICAL["TIMING_BELTS"],
    "Electrical": CANONICAL["ALTERNATORS"],
    "Ignition": CANONICAL["SPARK_PLUGS"],
    "Transmission-Automatic": CANONICAL["GEAR_OIL"],
    "Transmission-Manual": CANONICAL["GEAR_OIL"],
    "Wheels & Tires": CANONICAL["CAR_TYRES"],
    "Body & Lamp Assembly": CANONICAL["BULBS_LIGHTING"],
    "Cooling System": CANONICAL["ENGINE_PARTS"],
    "Belts": CANONICAL["TIMING_BELTS"],
    "Fuel & Air": CANONICAL["FUEL_FILTER"],
}

# ---------------------------------------------------------------------------
# Vehicle sets
# ---------------------------------------------------------------------------
# LOCAL (default): Camry + C300 only — use this while validating prices,
# images, fitment, and Supabase upserts before involving the prod team.
#
# PRODUCTION (--full): broader Nigerian tokunbo fleet. Prod can pull and run
# with --full once local validation is done.
# RockAuto encodes spaces in model names as '+' (e.g. LAND+CRUISER, G63+AMG).

LOCAL_TEST_VEHICLES: List[Tuple[str, str, List[int]]] = [
    ("TOYOTA", "CAMRY", [2015, 2018]),
    ("MERCEDES-BENZ", "C300", [2015, 2018]),
]

PRODUCTION_VEHICLES: List[Tuple[str, str, List[int]]] = [
    # Toyota — dominant tokunbo fleet
    ("TOYOTA", "CAMRY", [2012, 2015, 2018]),
    ("TOYOTA", "COROLLA", [2014, 2016, 2019]),
    ("TOYOTA", "HIGHLANDER", [2014, 2017, 2020]),
    ("TOYOTA", "RAV4", [2015, 2018, 2020]),
    ("TOYOTA", "SIENNA", [2013, 2016, 2018]),
    ("TOYOTA", "AVALON", [2013, 2016, 2018]),
    ("TOYOTA", "HILUX", [2012, 2016, 2019]),
    ("TOYOTA", "LAND+CRUISER", [2012, 2015, 2018]),
    # Honda
    ("HONDA", "ACCORD", [2013, 2016, 2018]),
    ("HONDA", "CIVIC", [2014, 2016, 2019]),
    ("HONDA", "CR-V", [2014, 2017, 2019]),
    ("HONDA", "PILOT", [2013, 2016, 2019]),
    # Lexus
    ("LEXUS", "ES350", [2013, 2016, 2019]),
    ("LEXUS", "RX350", [2013, 2016, 2019]),
    ("LEXUS", "GX460", [2014, 2017, 2020]),
    # Mercedes-Benz — C / E / G class + popular SUVs
    ("MERCEDES-BENZ", "C250", [2012, 2015, 2017]),
    ("MERCEDES-BENZ", "C300", [2012, 2015, 2018]),
    ("MERCEDES-BENZ", "C350", [2012, 2014, 2015]),
    ("MERCEDES-BENZ", "E300", [2014, 2016, 2018]),
    ("MERCEDES-BENZ", "E350", [2012, 2015, 2017]),
    ("MERCEDES-BENZ", "G550", [2013, 2016, 2019]),
    ("MERCEDES-BENZ", "G63+AMG", [2013, 2016, 2019]),
    ("MERCEDES-BENZ", "GLK350", [2012, 2014, 2015]),
    ("MERCEDES-BENZ", "ML350", [2012, 2014, 2015]),
    # Nissan
    ("NISSAN", "ALTIMA", [2013, 2016, 2018]),
    ("NISSAN", "PATHFINDER", [2013, 2016, 2018]),
    ("NISSAN", "X-TRAIL", [2014, 2016, 2018]),
    # Peugeot — strong older-fleet presence
    ("PEUGEOT", "307", [2006, 2008, 2010]),
    ("PEUGEOT", "406", [2002, 2004, 2005]),
    # Hyundai / Kia
    ("HYUNDAI", "SONATA", [2014, 2016, 2018]),
    ("HYUNDAI", "ELANTRA", [2014, 2016, 2018]),
    ("HYUNDAI", "TUCSON", [2014, 2016, 2018]),
    ("KIA", "SPORTAGE", [2014, 2016, 2018]),
    ("KIA", "SORENTO", [2014, 2016, 2018]),
    # BMW / Ford / Acura (common tokunbo)
    ("BMW", "328I", [2012, 2014, 2016]),
    ("BMW", "528I", [2012, 2014, 2016]),
    ("BMW", "X5", [2012, 2015, 2018]),
    ("FORD", "EXPLORER", [2013, 2016, 2018]),
    ("FORD", "EDGE", [2013, 2016, 2018]),
    ("ACURA", "MDX", [2012, 2014, 2017]),
]

# Back-compat alias
TARGET_VEHICLES = LOCAL_TEST_VEHICLES

# Extra garage-facing model labels written alongside the RockAuto model so
# users who saved "C-Class" / "E-Class" / "G-Wagon" still match fitment.
# (Spaces/hyphens are normalised away by ladipo_fitment_key, so one class
# label is enough — e.g. "C-Class" also matches garage "C Class".)
MODEL_FITMENT_ALIASES: Dict[str, List[str]] = {
    "C250": ["C-Class", "C250"],
    "C300": ["C-Class", "C300"],
    "C350": ["C-Class", "C350"],
    "E300": ["E-Class", "E300"],
    "E350": ["E-Class", "E350"],
    "G550": ["G-Class", "G-Wagon", "G550"],
    "G63 AMG": ["G-Class", "G-Wagon", "G63 AMG", "G63"],
    "GLK350": ["GLK", "GLK350", "GLK-Class"],
    "ML350": ["ML", "ML350", "M-Class"],
    "LAND CRUISER": ["Land Cruiser", "Landcruiser", "Prado"],
    "CR-V": ["CR-V", "CRV"],
    "X-TRAIL": ["X-Trail", "XTrail"],
    "328I": ["328i", "3-Series"],
    "528I": ["528i", "5-Series"],
}

# RockAuto categories to scrape per vehicle (keeps volume focused).
# Listing pages are usually subcategory indexes; we drill into each
# subcategory URL to get priced parts + images.
TARGET_ROCKAUTO_CATEGORIES = [
    "Brake & Wheel Hub",
    "Suspension",
    "Engine",
    "Steering",
    "Electrical",
    "Ignition",
    "Cooling System",
    "Exhaust & Emission",
]

# Brands treated as OES / OEM for part_type inference
OES_BRANDS = {
    "DENSO",
    "AISIN",
    "NGK",
    "BOSCH",
    "ACDELCO",
    "MOTORCRAFT",
    "MOOG",
    "GATES",
    "DAYCO",
    "MANN-FILTER",
    "WIX",
    "FRAM",
}
OEM_BRAND_MARKERS = ("OE ", " O.E.", "OEM", "GENUINE")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def load_env() -> None:
    if load_dotenv is None:
        return
    root = Path(__file__).resolve().parent.parent
    load_dotenv(root / ".env")


def slugify(value: str, max_len: int = 180) -> str:
    text = re.sub(r"[^a-z0-9]+", "-", (value or "").lower().strip())
    text = re.sub(r"-+", "-", text).strip("-")
    return text[:max_len] or "part"


def parse_usd_price(raw: Optional[str]) -> Optional[float]:
    if not raw:
        return None
    match = re.search(r"([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)", str(raw))
    if not match:
        return None
    try:
        return float(match.group(1).replace(",", ""))
    except ValueError:
        return None


def usd_to_ngn_kobo(
    usd: float,
    exchange_rate: float,
    markup: float,
    round_to: int,
) -> int:
    """Convert USD → NGN (rounded) → kobo integer for ladipo_part_inventory.price_kobo."""
    naira = float(usd) * float(exchange_rate) * float(markup)
    step = max(int(round_to), 1)
    rounded = int(round(naira / step) * step)
    if rounded < step:
        rounded = step
    return int(rounded) * 100


def https_only(url: Optional[str]) -> Optional[str]:
    if not url or not isinstance(url, str):
        return None
    try:
        parsed = urlparse(url.strip())
    except Exception:
        return None
    if parsed.scheme != "https" or not parsed.netloc:
        return None
    return url.strip()


def infer_part_type(brand: Optional[str], name: str) -> str:
    """Return DB enum: oem | oes | aftermarket."""
    blob = f"{brand or ''} {name}".upper()
    if any(marker in blob for marker in OEM_BRAND_MARKERS):
        return "oem"
    clean_brand = (brand or "").strip().upper()
    if clean_brand in OES_BRANDS:
        return "oes"
    return "aftermarket"


def build_display_name(brand: Optional[str], description: str, part_number: str) -> str:
    """NAME: [Brand] [Part Description] ([Part Number/OEM Specs]) — max 255."""
    brand_bit = (brand or "").strip()
    desc = (description or "").strip() or "Auto Part"
    pn = (part_number or "").strip()
    if brand_bit and not desc.upper().startswith(brand_bit.upper()):
        base = f"{brand_bit} {desc}"
    else:
        base = desc
    if pn and pn.upper() not in base.upper():
        name = f"{base} ({pn})"
    else:
        name = base
    return name[:255]


def rockauto_model_to_display(model: str) -> str:
    """Convert RockAuto model tokens (LAND+CRUISER) into garage-friendly labels."""
    return (model or "").replace("+", " ").strip()


def title_case_make_model(make: str, model: str) -> Tuple[str, str]:
    make_key = (make or "").upper().replace(" ", "-")
    make_map = {
        "TOYOTA": "Toyota",
        "HONDA": "Honda",
        "LEXUS": "Lexus",
        "MERCEDES-BENZ": "Mercedes-Benz",
        "NISSAN": "Nissan",
        "PEUGEOT": "Peugeot",
        "HYUNDAI": "Hyundai",
        "KIA": "Kia",
        "BMW": "BMW",
        "FORD": "Ford",
        "ACURA": "Acura",
        "INFINITI": "Infiniti",
    }
    display_model = rockauto_model_to_display(model)
    model_map = {
        "CAMRY": "Camry",
        "COROLLA": "Corolla",
        "HIGHLANDER": "Highlander",
        "RAV4": "RAV4",
        "SIENNA": "Sienna",
        "AVALON": "Avalon",
        "HILUX": "Hilux",
        "LAND CRUISER": "Land Cruiser",
        "ACCORD": "Accord",
        "CIVIC": "Civic",
        "CR-V": "CR-V",
        "PILOT": "Pilot",
        "ES350": "ES350",
        "RX350": "RX350",
        "GX460": "GX460",
        "C250": "C250",
        "C300": "C300",
        "C350": "C350",
        "E300": "E300",
        "E350": "E350",
        "G550": "G550",
        "G63 AMG": "G63 AMG",
        "GLK350": "GLK350",
        "ML350": "ML350",
        "ALTIMA": "Altima",
        "PATHFINDER": "Pathfinder",
        "X-TRAIL": "X-Trail",
        "307": "307",
        "406": "406",
        "SONATA": "Sonata",
        "ELANTRA": "Elantra",
        "TUCSON": "Tucson",
        "SPORTAGE": "Sportage",
        "SORENTO": "Sorento",
        "328I": "328i",
        "528I": "528i",
        "X5": "X5",
        "EXPLORER": "Explorer",
        "EDGE": "Edge",
        "MDX": "MDX",
    }
    return (
        make_map.get(make_key, make.replace("-", " ").title().replace("Benz", "Benz")),
        model_map.get(display_model.upper(), display_model),
    )


def fitment_model_aliases(display_model: str) -> List[str]:
    """Return garage-facing model strings to store for a scraped RockAuto model."""
    key = rockauto_model_to_display(display_model).upper()
    aliases = MODEL_FITMENT_ALIASES.get(key)
    if aliases:
        # Preserve order, drop dupes
        seen = set()
        out = []
        for alias in aliases:
            norm = alias.strip()
            if norm and norm.lower() not in seen:
                seen.add(norm.lower())
                out.append(norm)
        return out
    return [rockauto_model_to_display(display_model)]


@dataclass
class CompatibilityYear:
    years: set = field(default_factory=set)

    def add(self, year: int) -> None:
        self.years.add(int(year))

    def as_entry(self, make: str, model: str) -> Dict[str, Any]:
        years = sorted(self.years)
        return {
            "make": make,
            "model": model,
            "year_min": years[0] if years else None,
            "year_max": years[-1] if years else None,
        }


@dataclass
class AggregatedPart:
    brand: str
    part_number: str
    name: str
    description: str
    category_id: str
    category_path: str
    rockauto_category: str
    part_type: str
    condition: str
    price_kobo: int
    usd_price: float
    image_url: Optional[str]
    source_url: Optional[str]
    sku: str
    slug: str
    compatibility: Dict[Tuple[str, str], CompatibilityYear] = field(default_factory=dict)

    def add_fitment(self, make: str, model: str, year: int) -> None:
        for alias in fitment_model_aliases(model):
            key = (make, alias)
            if key not in self.compatibility:
                self.compatibility[key] = CompatibilityYear()
            self.compatibility[key].add(year)

    def compatibility_entries(self) -> List[Dict[str, Any]]:
        return [bucket.as_entry(make, model) for (make, model), bucket in self.compatibility.items()]


# ---------------------------------------------------------------------------
# Scraping
# ---------------------------------------------------------------------------


async def polite_delay(base: float, jitter: float = 0.75) -> None:
    """Defensive pause between RockAuto requests to reduce CAPTCHA / disconnect risk."""
    wait = max(0.5, base + random.uniform(-jitter, jitter))
    await asyncio.sleep(wait)


async def with_retry(label: str, coro_factory, retries: int = 3, base_delay: float = 2.0):
    """Retry transient RockAuto failures with exponential backoff."""
    last_exc: Optional[Exception] = None
    for attempt in range(1, retries + 1):
        try:
            return await coro_factory()
        except Exception as exc:
            last_exc = exc
            msg = str(exc).lower()
            transient = any(
                token in msg
                for token in (
                    "disconnected",
                    "timeout",
                    "timed out",
                    "503",
                    "502",
                    "429",
                    "captcha",
                    "temporarily",
                    "connection",
                )
            )
            if attempt >= retries or not transient:
                break
            wait = base_delay * (2 ** (attempt - 1)) + random.uniform(0.2, 1.2)
            print(f"    ~ retry {attempt}/{retries} {label} after {wait:.1f}s ({exc})")
            await asyncio.sleep(wait)
    assert last_exc is not None
    raise last_exc


def part_has_price(part: Any) -> bool:
    return parse_usd_price(getattr(part, "price", None)) is not None


def subcategory_url(part: Any) -> Optional[str]:
    url = getattr(part, "url", None) or getattr(part, "info_url", None)
    if not url or not isinstance(url, str):
        return None
    url = url.strip()
    if not url:
        return None
    # RockAuto catalog deep-links look like /en/catalog/...
    if "rockauto.com" in url or url.startswith("/en/catalog") or "/catalog/" in url:
        return url
    if url.startswith("/") and "catalog" in url:
        return url
    return url if url.startswith("http") else None


def part_to_row(
    part: Any,
    *,
    category_name: str,
    category_id: str,
    category_path: str,
    display_make: str,
    display_model: str,
    year: int,
    exchange_rate: float,
    markup: float,
    round_to: int,
    condition: str,
) -> Optional[Dict[str, Any]]:
    usd = parse_usd_price(getattr(part, "price", None))
    if usd is None or usd <= 0:
        return None

    brand = (getattr(part, "brand", None) or "").strip() or "Generic"
    part_number = (getattr(part, "part_number", None) or "").strip() or "UNKNOWN"
    if part_number.upper() == "UNKNOWN":
        return None

    raw_name = (getattr(part, "name", None) or "").strip() or part_number
    price_kobo = usd_to_ngn_kobo(usd, exchange_rate, markup, round_to)
    display_name = build_display_name(brand, raw_name, part_number)
    sku_key = slugify(f"{brand}-{part_number}")[:40].upper()
    slug = slugify(f"{brand}-{part_number}-{category_name}")

    return {
        "brand": brand[:100],
        "part_number": part_number[:100],
        "name": display_name,
        "description": raw_name[:4000],
        "category_id": category_id,
        "category_path": category_path,
        "rockauto_category": category_name,
        "part_type": infer_part_type(brand, raw_name),
        "condition": condition,
        "price_kobo": price_kobo,
        "usd_price": usd,
        "image_url": https_only(getattr(part, "image_url", None)),
        "source_url": https_only(getattr(part, "url", None)),
        "sku": f"RA-{sku_key}"[:100],
        "slug": slug,
        "make": display_make,
        "model": display_model,
        "year": year,
    }


async def fetch_priced_parts_for_category(
    vehicle: Any,
    category_name: str,
    *,
    parts_per_category: int,
    max_subcategories: int,
    retries: int,
) -> List[Any]:
    """
    Category listings are usually subcategory indexes without prices.
    Drill into subcategory URLs to collect real priced part rows.
    """
    try:
        listing = await with_retry(
            f"list:{category_name}",
            lambda: vehicle.get_parts_by_category(category_name),
            retries=retries,
        )
    except Exception as exc:
        print(f"    ! category '{category_name}': {exc}")
        return []

    listing_parts = list(getattr(listing, "parts", []) or [])
    priced: List[Any] = [p for p in listing_parts if part_has_price(p)]
    if priced:
        return priced[:parts_per_category]

    # Treat listing entries as subcategory links and open them.
    sub_links: List[str] = []
    seen = set()
    for item in listing_parts:
        url = subcategory_url(item)
        if not url or url in seen:
            continue
        seen.add(url)
        sub_links.append(url)

    collected: List[Any] = []
    for url in sub_links[:max_subcategories]:
        if len(collected) >= parts_per_category:
            break
        try:
            detailed = await with_retry(
                f"sub:{category_name}",
                lambda u=url: vehicle.get_individual_parts_from_subcategory(u),
                retries=retries,
            )
        except Exception as exc:
            print(f"    ! subcategory {url[:80]}: {exc}")
            await polite_delay(2.0, 0.5)
            continue

        for part in getattr(detailed, "parts", []) or []:
            if not part_has_price(part):
                continue
            collected.append(part)
            if len(collected) >= parts_per_category:
                break

        await polite_delay(1.5, 0.5)

    return collected


async def fetch_parts_for_vehicle(
    client: RockAutoClient,
    make: str,
    model: str,
    year: int,
    categories: Iterable[str],
    parts_per_category: int,
    max_subcategories: int,
    exchange_rate: float,
    markup: float,
    round_to: int,
    condition: str,
    retries: int,
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    try:
        vehicle = await with_retry(
            f"vehicle:{make}/{model}/{year}",
            lambda: client.get_vehicle(make, year, model),
            retries=retries,
            base_delay=3.0,
        )
    except Exception as exc:
        print(f"  ! skip {make} {year} {model}: {exc}")
        return rows

    display_make, display_model = title_case_make_model(make, model)
    print(f"  → {display_make} {display_model} {year} ({vehicle.engine.description})")

    for category_name in categories:
        category_id = ROCKAUTO_CATEGORY_MAP.get(category_name, CANONICAL["SPARE_PARTS"])
        category_path = CATEGORY_PATH.get(category_id, "Spare Parts")

        parts = await fetch_priced_parts_for_category(
            vehicle,
            category_name,
            parts_per_category=parts_per_category,
            max_subcategories=max_subcategories,
            retries=retries,
        )
        kept = 0
        for part in parts:
            row = part_to_row(
                part,
                category_name=category_name,
                category_id=category_id,
                category_path=category_path,
                display_make=display_make,
                display_model=display_model,
                year=year,
                exchange_rate=exchange_rate,
                markup=markup,
                round_to=round_to,
                condition=condition,
            )
            if not row:
                continue
            rows.append(row)
            kept += 1

        print(
            f"    · {category_name}: kept {kept} priced parts "
            f"(from {len(parts)} fetched)"
        )
        await polite_delay(1.5, 0.5)

    return rows


def aggregate_rows(rows: List[Dict[str, Any]]) -> List[AggregatedPart]:
    """Dedupe by brand+part_number+category; merge year fitment ranges."""
    buckets: Dict[Tuple[str, str, str], AggregatedPart] = {}

    for row in rows:
        key = (row["brand"].upper(), row["part_number"].upper(), row["category_id"])
        if key not in buckets:
            buckets[key] = AggregatedPart(
                brand=row["brand"],
                part_number=row["part_number"],
                name=row["name"],
                description=row["description"],
                category_id=row["category_id"],
                category_path=row["category_path"],
                rockauto_category=row["rockauto_category"],
                part_type=row["part_type"],
                condition=row["condition"],
                price_kobo=row["price_kobo"],
                usd_price=row["usd_price"],
                image_url=row["image_url"],
                source_url=row["source_url"],
                sku=row["sku"],
                slug=row["slug"],
            )
        else:
            existing = buckets[key]
            # Prefer lower landed cost if we see the same SKU again
            if row["price_kobo"] < existing.price_kobo:
                existing.price_kobo = row["price_kobo"]
                existing.usd_price = row["usd_price"]
            if not existing.image_url and row["image_url"]:
                existing.image_url = row["image_url"]

        buckets[key].add_fitment(row["make"], row["model"], row["year"])

    return list(buckets.values())


# ---------------------------------------------------------------------------
# Supabase ingestion (matches existing JS importer pattern)
# ---------------------------------------------------------------------------


def get_supabase() -> Client:
    url = os.getenv("SUPABASE_URL", "").strip()
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        raise SystemExit(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required "
            "(set them in .env or the environment)."
        )
    return create_client(url, key)


def upsert_part(supabase: Client, part: AggregatedPart, stock_qty: int, seller_label: str) -> Optional[str]:
    part_payload = {
        "sku": part.sku,
        "slug": part.slug,
        "name": part.name,
        "description": part.description,
        "category_id": part.category_id,
        "brand": part.brand,
        "condition": part.condition,
        "part_type": part.part_type,
        "images": [part.image_url] if part.image_url else [],
        "specifications": {
            "source": "rockauto.com",
            "source_url": part.source_url,
            "part_number": part.part_number,
            "usd_price": part.usd_price,
            "price_ngn": part.price_kobo // 100,
            "category_path": part.category_path,
            "rockauto_category": part.rockauto_category,
        },
        "key_features": [],
        "is_active": True,
        "is_universal": False,
    }

    result = (
        supabase.table("ladipo_parts")
        .upsert(part_payload, on_conflict="slug")
        .execute()
    )
    data = result.data or []
    if not data:
        return None
    part_id = data[0]["id"]

    inventory_payload = {
        "part_id": part_id,
        "price_kobo": int(part.price_kobo),
        "stock_qty": int(stock_qty),
        "seller_label": seller_label[:100],
    }

    existing = (
        supabase.table("ladipo_part_inventory")
        .select("id")
        .eq("part_id", part_id)
        .limit(1)
        .execute()
    )
    if existing.data:
        supabase.table("ladipo_part_inventory").update(
            {
                "price_kobo": inventory_payload["price_kobo"],
                "stock_qty": inventory_payload["stock_qty"],
                "seller_label": inventory_payload["seller_label"],
            }
        ).eq("id", existing.data[0]["id"]).execute()
    else:
        supabase.table("ladipo_part_inventory").insert(inventory_payload).execute()

    # Same pattern as upsertCompatibilityEntries: replace rows for this part
    entries = part.compatibility_entries()
    supabase.table("ladipo_part_compatibility").delete().eq("part_id", part_id).execute()
    if entries:
        supabase.table("ladipo_part_compatibility").insert(
            [
                {
                    "part_id": part_id,
                    "make": e["make"],
                    "model": e["model"],
                    "year_min": e["year_min"],
                    "year_max": e["year_max"],
                }
                for e in entries
            ]
        ).execute()

    return part_id


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scrape RockAuto parts and ingest into Motoka Ladipo tables."
    )
    parser.add_argument("--dry-run", action="store_true", help="Fetch + map only; no DB writes")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="Max aggregated parts to ingest")
    parser.add_argument(
        "--parts-per-category",
        type=int,
        default=DEFAULT_PARTS_PER_CATEGORY,
        help="Max priced parts kept per RockAuto category per vehicle/year",
    )
    parser.add_argument(
        "--max-subcategories",
        type=int,
        default=3,
        help="Max subcategory pages to open per category (where prices live)",
    )
    parser.add_argument("--exchange-rate", type=float, default=DEFAULT_EXCHANGE_RATE)
    parser.add_argument("--markup", type=float, default=DEFAULT_MARKUP_FACTOR)
    parser.add_argument(
        "--round-to",
        type=int,
        default=DEFAULT_ROUND_TO,
        help="Round final Naira price to nearest N (100 or 1000)",
    )
    parser.add_argument("--stock-qty", type=int, default=DEFAULT_STOCK_QTY)
    parser.add_argument("--seller-label", default=DEFAULT_SELLER_LABEL)
    parser.add_argument(
        "--condition",
        choices=("new", "tokunbo", "nigerian_used"),
        default=DEFAULT_CONDITION,
        help="DB enum condition (UI labels: New / Tokunbo / Nigerian Used)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=DEFAULT_REQUEST_DELAY,
        help="Base seconds to sleep between vehicle model requests",
    )
    parser.add_argument(
        "--years-per-model",
        type=int,
        default=2,
        help="How many years to scrape per model (from TARGET_VEHICLES)",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=3,
        help="Retries for transient RockAuto failures",
    )
    parser.add_argument(
        "--make",
        action="append",
        default=[],
        help="Only scrape these makes (repeatable), e.g. --make TOYOTA --make MERCEDES-BENZ",
    )
    parser.add_argument(
        "--full",
        action="store_true",
        help="Use PRODUCTION_VEHICLES (full Nigerian fleet). Default is Camry + C300 only.",
    )
    parser.add_argument(
        "--quick",
        action="store_true",
        help="Tiny smoke test: Camry + C300, 1 year, 2 categories only",
    )
    return parser.parse_args(argv)


def select_vehicles(options: argparse.Namespace) -> List[Tuple[str, str, List[int]]]:
    if options.quick:
        vehicles = [
            ("TOYOTA", "CAMRY", [2015]),
            ("MERCEDES-BENZ", "C300", [2015]),
        ]
    elif options.full:
        vehicles = list(PRODUCTION_VEHICLES)
    else:
        # Default local validation set
        vehicles = list(LOCAL_TEST_VEHICLES)

    if options.make:
        wanted = {m.strip().upper().replace(" ", "-") for m in options.make}
        vehicles = [
            v for v in vehicles
            if v[0].upper().replace(" ", "-") in wanted
        ]
    return vehicles


def select_categories(options: argparse.Namespace) -> List[str]:
    if options.quick:
        return ["Brake & Wheel Hub", "Suspension"]
    return list(TARGET_ROCKAUTO_CATEGORIES)


async def run(options: argparse.Namespace) -> None:
    load_env()

    vehicles = select_vehicles(options)
    categories = select_categories(options)
    if not vehicles:
        raise SystemExit("No vehicles selected. Check --make / TARGET_VEHICLES.")

    print(
        f"[seed_motoka_inventory] start dry_run={options.dry_run} "
        f"mode={'full' if options.full else ('quick' if options.quick else 'local')} "
        f"vehicles={len(vehicles)} categories={len(categories)} "
        f"fx={options.exchange_rate} markup={options.markup} round_to={options.round_to}"
    )

    all_rows: List[Dict[str, Any]] = []
    consecutive_skips = 0

    async with RockAutoClient() as client:
        for make, model, years in vehicles:
            selected_years = years[: max(1, options.years_per_model)]
            for year in selected_years:
                rows = await fetch_parts_for_vehicle(
                    client=client,
                    make=make,
                    model=model,
                    year=year,
                    categories=categories,
                    parts_per_category=options.parts_per_category,
                    max_subcategories=options.max_subcategories,
                    exchange_rate=options.exchange_rate,
                    markup=options.markup,
                    round_to=options.round_to,
                    condition=options.condition,
                    retries=options.retries,
                )
                all_rows.extend(rows)

                if not rows:
                    consecutive_skips += 1
                else:
                    consecutive_skips = 0

                # Cool down harder when RockAuto starts rejecting requests.
                if consecutive_skips >= 3:
                    cool = options.delay * 3
                    print(f"  ~ cooling down {cool:.1f}s after {consecutive_skips} empty/skip results")
                    await polite_delay(cool, 1.0)
                else:
                    await polite_delay(options.delay)

                if consecutive_skips >= 8:
                    print("  ! aborting early — RockAuto appears rate-limited. Try again later.")
                    break
            if consecutive_skips >= 8:
                break

    aggregated = aggregate_rows(all_rows)[: options.limit]
    with_images = sum(1 for p in aggregated if p.image_url)
    print(
        f"[seed_motoka_inventory] scraped_rows={len(all_rows)} "
        f"aggregated={len(aggregated)} with_images={with_images}"
    )

    if options.dry_run:
        preview = []
        for part in aggregated[:12]:
            preview.append(
                {
                    "name": part.name,
                    "brand": part.brand,
                    "category": part.category_path,
                    "condition": part.condition,
                    "part_type": part.part_type,
                    "usd_price": part.usd_price,
                    "price_ngn": part.price_kobo // 100,
                    "price_kobo": part.price_kobo,
                    "image_url": part.image_url,
                    "stock_qty": options.stock_qty,
                    "seller_label": options.seller_label,
                    "compatibility": part.compatibility_entries(),
                }
            )
        import json

        print(json.dumps(preview, indent=2))
        return

    if not aggregated:
        print("[seed_motoka_inventory] nothing to upsert")
        return

    supabase = get_supabase()
    created = 0
    skipped = 0
    for part in aggregated:
        try:
            part_id = upsert_part(
                supabase,
                part,
                stock_qty=options.stock_qty,
                seller_label=options.seller_label,
            )
            if part_id:
                created += 1
            else:
                skipped += 1
        except Exception as exc:
            skipped += 1
            print(f"  ! upsert failed {part.slug}: {exc}")

    print(f"[seed_motoka_inventory] done upserted={created} skipped={skipped}")


def main() -> None:
    options = parse_args()
    try:
        asyncio.run(run(options))
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        sys.exit(130)


if __name__ == "__main__":
    main()
