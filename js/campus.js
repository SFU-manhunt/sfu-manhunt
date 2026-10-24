// =====================================================================
// SFU campus presets.
// !!! ALL COORDINATES ARE APPROXIMATE – verify them on the map before playing.
// The host can also redraw the play area / off-limits zones in the lobby,
// then copy the improved coordinates back into this file.
// Points are { lat, lng }.
// =====================================================================
window.SFU = window.SFU || {};

SFU.CAMPUSES = {
  burnaby: {
    name: 'Burnaby (Burnaby Mountain)',
    center: { lat: 49.2788, lng: -122.9199 },
    zoom: 16,
    radiusM: 450,           // used if you switch to "circle" shape
    meetingPoint: 'Convocation Mall',
    // Rough outline of the main academic core (approximate!)
    area: [
      { lat: 49.2812, lng: -122.9232 },
      { lat: 49.2816, lng: -122.9170 },
      { lat: 49.2797, lng: -122.9128 },
      { lat: 49.2768, lng: -122.9136 },
      { lat: 49.2754, lng: -122.9190 },
      { lat: 49.2760, lng: -122.9258 },
      { lat: 49.2786, lng: -122.9272 }
    ],
    // Landmarks can be picked as the final safe zone (approximate!)
    landmarks: [
      { name: 'Convocation Mall',              lat: 49.2788, lng: -122.9199 },
      { name: 'Academic Quadrangle (AQ)',      lat: 49.2790, lng: -122.9213 },
      { name: 'W.A.C. Bennett Library',        lat: 49.2797, lng: -122.9188 },
      { name: 'Transportation Centre',         lat: 49.2785, lng: -122.9165 },
      { name: 'West Mall Centre (WMC)',        lat: 49.2797, lng: -122.9230 },
      { name: 'Residences',                    lat: 49.2770, lng: -122.9240 }
    ],
    // Off-limits zones (roads, construction, forest edges, parkades...).
    // Left empty on purpose: draw them in the lobby with "Draw off-limits",
    // because made-up road coordinates could be dangerously wrong.
    // Example: { name: 'Construction', coords: [ {lat,lng}, {lat,lng}, {lat,lng} ] }
    offLimits: []
  },

  surrey: {
    name: 'Surrey (stub – circle only)',
    center: { lat: 49.1869, lng: -122.8490 },
    zoom: 17,
    radiusM: 200,
    meetingPoint: 'Campus entrance',
    area: null,
    landmarks: [],
    offLimits: []
  },

  vancouver: {
    name: 'Vancouver – Harbour Centre (stub – circle only)',
    center: { lat: 49.2846, lng: -123.1117 },
    zoom: 17,
    radiusM: 200,
    meetingPoint: 'Harbour Centre lobby',
    area: null,
    landmarks: [],
    offLimits: []
  }
};
