'use strict';

const SUN = V3(-0.56, 0.24, -0.79).normalize();
const SUN_COL = new THREE.Color(1.0, 0.84, 0.66);
const SUN_FILL = new THREE.Color(0.34, 0.56, 0.82);
const GLSL_FOG = '';
const Daylight = { U: {}, S: { shaft: 0, lift: 1, tint: [1, 1, 1] } };

G.post = { exposure: 1.04, bloom: 0.09, god: 0.24 };
G.anchors.planet = V3(-2200, -3200, -12000);
G.anchors.planetR = 3300;
