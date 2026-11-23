#!/usr/bin/env bash
# Runs the database tests against a throwaway Postgres: ./scripts/test-sql.sh   (uses the usual PG* variables)
# It creates a scratch database, loads a stand-in for Supabase's pieces, runs supabase/grievances.sql twice (it must be
# safe to run again), then the behaviour tests. Needs psql and a Postgres server you can create databases on.
set -euo pipefail
cd "$(dirname "$0")/.."
DB="sng_test_$$"
psql -qv ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null 2>&1' EXIT
psql -qv ON_ERROR_STOP=1 -d "$DB" -f test/sql/stub.sql >/dev/null
for f in supabase/grievances.sql supabase/grievances.sql; do psql -qv ON_ERROR_STOP=1 -d "$DB" -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f did not run cleanly"; psql -qv ON_ERROR_STOP=1 -d "$DB" -f "$f" 2>&1 | tail -5; exit 1; }; done
echo "ok: grievances.sql runs, and runs again"
out=$(psql -qv ON_ERROR_STOP=1 -d "$DB" -f test/sql/grievances.test.sql 2>&1) || { echo "$out" | grep -v "^psql:.*NOTICE" | tail -15; exit 1; }
echo "$out" | grep -c "NOTICE:  ok:" | xargs -I{} echo "ok: {} database checks passed"
