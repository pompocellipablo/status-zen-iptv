"""Parse the three coordinated rollout migrations, including PL/pgSQL bodies."""
from pathlib import Path
from pglast import parse_sql, parse_plpgsql

paths = [
    "20261110220000_general_overdue_paid_settlement.sql",
    "20261111120000_general_zero_active_settlement.sql",
    "20261111121000_cancelled_panel_order_manual_recovery.sql",
]
for name in paths:
    sql = (Path("supabase/migrations") / name).read_text()
    parse_sql(sql)
    parse_plpgsql(sql)
    print(f"PASS SQL + PL/pgSQL: {name}")
