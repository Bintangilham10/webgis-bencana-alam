CREATE INDEX wilayah_geom_idx ON wilayah USING gist (geom);
CREATE INDEX wilayah_induk_idx ON wilayah (induk_kode);
CREATE INDEX volcanoes_geom_idx ON volcanoes USING gist (geom);
CREATE INDEX faults_geom_idx ON faults USING gist (geom);
CREATE INDEX events_geom_idx ON events USING gist (geom);
CREATE INDEX events_hazard_time_idx ON events (hazard, occurred_at DESC);
CREATE INDEX sync_logs_source_time_idx ON sync_logs (source, started_at DESC);
