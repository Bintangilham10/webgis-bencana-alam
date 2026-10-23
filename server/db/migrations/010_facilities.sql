-- Titik evakuasi dan fasilitas penting dari OpenStreetMap (Overpass) untuk seluruh
-- Indonesia, diganti utuh sekali seminggu (jobs/sync-facilities.js). Gedung atau
-- area diwakili titik tengahnya.
CREATE TABLE facilities (
  id        text PRIMARY KEY,               -- 'node/123', 'way/456', 'relation/789'
  category  text NOT NULL CHECK (category IN ('evakuasi', 'titik_kumpul', 'rumah_sakit', 'klinik', 'polisi', 'pemadam')),
  name      text,
  tags      jsonb NOT NULL DEFAULT '{}',
  geom      geometry(Point, 4326) NOT NULL
);
CREATE INDEX facilities_geom_idx ON facilities USING gist (geom);
CREATE INDEX facilities_category_idx ON facilities (category);
