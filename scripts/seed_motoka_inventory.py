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

Secondary fitment enrichment (merge Camry/C300 compatibility onto existing NG catalog rows;
does not replace Autofactor / Ladipo Market images or NGN prices):
  .venv-seed/bin/python scripts/seed_motoka_inventory.py --enrich-fitment --limit 50

Prefer the multi-source orchestrator for full Motoka catalog runs:
  node scripts/seed_motoka_catalog.js --dry-run --limit 30
  node scripts/seed_motoka_catalog.js --source all --limit 200

Production / full Nigerian fleet (after local is proven):
  .venv-seed/bin/python scripts/seed_motoka_inventory.py --full --years-per-model 2

Env (from repo .env or process):
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
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
    "TRANSMISSION_DRIVETRAIN": "c1000000-0000-0000-0000-000000000027",
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
    CANONICAL["TRANSMISSION_DRIVETRAIN"]: "Spare Parts · Transmission & Drivetrain",
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
    "Transmission-Automatic": CANONICAL["TRANSMISSION_DRIVETRAIN"],
    "Transmission-Manual": CANONICAL["TRANSMISSION_DRIVETRAIN"],
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


BAD_PART_NUMBER_TOKENS = {
    "UNKNOWN",
    "TOYOTA",
    "HONDA",
    "LEXUS",
    "NISSAN",
    "FORD",
    "BMW",
    "GENERIC",
    "STANDARD",
    "DENSO",
    "BOSCH",
    "ULTRA",
    "POWER",
    "HOLSTEIN",
    "DELPHI",
    "MOTOR",
    "PRODUCTS",
}


def clean_part_text(value: str) -> str:
    """Strip RockAuto breadcrumb / nav noise from scraped titles."""
    text = (value or "").strip()
    if ">" in text:
        text = text.split(">")[-1].strip()
    return re.sub(r"\s+", " ", text)[:4000]


def normalize_part_number(raw: Optional[str], brand: str) -> Optional[str]:
    pn = (raw or "").strip()
    if not pn:
        return None
    upper = pn.upper()
    if upper in BAD_PART_NUMBER_TOKENS:
        return None
    if upper == (brand or "").strip().upper():
        return None
    # Must contain a digit to look like a real OEM/aftermarket PN
    if not re.search(r"\d", pn):
        return None
    if len(pn) < 3:
        return None
    return pn[:100]


def build_sku(brand: str, part_number: str, category_name: str, raw_name: str) -> str:
    """Unique SKU even when RockAuto returns weak/duplicate part numbers."""
    digest = hashlib.sha1(
        f"{brand}|{part_number}|{category_name}|{raw_name}".encode("utf-8")
    ).hexdigest()[:10].upper()
    brand_bit = (slugify(brand)[:12] or "gen").upper()
    pn_bit = (slugify(part_number)[:16] or "pn").upper()
    return f"RA-{brand_bit}-{pn_bit}-{digest}"[:100]


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
    cleaned = url.strip()
    lower = cleaned.lower()
    # Non-product / placeholder assets from RockAuto listings
    junk_markers = (
        "/heart.png",
        "catalog/images/heart.png",
        "flag_",
        "loading.gif",
        "spacer.gif",
        "blank.gif",
        "1x1",
        "pixel.gif",
    )
    if any(marker in lower for marker in junk_markers):
        return None
    return cleaned


def absolutize_rockauto_url(url: Optional[str]) -> Optional[str]:
    if not url or not isinstance(url, str):
        return None
    raw = url.strip()
    if not raw or raw.startswith("data:"):
        return None
    if raw.startswith("//"):
        raw = f"https:{raw}"
    elif raw.startswith("/"):
        raw = f"https://www.rockauto.com{raw}"
    elif not raw.startswith("http"):
        raw = f"https://www.rockauto.com/{raw.lstrip('./')}"
    return https_only(raw)


def extract_part_image_url(part: Any) -> Optional[str]:
    """Pick the best product image RockAuto exposed on the listing row."""
    candidates: List[Optional[str]] = [
        getattr(part, "image_url", None),
        getattr(part, "info_url", None),  # sometimes parsers mis-assign
    ]
    # Some PartInfo dumps stash extras in model_extra / __dict__
    extra = getattr(part, "__dict__", {}) or {}
    for key in ("image", "img", "photo_url", "thumbnail"):
        candidates.append(extra.get(key))

    for candidate in candidates:
        if not candidate or not isinstance(candidate, str):
            continue
        # info.php pages are not images
        if "moreinfo.php" in candidate.lower() or candidate.lower().endswith(".php"):
            continue
        absolute = absolutize_rockauto_url(candidate)
        if absolute and any(ext in absolute.lower() for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif")):
            return absolute
        # RockAuto CDN paths without extension
        if absolute and ("/info/" in absolute.lower() or "rockauto.com" in absolute.lower()):
            if "heart" not in absolute.lower():
                return absolute
    return None


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
    desc = clean_part_text(description) or "Auto Part"
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
    part_number = normalize_part_number(getattr(part, "part_number", None), brand)
    if not part_number:
        return None

    raw_name = clean_part_text(getattr(part, "name", None) or "") or part_number
    price_kobo = usd_to_ngn_kobo(usd, exchange_rate, markup, round_to)
    display_name = build_display_name(brand, raw_name, part_number)
    sku = build_sku(brand, part_number, category_name, raw_name)
    slug = slugify(f"{brand}-{part_number}-{category_name}-{sku[-10:].lower()}")

    return {
        "brand": brand[:100],
        "part_number": part_number,
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
        "sku": sku,
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

NG_CATALOG_SOURCES = frozenset({"autofactorng.com", "ladipomarket.com.ng"})

_OEM_TITLE_PATTERNS: List[Tuple[str, re.Pattern[str]]] = [
    ("mercedesbenz", re.compile(r"\b(?:mercedes(?:[-\s]?benz)?|benz)\b", re.I)),
    ("volkswagen", re.compile(r"\b(?:volkswagen|vw)\b", re.I)),
    ("bmw", re.compile(r"\bbmw\b", re.I)),
    ("toyota", re.compile(r"\btoyota\b", re.I)),
    ("honda", re.compile(r"\bhonda\b", re.I)),
    ("nissan", re.compile(r"\bnissan\b", re.I)),
    ("hyundai", re.compile(r"\bhyundai\b", re.I)),
    ("kia", re.compile(r"\bkia\b", re.I)),
    ("ford", re.compile(r"\bford\b", re.I)),
    ("lexus", re.compile(r"\blexus\b", re.I)),
    ("mazda", re.compile(r"\bmazda\b", re.I)),
    ("mitsubishi", re.compile(r"\bmitsubishi\b", re.I)),
    ("peugeot", re.compile(r"\bpeugeot\b", re.I)),
    ("audi", re.compile(r"\baudi\b", re.I)),
]


def _make_key(value: str) -> str:
    key = re.sub(r"[^a-z0-9]+", "", (value or "").lower())
    if key in {"mercedes", "benz"}:
        return "mercedesbenz"
    if key == "vw":
        return "volkswagen"
    return key


def _detect_oem_make_key(text: str) -> Optional[str]:
    raw = text or ""
    for key, pattern in _OEM_TITLE_PATTERNS:
        if pattern.search(raw):
            return key
    return None


def _compat_conflicts_with_title(compat_make: str, name: str, brand: str) -> bool:
    stated = _detect_oem_make_key(name) or _detect_oem_make_key(brand)
    if not stated or not compat_make:
        return False
    return stated != _make_key(compat_make)


def get_supabase() -> Client:
    url = os.getenv("SUPABASE_URL", "").strip()
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        raise SystemExit(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required "
            "(set them in .env or the environment)."
        )
    return create_client(url, key)


def images_are_usable(images: Any) -> bool:
    if not isinstance(images, list) or not images:
        return False
    return https_only(images[0]) is not None


def find_existing_catalog_part(supabase: Client, part: AggregatedPart) -> Optional[Dict[str, Any]]:
    by_slug = (
        supabase.table("ladipo_parts")
        .select("id, sku, images, specifications, brand, name")
        .eq("slug", part.slug)
        .limit(1)
        .execute()
    )
    if by_slug.data:
        return by_slug.data[0]

    part_number = (part.part_number or "").strip()
    if not part_number:
        return None

    by_pn = (
        supabase.table("ladipo_parts")
        .select("id, sku, images, specifications, brand, name")
        .filter("specifications->>part_number", "eq", part_number)
        .limit(5)
        .execute()
    )
    rows = by_pn.data or []
    if not rows:
        return None
    brand_l = (part.brand or "").strip().lower()
    if brand_l:
        for row in rows:
            if (row.get("brand") or "").strip().lower() == brand_l:
                return row
    return rows[0]


def merge_compatibility_entries(
    supabase: Client,
    part_id: str,
    incoming: List[Dict[str, Any]],
) -> None:
    """Union make/model year ranges; do not wipe existing fitment."""
    if not incoming:
        return

    existing = (
        supabase.table("ladipo_part_compatibility")
        .select("id, make, model, year_min, year_max")
        .eq("part_id", part_id)
        .execute()
    )
    buckets: Dict[Tuple[str, str], CompatibilityYear] = {}
    for row in existing.data or []:
        key = (row["make"], row["model"])
        bucket = CompatibilityYear()
        ymin = row.get("year_min")
        ymax = row.get("year_max")
        if ymin is not None and ymax is not None:
            for year in range(int(ymin), int(ymax) + 1):
                bucket.add(year)
        elif ymin is not None:
            bucket.add(int(ymin))
        buckets[key] = bucket

    for entry in incoming:
        key = (entry["make"], entry["model"])
        if key not in buckets:
            buckets[key] = CompatibilityYear()
        ymin = entry.get("year_min")
        ymax = entry.get("year_max")
        if ymin is not None and ymax is not None:
            for year in range(int(ymin), int(ymax) + 1):
                buckets[key].add(year)
        elif ymin is not None:
            buckets[key].add(int(ymin))

    supabase.table("ladipo_part_compatibility").delete().eq("part_id", part_id).execute()
    payload = []
    for (make, model), bucket in buckets.items():
        entry = bucket.as_entry(make, model)
        if entry["year_min"] is None:
            continue
        payload.append(
            {
                "part_id": part_id,
                "make": make,
                "model": model,
                "year_min": entry["year_min"],
                "year_max": entry["year_max"],
            }
        )
    if payload:
        supabase.table("ladipo_part_compatibility").insert(payload).execute()


def upsert_part(
    supabase: Client,
    part: AggregatedPart,
    stock_qty: int,
    seller_label: str,
    *,
    enrich_fitment: bool = False,
) -> Optional[str]:
    existing = find_existing_catalog_part(supabase, part)
    existing_specs = existing.get("specifications") if existing else None
    if not isinstance(existing_specs, dict):
        existing_specs = {}
    existing_source = str(existing_specs.get("source") or "")

    # Prefer Autofactor / Ladipo Market catalog rows: only attach RockAuto fitment
    # (and fill missing images). Never overwrite their NGN prices or good images.
    if existing and (enrich_fitment or existing_source in NG_CATALOG_SOURCES):
        part_id = existing["id"]
        # Never attach Camry fitment onto a Mercedes-titled NG row (and vice versa).
        existing_name = str(existing.get("name") or "")
        existing_brand = str(existing.get("brand") or "")
        conflicting = False
        for entry in part.compatibility_entries():
            entry_make = str(entry.get("make") or "")
            if _compat_conflicts_with_title(entry_make, existing_name, existing_brand):
                conflicting = True
                break
        if conflicting:
            return part_id

        patch: Dict[str, Any] = {
            "specifications": {
                **existing_specs,
                "rockauto_part_number": part.part_number,
                "rockauto_source_url": part.source_url,
                "rockauto_category": part.rockauto_category,
            }
        }
        if not images_are_usable(existing.get("images")) and part.image_url:
            patch["images"] = [part.image_url]
        supabase.table("ladipo_parts").update(patch).eq("id", part_id).execute()
        merge_compatibility_entries(supabase, part_id, part.compatibility_entries())
        return part_id

    if enrich_fitment and not existing:
        # Secondary mode: do not create RockAuto-only catalog rows.
        return None

    images = [part.image_url] if part.image_url else []
    if existing and images_are_usable(existing.get("images")) and not images:
        images = existing["images"]

    part_payload = {
        "sku": (existing or {}).get("sku") or part.sku,
        "slug": part.slug,
        "name": part.name,
        "description": part.description,
        "category_id": part.category_id,
        "brand": part.brand,
        "condition": part.condition,
        "part_type": part.part_type,
        "images": images,
        "specifications": {
            **existing_specs,
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

    existing_inv = (
        supabase.table("ladipo_part_inventory")
        .select("id, price_kobo")
        .eq("part_id", part_id)
        .limit(1)
        .execute()
    )
    if existing_inv.data:
        # Keep an existing NGN price when this row already came from NG catalog.
        keep_price = existing_source in NG_CATALOG_SOURCES
        update_payload: Dict[str, Any] = {
            "stock_qty": inventory_payload["stock_qty"],
            "seller_label": inventory_payload["seller_label"],
        }
        if not keep_price:
            update_payload["price_kobo"] = inventory_payload["price_kobo"]
        supabase.table("ladipo_part_inventory").update(update_payload).eq(
            "id", existing_inv.data[0]["id"]
        ).execute()
    else:
        supabase.table("ladipo_part_inventory").insert(inventory_payload).execute()

    merge_compatibility_entries(supabase, part_id, part.compatibility_entries())
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
    parser.add_argument(
        "--enrich-fitment",
        action="store_true",
        help=(
            "Secondary mode: merge Camry/C300 compatibility onto matching existing "
            "catalog rows (by slug or part number). Does not create RockAuto-only "
            "parts and does not replace Autofactor/Ladipo Market images or NGN prices."
        ),
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
        f"enrich_fitment={options.enrich_fitment} "
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
                enrich_fitment=options.enrich_fitment,
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
