// Baris hasil query diharapkan punya kolom `geometry` (ST_AsGeoJSON(...)::json);
// kolom lain menjadi properties kecuali diubah oleh toProperties.
export function featureCollection(rows, toProperties = ({ geometry, ...rest }) => rest, extra = {}) {
  return {
    type: 'FeatureCollection',
    ...extra,
    features: rows.map((row) => ({ type: 'Feature', geometry: row.geometry, properties: toProperties(row) })),
  };
}
