// ============================================================
// js/modules/countrymap.js — turns a country's slice of the
// world map (world.svg + terrain.json + elevation.json +
// resources.json) into its own compact, layered SVG.
//
// World space  = the 0..1200 x 0..1312 viewBox of maps/world.svg.
// Local space  = a per-country coordinate system starting near
//                (0,0), computed by cropping that country's
//                bounding box out of world space. Everything a
//                player draws (provinces, cities, roads, zones)
//                lives in LOCAL space — see docs/database.md.
//
// Layers, as <g> groups inside the rendered SVG:
//   .layer-boundary        country outline (always visible)
//   .layer-natural         rivers/lakes/elevation/resources, cropped+faint
//   .layer-political       provinces + cities (filled in by other modules)
//   .layer-infrastructure  roads/zones/buildings (filled in by other modules)
//   .layer-defence         military placements (filled in later)
//
// Nothing here talks to Supabase — this module only builds the
// natural/boundary base map. Other modules (provinces-cities.js,
// etc.) render into .layer-political / .layer-infrastructure /
// .layer-defence themselves and call CountryMap.setView() to
// switch which layers are visible.
// ============================================================

var CountryMap = (function () {
  var PADDING = 24; // local-space padding around a country's bbox, on all sides

  var _worldSvgTextPromise = null;
  var _countryPolysPromise = null; // world-space polygons, parsed once
  var _terrainPromise = null;
  var _elevationPromise = null;
  var _resourcesPromise = null;

  function fetchWorldSvgText() {
    if (!_worldSvgTextPromise) {
      _worldSvgTextPromise = fetch('maps/world.svg').then(function (r) { return r.text(); });
    }
    return _worldSvgTextPromise;
  }

  function fetchJsonCached(url, cacheRef) {
    return cacheRef.value || (cacheRef.value = fetch(url).then(function (r) {
      return r.ok ? r.json() : [];
    }).catch(function () { return []; }));
  }

  var _terrainCache = {}, _elevationCache = {}, _resourcesCache = {};
  function fetchTerrain() { return fetchJsonCached('maps/terrain.json', _terrainCache); }
  function fetchElevation() { return fetchJsonCached('maps/elevation.json', _elevationCache); }
  function fetchResources() { return fetchJsonCached('maps/resources.json', _resourcesCache); }

  // Parses every <path id="country_XXX" ... d="M x y L x y ... Z">
  // in world.svg into { id, points:[{x,y}] } — the paths in this
  // project are always straight-segment polygons, never curves.
  function fetchCountryPolys() {
    if (_countryPolysPromise) return _countryPolysPromise;
    _countryPolysPromise = fetchWorldSvgText().then(function (svgText) {
      var polys = {};
      var re = /<path id="(country_\d+)"[^>]*\bd="([^"]+)"/g;
      var m;
      while ((m = re.exec(svgText))) {
        var id = m[1];
        var d = m[2];
        var nums = d.match(/-?\d+(?:\.\d+)?/g) || [];
        var pts = [];
        for (var i = 0; i + 1 < nums.length; i += 2) {
          pts.push({ x: parseFloat(nums[i]), y: parseFloat(nums[i + 1]) });
        }
        polys[id] = pts;
      }
      return polys;
    });
    return _countryPolysPromise;
  }

  function bboxOf(points) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    points.forEach(function (p) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    });
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  // Ray-casting point-in-polygon test, world-space or local-space
  // agnostic (just needs matching units for point + polygon).
  function pointInPolygon(x, y, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i].x, yi = poly[i].y;
      var xj = poly[j].x, yj = poly[j].y;
      var intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // ---- Public: geometry ----

  // Loads and caches everything needed to draw countryId's own
  // map: its outline (in local space) + natural features that
  // belong to it (also transformed into local space).
  function loadGeometry(countryId) {
    return Promise.all([fetchCountryPolys(), fetchTerrain(), fetchElevation(), fetchResources()])
      .then(function (results) {
        var polys = results[0], terrain = results[1], elevation = results[2], resources = results[3];
        var worldPoly = polys[countryId];
        if (!worldPoly) {
          throw new Error('No country polygon found for ' + countryId + ' in world.svg');
        }

        var bbox = bboxOf(worldPoly);
        var offsetX = bbox.minX - PADDING;
        var offsetY = bbox.minY - PADDING;
        var width = (bbox.maxX - bbox.minX) + PADDING * 2;
        var height = (bbox.maxY - bbox.minY) + PADDING * 2;

        function toLocal(p) { return { x: p.x - offsetX, y: p.y - offsetY }; }
        function pointsToLocal(pts) { return pts.map(toLocal); }

        var boundaryLocal = pointsToLocal(worldPoly);

        var terrainLocal = terrain
          .filter(function (t) { return t.countryId === countryId; })
          .map(function (t) { return Object.assign({}, t, { points: pointsToLocal(t.points) }); });

        var elevationLocal = elevation
          .filter(function (e) { return e.countryId === countryId; })
          .map(function (e) { return Object.assign({}, e, { points: pointsToLocal(e.points) }); });

        var resourcesLocal = resources
          .filter(function (r) { return r.countryId === countryId; })
          .map(function (r) { var lp = toLocal(r); return Object.assign({}, r, { x: lp.x, y: lp.y }); });

        return {
          countryId: countryId,
          width: width,
          height: height,
          offsetX: offsetX,
          offsetY: offsetY,
          boundary: boundaryLocal,   // [{x,y}] local space, closed polygon
          terrain: terrainLocal,
          elevation: elevationLocal,
          resources: resourcesLocal,
          worldToLocal: toLocal,
          // Is a LOCAL-space point inside this country's own outline?
          // (used by provinces-cities.js to keep drawing inside the country)
          containsLocalPoint: function (x, y) { return pointInPolygon(x, y, boundaryLocal); }
        };
      });
  }

  function pointsToAttr(points) {
    return points.map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
  }

  var ELEVATION_COLORS = {
    mountain: 'rgba(120,110,100,0.28)',
    hills: 'rgba(150,140,110,0.24)',
    plateau: 'rgba(170,150,110,0.22)',
    forest: 'rgba(70,110,70,0.26)',
    desert: 'rgba(210,180,120,0.28)'
  };
  var RESOURCE_ICONS = { petroleum: '⛽', coal: '⬛', iron: '⛰', gold: '●', timber: '🌲', water: '💧' };

  // ---- Public: rendering ----

  // Renders the base SVG (boundary + natural layer, empty groups
  // for political/infrastructure/defence) into `container`, plus a
  // layer-toggle bar above it. Returns a handle other modules use
  // to draw into the empty layers and react to clicks.
  function render(container, geom, opts) {
    opts = opts || {};
    var ns = 'http://www.w3.org/2000/svg';
    var pad = geom.width * 0.02;

    var wrap = document.createElement('div');
    wrap.className = 'countrymap-wrap';

    var toggleBar = document.createElement('div');
    toggleBar.className = 'countrymap-toggle-bar';
    var views = [
      { key: 'all', label: 'All-in-one' },
      { key: 'natural', label: 'Natural' },
      { key: 'political', label: 'Political' },
      { key: 'infrastructural', label: 'Infrastructural' },
      { key: 'defence', label: 'Defence' }
    ];
    views.forEach(function (v) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'countrymap-toggle-btn' + (v.key === 'all' ? ' active' : '');
      btn.textContent = v.label;
      btn.dataset.view = v.key;
      btn.addEventListener('click', function () {
        toggleBar.querySelectorAll('.countrymap-toggle-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        setView(v.key);
      });
      toggleBar.appendChild(btn);
    });
    wrap.appendChild(toggleBar);

    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + geom.width + ' ' + geom.height);
    svg.setAttribute('class', 'countrymap-svg');

    var layerBoundary = document.createElementNS(ns, 'g');
    layerBoundary.setAttribute('class', 'layer layer-boundary');
    var boundaryPath = document.createElementNS(ns, 'polygon');
    boundaryPath.setAttribute('points', pointsToAttr(geom.boundary));
    boundaryPath.setAttribute('class', 'country-outline');
    layerBoundary.appendChild(boundaryPath);

    var layerNatural = document.createElementNS(ns, 'g');
    layerNatural.setAttribute('class', 'layer layer-natural');

    geom.elevation.forEach(function (e) {
      var poly = document.createElementNS(ns, 'polygon');
      poly.setAttribute('points', pointsToAttr(e.points));
      poly.setAttribute('fill', ELEVATION_COLORS[e.type] || 'rgba(140,140,140,0.2)');
      poly.setAttribute('stroke', 'none');
      poly.setAttribute('data-feature-type', e.type);
      poly.setAttribute('data-feature-name', e.name);
      layerNatural.appendChild(poly);
    });

    geom.terrain.forEach(function (t) {
      var line = document.createElementNS(ns, 'polyline');
      line.setAttribute('points', pointsToAttr(t.points));
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', '#5a86a8');
      line.setAttribute('stroke-width', '2');
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('opacity', '0.55');
      line.setAttribute('data-feature-type', t.type);
      line.setAttribute('data-feature-name', t.name);
      layerNatural.appendChild(line);
    });

    geom.resources.forEach(function (r) {
      var g = document.createElementNS(ns, 'g');
      g.setAttribute('class', 'resource-marker');
      g.setAttribute('transform', 'translate(' + r.x + ',' + r.y + ')');
      var text = document.createElementNS(ns, 'text');
      text.setAttribute('font-size', Math.max(10, geom.width * 0.018));
      text.setAttribute('text-anchor', 'middle');
      text.textContent = RESOURCE_ICONS[r.type] || '◆';
      g.appendChild(text);
      g.setAttribute('data-feature-type', r.type);
      layerNatural.appendChild(g);
    });

    var layerPolitical = document.createElementNS(ns, 'g');
    layerPolitical.setAttribute('class', 'layer layer-political');

    var layerInfra = document.createElementNS(ns, 'g');
    layerInfra.setAttribute('class', 'layer layer-infrastructure');

    var layerDefence = document.createElementNS(ns, 'g');
    layerDefence.setAttribute('class', 'layer layer-defence');

    svg.appendChild(layerBoundary);
    svg.appendChild(layerNatural);
    svg.appendChild(layerPolitical);
    svg.appendChild(layerInfra);
    svg.appendChild(layerDefence);
    wrap.appendChild(svg);
    container.innerHTML = '';
    container.appendChild(wrap);

    function setView(view) {
      layerNatural.style.display = (view === 'all' || view === 'natural') ? '' : 'none';
      layerPolitical.style.display = (view === 'all' || view === 'political') ? '' : 'none';
      layerInfra.style.display = (view === 'all' || view === 'infrastructural') ? '' : 'none';
      layerDefence.style.display = (view === 'all' || view === 'defence') ? '' : 'none';
    }
    setView('all');

    // Converts a click on the SVG into LOCAL-space coordinates, so
    // callers don't have to deal with the viewBox/CTM math.
    function clientPointToLocal(evt) {
      var pt = svg.createSVGPoint();
      pt.x = evt.clientX;
      pt.y = evt.clientY;
      var ctm = svg.getScreenCTM();
      if (!ctm) return null;
      var local = pt.matrixTransform(ctm.inverse());
      return { x: local.x, y: local.y };
    }

    return {
      svg: svg,
      wrap: wrap,
      layers: {
        boundary: layerBoundary,
        natural: layerNatural,
        political: layerPolitical,
        infrastructure: layerInfra,
        defence: layerDefence
      },
      setView: setView,
      clientPointToLocal: clientPointToLocal,
      pointsToAttr: pointsToAttr
    };
  }

  return {
    loadGeometry: loadGeometry,
    render: render,
    pointInPolygon: pointInPolygon,
    pointsToAttr: pointsToAttr
  };
})();
