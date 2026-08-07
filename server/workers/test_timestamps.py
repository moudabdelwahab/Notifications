"""
Regression test for the timestamp parsing that stalled the monitor.

Run #717 wrote last_scanned_at = 07:09:04.900200. Postgres trims trailing zeros
when rendering, so it came back as '2026-08-06T07:09:04.9002+00:00' — four
fractional digits. Python 3.10's datetime.fromisoformat accepts three or six and
nothing else, so every run afterwards raised ValueError while reading it, and
none of them got far enough to overwrite the value. Monitoring stopped for 32
hours and 19 consecutive runs.

About one microsecond value in ten ends in a zero, so this was always going to
happen. This test pins every shape Postgres can render.

    python server/workers/test_timestamps.py
"""

import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# The module builds a Supabase client at import time and exits without these.
os.environ.setdefault("SUPABASE_URL", "http://localhost")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test")

from telegram_worker import (  # noqa: E402
    DEFAULT_LOOKBACK,
    MAX_LOOKBACK,
    parse_pg_timestamp,
    scan_since,
)

failures: list[str] = []


def expect(condition: bool, label: str, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {label}{('  ' + detail) if detail else ''}")
    else:
        failures.append(label)
        print(f"  FAIL  {label}{('  ' + detail) if detail else ''}")


print("every fractional-second width Postgres can render:")
PARSEABLE = [
    ("2026-08-06T07:09:04.9002+00:00", "4 digits — the value that stopped run #718"),
    ("2026-08-06T07:09:04.9+00:00", "1 digit"),
    ("2026-08-06T07:09:04.90+00:00", "2 digits"),
    ("2026-08-06T07:09:04.900+00:00", "3 digits"),
    ("2026-08-06T07:09:04.90020+00:00", "5 digits"),
    ("2026-08-06T07:09:04.900200+00:00", "6 digits"),
    ("2026-08-06T07:09:04+00:00", "no fraction"),
    ("2026-08-06T07:09:04.9002Z", "Z suffix"),
    ("2026-08-06T07:09:04.9002", "no offset"),
    (datetime(2026, 8, 6, 7, 9, 4), "datetime object, naive"),
]

for value, label in PARSEABLE:
    parsed = parse_pg_timestamp(value)
    expect(
        parsed is not None and parsed.tzinfo is not None,
        label,
        f"-> {parsed.isoformat() if parsed else 'None'}",
    )

print("\nunreadable input degrades instead of raising:")
now = datetime.now(timezone.utc)
for value, label in [
    (None, "None"),
    ("", "empty string"),
    ("not a date", "garbage"),
    ("2026-13-45", "impossible date"),
]:
    parsed = parse_pg_timestamp(value)
    within = abs((now - DEFAULT_LOOKBACK - scan_since(value)).total_seconds()) < 5
    expect(parsed is None and within, label, "-> falls back to the default window")

print("\nbounds:")
ancient = scan_since("2020-01-01T00:00:00+00:00")
expect(
    abs((now - MAX_LOOKBACK - ancient).total_seconds()) < 5,
    "an ancient watermark is capped at MAX_LOOKBACK",
    f"-> {ancient.isoformat()}",
)

recent = "2026-08-06T07:09:04.9002+00:00"
parsed = parse_pg_timestamp(recent)
assert parsed is not None
expect(
    parsed.microsecond == 900200,
    "a trimmed fraction keeps its real value",
    "-> .9002 reads as 900200µs, not 9002",
)

fresh = (now - timedelta(minutes=10)).isoformat()
expect(
    scan_since(fresh) < now - timedelta(minutes=10),
    "a recent watermark is rewound by OVERLAP",
)

total = len(PARSEABLE) + 4 + 3
print(f"\n{total - len(failures)}/{total} passed")
sys.exit(1 if failures else 0)
