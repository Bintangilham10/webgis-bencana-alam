import os

import psycopg

# Sama dengan server/src/config.js: database PostGIS dari docker-compose.yml.
DATABASE_URL = os.environ.get('DATABASE_URL', 'postgresql://sigap:sigap@localhost:5433/sigap')


def connect() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL)
