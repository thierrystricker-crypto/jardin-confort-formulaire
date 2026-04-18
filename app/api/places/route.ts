// app/api/places/route.ts
// Proxy Google Places Autocomplete — évite d'exposer la clé côté client
// GET /api/places?q=route+de+lavaux&type=autocomplete
// GET /api/places?place_id=ChIJ...&type=details

import { NextRequest, NextResponse } from "next/server";

const GOOGLE_KEY = process.env.GOOGLE_MAPS_SERVER_KEY ||
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || "";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "autocomplete";
  const q = searchParams.get("q") || "";
  const placeId = searchParams.get("place_id") || "";

  if (!GOOGLE_KEY) {
    return NextResponse.json({ error: "Google Maps key not configured" }, { status: 500 });
  }

  try {
    if (type === "autocomplete") {
      if (!q || q.length < 3) {
        return NextResponse.json({ predictions: [] });
      }
      const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
      url.searchParams.set("input", q);
      url.searchParams.set("components", "country:ch");
      url.searchParams.set("types", "address");
      url.searchParams.set("language", "fr");
      url.searchParams.set("key", GOOGLE_KEY);

      const res = await fetch(url.toString());
      const json = await res.json();
      return NextResponse.json(json);

    } else if (type === "details") {
      if (!placeId) {
        return NextResponse.json({ error: "place_id requis" }, { status: 400 });
      }
      const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
      url.searchParams.set("place_id", placeId);
      url.searchParams.set("fields", "address_components");
      url.searchParams.set("language", "fr");
      url.searchParams.set("key", GOOGLE_KEY);

      const res = await fetch(url.toString());
      const json = await res.json();
      return NextResponse.json(json);
    }

    return NextResponse.json({ error: "type invalide" }, { status: 400 });

  } catch (err) {
    console.error("Places API error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}