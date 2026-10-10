import math

MONTH_DAYS = 30.4375
BYTE_KEYS = ("hot_bytes", "replica_bytes", "backup_bytes", "archive_bytes", "total_bytes")


def volumes(params, growth=None):
    g = params["monthly_growth_pct"] if growth is None else growth
    base = params["records_per_day"] * (params["avg_record_bytes"] +
            params["events_per_record"] * params["avg_event_bytes"])
    return [base * (1 + g / 100) ** (d / MONTH_DAYS) for d in range(365)]


def at_day(params, daily, days):
    hot_logical = math.fsum(daily[max(0, days - params["retention_days"]):days])
    hot = round(hot_logical * (1 + params["index_overhead_pct"] / 100))
    replicas = hot * (params["replication_factor"] - 1)
    backups = hot * params["backup_full_copies"]
    archive = round(math.fsum(daily[:max(0, days - params["retention_days"])]) /
                    params["archive_compression_ratio"])
    return dict(zip(BYTE_KEYS, (hot, replicas, backups, archive, hot + replicas + backups + archive)))


def month_series(params, growth):
    daily = volumes(params, growth)
    return [{"month": month, **at_day(params, daily, min(365, round(month * MONTH_DAYS)))}
            for month in range(13)]


def estimate_capacity(params):
    p = dict(params)
    g = p["monthly_growth_pct"]
    low, high = (g * .5, g * 1.5) if g > 0 else (g - 5, g + 5)
    base = month_series(p, g)
    record = p["records_per_day"] * p["avg_record_bytes"]
    daily = volumes(p)
    event = round(p["records_per_day"] * p["events_per_record"] * p["avg_event_bytes"])
    primary = at_day(p, daily, 1)["hot_bytes"]
    index = primary - record - event
    horizons = [{"label": label, "months": months, **at_day(p, daily, days)}
                for label, months, days in [("1 day", 1 / MONTH_DAYS, 1), ("1 month", 1, 30),
                                           ("3 months", 3, 91), ("6 months", 6, 183), ("12 months", 12, 365)]]
    threshold = p["threshold_gb"] * 1_000_000_000
    crossed = None
    for prev, row in zip(base, base[1:]):
        if row["total_bytes"] >= threshold:
            delta = row["total_bytes"] - prev["total_bytes"]
            crossed = prev["month"] + (threshold - prev["total_bytes"]) / delta if delta else row["month"]
            break
    sensitivity = []
    for key in ("records_per_day", "avg_record_bytes", "events_per_record", "index_overhead_pct",
                "replication_factor", "retention_days", "monthly_growth_pct"):
        altered = dict(p)
        altered[key] = math.ceil(p[key] * 1.2) if isinstance(p[key], int) else p[key] * 1.2
        total = month_series(altered, altered["monthly_growth_pct"])[-1]["total_bytes"]
        baseline = base[-1]["total_bytes"]
        sensitivity.append({"parameter": key, "change": "+20%", "total_12m_bytes": total,
                            "delta_pct": (total - baseline) / baseline * 100 if baseline else 0.0})
    return {
        "kind": "estimate",
        "assumptions": ["Estimates, not measured storage usage; 365 daily volumes starting at day 0.",
                        "A month is 30.4375 days; month endpoints use the nearest whole day, capped at 365.",
                        "Indexes apply to both records and events in the hot set; replicas contain hot data only.",
                        "Backups are uncompressed logical full copies of hot primary bytes.",
                        "Archive is one compressed copy without indexes; GB means 1,000,000,000 bytes.",
                        "Daily replicated_bytes includes the primary and all replicas.",
                        "Byte totals round to the nearest integer; daily index bytes absorb component rounding so daily primary equals the one-day hot set.",
                        "Integer sensitivity inputs round +20% upward; sensitivity is not clamped to input ranges."],
        "daily": {"record_bytes": record, "event_bytes": event, "index_bytes": index,
                  "primary_bytes": primary, "replicated_bytes": primary * p["replication_factor"]},
        "horizons": horizons,
        "series": {"base": base, "low": [{"month": r["month"], "total_bytes": r["total_bytes"]}
                                          for r in month_series(p, low)],
                   "high": [{"month": r["month"], "total_bytes": r["total_bytes"]}
                            for r in month_series(p, high)]},
        "scenarios": {"low": {"monthly_growth_pct": low}, "base": {"monthly_growth_pct": g},
                      "high": {"monthly_growth_pct": high}},
        "threshold": {"gb": p["threshold_gb"], "crossed_at_month": crossed}, "sensitivity": sensitivity,
    }
