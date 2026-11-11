import { useEffect } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) map.setView([points[0].lat, points[0].lng], 9);
    else map.fitBounds(points.map((p) => [p.lat, p.lng]), { padding: [40, 40], maxZoom: 10 });
  }, [map, points]);
  return null;
}

/** points: [{ key, lat, lng, color, radius, title, lines: [] }] */
export default function ReliefMap({ points = [], height = 320 }) {
  return (
    <div className="overflow-hidden rounded-3xl ring-1 ring-slate-100" style={{ height }}>
      <MapContainer center={[12, 110]} zoom={3} scrollWheelZoom={false} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={points} />
        {points.map((p) => (
          <CircleMarker key={p.key} center={[p.lat, p.lng]} radius={p.radius || 10}
            pathOptions={{ color: p.color, fillColor: p.color, fillOpacity: 0.55, weight: 2 }}>
            <Tooltip direction="top" offset={[0, -6]}>
              <div className="text-xs">
                <b>{p.title}</b>
                {p.lines?.map((l, i) => <div key={i}>{l}</div>)}
              </div>
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}

export const urgencyColor = (u) => (u >= 80 ? "#f2665a" : u >= 55 ? "#f5a524" : u >= 30 ? "#3b74ff" : "#94a3b8");
