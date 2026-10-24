// Kawasan yang dinilai SIGAP (sama dengan server, routes/risk.js). Titik di luar
// kotak ini tidak dikirim ke server.
export const REGION = { south: -12, north: 7, west: 94, east: 142 };

export const inRegion = ({ lat, lng }) => lat >= REGION.south && lat <= REGION.north && lng >= REGION.west && lng <= REGION.east;
