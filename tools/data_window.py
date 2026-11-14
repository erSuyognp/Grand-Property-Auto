"""Data agreement rule 1: Vexcel and Matterport may only be called between
Fri Nov 13 2026 4:30 PM and Sun Nov 15 2026 4:00 PM America/New_York (EST, UTC-5).

Every tool that calls a Sponsor API must call assert_data_window() before each request.
"""
from datetime import datetime, timedelta, timezone
import sys

EST = timezone(timedelta(hours=-5))
WINDOW_START = datetime(2026, 11, 13, 16, 30, tzinfo=EST)
WINDOW_END = datetime(2026, 11, 15, 16, 0, tzinfo=EST)


def in_data_window(now=None):
    now = now or datetime.now(timezone.utc)
    return WINDOW_START <= now < WINDOW_END


def assert_data_window(what="Sponsor API call", now=None):
    now = now or datetime.now(timezone.utc)
    if in_data_window(now):
        return
    msg = (f"[data-window] refused {what}: {now.isoformat()} is outside "
           f"{WINDOW_START.isoformat()} .. {WINDOW_END.isoformat()} (Nov 13 4:30 PM to Nov 15 4:00 PM ET)")
    print(msg, file=sys.stderr)
    raise PermissionError(msg)


if __name__ == "__main__":
    print("inside data window" if in_data_window() else "OUTSIDE data window")
