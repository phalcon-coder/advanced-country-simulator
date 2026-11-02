// ============================================================
// js/modules/provinces-cities.js — the Provinces & Cities
// sidebar module. Two tabs (Provinces / Cities) drawn on top of
// the per-country map built by js/modules/countrymap.js.
//
// Reads/writes Supabase tables: provinces, cities,
// city_infrastructure (see docs/database.md / 003_provinces_cities.sql).
// Everything a player draws is stored in the country's LOCAL
// coordinate space (see countrymap.js) — never world space.
// ============================================================

var ProvincesCitiesModule = (function () {
  var MIN_CITY_CLEARANCE = 18; // local-space units a province border must stay away from any city

  // Module-local state, reset each time the module is (re)rendered
  var geom = null;
  var mapHandle = null;
  var provinces = [];
  var cities = [];
  var activeTab = 'provinces';
  var sortMode = 'alpha'; // 'alpha' | 'population' | 'income'
  var drawState = null;    // { tool:'straight'|'freehand', points:[...] } while drawing a province
  var editingProvinceId = null;
  var selectedProvinceId = null; // Cities tab: which province is selected
  var selectedCityId = null;
  var placingCity = false;
  var placingInfraType = null;

  function countryId() { return GameState.country.id; }

  // ---------- Supabase I/O ----------

  function loadData() {
    return Promise.all([
      supabase.from('provinces').select('*').eq('country_id', countryId()),
      supabase.from('cities').select('*').eq('country_id', countryId())
    ]).then(function (results) {
      var pRes = results[0], cRes = results[1];
      if (pRes.error) console.error('Loading provinces failed:', pRes.error.message);
      if (cRes.error) console.error('Loading cities failed:', cRes.error.message);
      provinces = pRes.data || [];
      cities = cRes.data || [];
    });
  }

  function loadInfraFor(cityId) {
    return supabase.from('city_infrastructure').select('*').eq('city_id', cityId)
      .then(function (res) {
        if (res.error) { console.error('Loading infrastructure failed:', res.error.message); return []; }
        return res.data || [];
      });
  }

  // ---------- Geometry helpers ----------

  function distancePointToSegment(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var lenSq = dx * dx + dy * dy;
    var t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    var proj = { x: a.x + t * dx, y: a.y + t * dy };
    return Math.hypot(p.x - proj.x, p.y - proj.y);
  }

  function lineTooCloseToAnyCity(points) {
    for (var i = 0; i < points.length - 1; i++) {
      for (var c = 0; c < cities.length; c++) {
        if (cities[c].status === 'deserted') continue;
        var d = distancePointToSegment({ x: cities[c].x, y: cities[c].y }, points[i], points[i + 1]);
        if (d < MIN_CITY_CLEARANCE) return true;
      }
    }
    return false;
  }

  function allPointsInsideCountry(points) {
    return points.every(function (p) { return geom.containsLocalPoint(p.x, p.y); });
  }

  function polygonCentroid(points) {
    var x = 0, y = 0;
    points.forEach(function (p) { x += p.x; y += p.y; });
    return { x: x / points.length, y: y / points.length };
  }

  // ---------- Redraw the political layer on the map ----------

  function redrawPoliticalLayer() {
    if (!mapHandle) return;
    var ns = 'http://www.w3.org/2000/svg';
    var layer = mapHandle.layers.political;
    layer.innerHTML = '';

    provinces.forEach(function (prov) {
      var pts = prov.boundary || [];
      if (pts.length < 3) return;
      var poly = document.createElementNS(ns, 'polygon');
      poly.setAttribute('points', mapHandle.pointsToAttr(pts));
      poly.setAttribute('class', 'province-shape' + (prov.id === editingProvinceId ? ' editing' : ''));
      poly.setAttribute('data-province-id', prov.id);
      poly.style.fill = prov.is_capital_province ? 'rgba(212,175,55,0.22)' : 'rgba(90,134,168,0.16)';
      poly.style.stroke = prov.is_capital_province ? '#d4af37' : 'rgba(200,180,140,0.55)';
      poly.style.strokeWidth = '1.5';
      poly.style.cursor = 'pointer';
      poly.addEventListener('click', function () { onProvinceShapeClick(prov.id); });
      layer.appendChild(poly);

      var c = polygonCentroid(pts);
      var label = document.createElementNS(ns, 'text');
      label.setAttribute('x', c.x);
      label.setAttribute('y', c.y);
      label.setAttribute('class', 'province-label');
      label.setAttribute('text-anchor', 'middle');
      label.textContent = prov.name;
      layer.appendChild(label);
    });

    cities.forEach(function (city) {
      var g = document.createElementNS(ns, 'g');
      g.setAttribute('class', 'city-marker' + (city.status === 'deserted' ? ' deserted' : ''));
      g.setAttribute('transform', 'translate(' + city.x + ',' + city.y + ')');
      var dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('r', city.is_country_capital ? 7 : 5);
      dot.setAttribute('class', 'city-dot' + (city.is_country_capital ? ' capital' : ''));
      g.appendChild(dot);
      var label = document.createElementNS(ns, 'text');
      label.setAttribute('y', -10);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('class', 'city-label');
      label.textContent = city.name + (city.status === 'deserted' ? ' (deserted)' : '');
      g.appendChild(label);
      g.style.cursor = 'pointer';
      g.addEventListener('click', function (e) { e.stopPropagation(); onCityMarkerClick(city.id); });
      layer.appendChild(g);
    });

    // In-progress drawing preview
    if (drawState && drawState.points.length) {
      var preview = document.createElementNS(ns, 'polyline');
      preview.setAttribute('points', mapHandle.pointsToAttr(drawState.points));
      preview.setAttribute('class', 'province-draw-preview');
      layer.appendChild(preview);
      drawState.points.forEach(function (p) {
        var dot = document.createElementNS(ns, 'circle');
        dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y); dot.setAttribute('r', 3);
        dot.setAttribute('class', 'province-draw-vertex');
        layer.appendChild(dot);
      });
    }
  }

  function redrawInfraLayer(cityId, infraRows) {
    var ns = 'http://www.w3.org/2000/svg';
    var layer = mapHandle.layers.infrastructure;
    layer.innerHTML = '';
    var ICONS = {
      water_pump: '💧', sewage_plant: '♻️', wastewater_treatment: '🚰',
      fire_station: '🚒', police_station: '🚓', hospital: '🏥'
    };
    infraRows.forEach(function (row) {
      var g = document.createElementNS(ns, 'g');
      g.setAttribute('transform', 'translate(' + row.x + ',' + row.y + ')');
      var text = document.createElementNS(ns, 'text');
      text.setAttribute('font-size', 14);
      text.setAttribute('text-anchor', 'middle');
      text.textContent = ICONS[row.type] || '■';
      g.appendChild(text);
      layer.appendChild(g);
    });
  }

  // ---------- Map click routing ----------

  function onMapClick(evt) {
    var local = mapHandle.clientPointToLocal(evt);
    if (!local) return;

    if (drawState) {
      handleDrawClick(local);
      return;
    }
    if (placingCity) {
      handlePlaceCityClick(local);
      return;
    }
    if (placingInfraType) {
      handlePlaceInfraClick(local);
      return;
    }
  }

  function onProvinceShapeClick(provinceId) {
    if (activeTab !== 'provinces' || !editingProvinceId) return;
    // Selecting a province while in edit mode (list "Edit" already picks
    // the target — clicking the shape itself is just a convenience/no-op
    // guard so stray clicks while drawing don't do anything surprising).
  }

  function onCityMarkerClick(cityId) {
    if (activeTab !== 'cities') return;
    selectCity(cityId);
  }

  // ---------- Provinces tab ----------

  function startDraw(tool) {
    drawState = { tool: tool, points: [] };
    redrawPoliticalLayer();
    renderActiveTab();
  }

  function cancelDraw() {
    drawState = null;
    redrawPoliticalLayer();
    renderActiveTab();
  }

  function handleDrawClick(local) {
    var pts = drawState.points;

    // Closing the loop: click near the first vertex (straight tool),
    // or just call finishDraw() from the "Finish shape" button (freehand).
    if (pts.length >= 3 && Math.hypot(local.x - pts[0].x, local.y - pts[0].y) < 12) {
      finishDraw();
      return;
    }

    if (!geom.containsLocalPoint(local.x, local.y)) {
      alert("That point is outside your country's border.");
      return;
    }
    if (pts.length && lineTooCloseToAnyCity([pts[pts.length - 1], local])) {
      alert('A province border can\'t cut through a city — click further away.');
      return;
    }

    pts.push(local);
    redrawPoliticalLayer();
    renderActiveTab();
  }

  function finishDraw() {
    var pts = drawState.points;
    if (pts.length < 3) { alert('Draw at least 3 points to close a province shape.'); return; }
    if (!allPointsInsideCountry(pts) || lineTooCloseToAnyCity(pts.concat([pts[0]]))) {
      alert("That shape isn't valid — check it stays inside your border and clear of any city.");
      return;
    }
    var name = prompt('Name this province:', '');
    if (name === null) return;

    supabase.from('provinces').insert({
      country_id: countryId(),
      name: name.trim() || 'Unnamed Province',
      boundary: pts,
      is_capital_province: provinces.length === 0 // first province drawn, provisionally — corrected once a capital city exists
    }).select().then(function (res) {
      if (res.error) { alert('Could not save province: ' + res.error.message); return; }
      provinces.push(res.data[0]);
      drawState = null;
      redrawPoliticalLayer();
      renderActiveTab();
    });
  }

  function resetAllProvinces() {
    if (!confirm('Reset ALL provinces for this country? This deletes every drawn province (cities are kept).')) return;
    supabase.from('provinces').delete().eq('country_id', countryId()).then(function (res) {
      if (res.error) { alert('Could not reset provinces: ' + res.error.message); return; }
      provinces = [];
      editingProvinceId = null;
      redrawPoliticalLayer();
      renderActiveTab();
    });
  }

  function deleteProvince(provinceId) {
    var hasCities = cities.some(function (c) { return c.province_id === provinceId && c.status !== 'deserted'; });
    if (hasCities) { alert("Can't delete a province that still has active cities in it."); return; }
    if (!confirm('Delete this province?')) return;
    supabase.from('provinces').delete().eq('id', provinceId).then(function (res) {
      if (res.error) { alert('Could not delete: ' + res.error.message); return; }
      provinces = provinces.filter(function (p) { return p.id !== provinceId; });
      redrawPoliticalLayer();
      renderActiveTab();
    });
  }

  function renameProvince(provinceId) {
    var prov = provinces.find(function (p) { return p.id === provinceId; });
    var name = prompt('Rename province:', prov.name);
    if (name === null || !name.trim()) return;
    supabase.from('provinces').update({ name: name.trim() }).eq('id', provinceId).select().then(function (res) {
      if (res.error) { alert('Could not rename: ' + res.error.message); return; }
      prov.name = res.data[0].name;
      redrawPoliticalLayer();
      renderActiveTab();
    });
  }

  function setProvinceCapitalCity(provinceId, cityId) {
    supabase.from('provinces').update({ capital_city_id: cityId || null }).eq('id', provinceId).select()
      .then(function (res) {
        if (res.error) { alert('Could not set capital: ' + res.error.message); return; }
        var prov = provinces.find(function (p) { return p.id === provinceId; });
        prov.capital_city_id = res.data[0].capital_city_id;
        renderActiveTab();
      });
  }

  function sortedProvinces() {
    var capital = provinces.filter(function (p) { return p.is_capital_province; });
    var rest = provinces.filter(function (p) { return !p.is_capital_province; });
    // Population/income aren't real yet (see docs/database.md) — sorting
    // by them is a no-op until those systems exist, alphabetical stands in.
    rest.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return capital.concat(rest);
  }

  function renderProvincesTab(container) {
    var html = '';
    html += '<div class="pc-toolbar">';
    if (!drawState) {
      html += '<button class="btn btn-primary" data-action="draw-straight"><i class="fas fa-draw-polygon"></i> Draw province (straight)</button>';
      html += '<button class="btn" data-action="draw-freehand"><i class="fas fa-pen"></i> Draw province (freehand)</button>';
      html += '<button class="btn btn-danger" data-action="reset-provinces"><i class="fas fa-rotate-left"></i> Reset all provinces</button>';
    } else {
      html += '<span class="pc-hint">Click points on the map' + (drawState.tool === 'freehand' ? ' (freehand — each click adds a point)' : '') + '. Click back near your first point, or press Finish, to close the shape.</span>';
      html += '<button class="btn btn-primary" data-action="finish-draw"><i class="fas fa-check"></i> Finish shape</button>';
      html += '<button class="btn" data-action="cancel-draw"><i class="fas fa-xmark"></i> Cancel</button>';
    }
    html += '</div>';

    html += '<div class="pc-list-header">';
    html += '<span>Provinces (' + provinces.length + ')</span>';
    html += '<label class="pc-sort">Sort by: <select id="pcSortSelect">';
    ['alpha', 'population', 'income'].forEach(function (m) {
      html += '<option value="' + m + '"' + (sortMode === m ? ' selected' : '') + '>' + (m === 'alpha' ? 'Alphabetical' : m[0].toUpperCase() + m.slice(1)) + '</option>';
    });
    html += '</select></label></div>';

    html += '<div class="pc-province-list">';
    if (!provinces.length) {
      html += '<div class="empty-state small"><p>No provinces yet — draw your first one above.</p></div>';
    }
    sortedProvinces().forEach(function (prov) {
      var provCities = cities.filter(function (c) { return c.province_id === prov.id; });
      var capitalCity = cities.find(function (c) { return c.id === prov.capital_city_id; });
      html += '<div class="pc-province-card' + (prov.is_capital_province ? ' is-capital' : '') + '">';
      html += '<div class="pc-province-card-head">';
      html += '<strong>' + (prov.is_capital_province ? '<i class="fas fa-crown" title="Capital province"></i> ' : '') + prov.name + '</strong>';
      html += '<span class="pc-province-actions">';
      html += '<button class="icon-btn" data-action="rename-province" data-id="' + prov.id + '" title="Rename"><i class="fas fa-pen"></i></button>';
      html += '<button class="icon-btn danger" data-action="delete-province" data-id="' + prov.id + '" title="Delete"><i class="fas fa-trash"></i></button>';
      html += '</span></div>';
      html += '<div class="pc-province-details">';
      html += '<div><span class="pc-field-label">Capital city</span> <select data-action="set-capital-city" data-id="' + prov.id + '"><option value="">— none —</option>';
      provCities.forEach(function (c) {
        html += '<option value="' + c.id + '"' + (c.id === prov.capital_city_id ? ' selected' : '') + '>' + c.name + '</option>';
      });
      html += '</select></div>';
      html += '<div><span class="pc-field-label">Population</span> —</div>';
      html += '<div><span class="pc-field-label">Income</span> —</div>';
      html += '<div><span class="pc-field-label">Infrastructure level</span> —</div>';
      html += '<div><span class="pc-field-label">Administration</span> —</div>';
      html += '</div></div>';
    });
    html += '</div>';

    container.innerHTML = html;

    container.querySelector('[data-action="draw-straight"]') && container.querySelector('[data-action="draw-straight"]').addEventListener('click', function () { startDraw('straight'); });
    var fh = container.querySelector('[data-action="draw-freehand"]'); fh && fh.addEventListener('click', function () { startDraw('freehand'); });
    var rp = container.querySelector('[data-action="reset-provinces"]'); rp && rp.addEventListener('click', resetAllProvinces);
    var fd = container.querySelector('[data-action="finish-draw"]'); fd && fd.addEventListener('click', finishDraw);
    var cd = container.querySelector('[data-action="cancel-draw"]'); cd && cd.addEventListener('click', cancelDraw);

    var sortSel = container.querySelector('#pcSortSelect');
    sortSel && sortSel.addEventListener('change', function () { sortMode = this.value; renderActiveTab(); });

    container.querySelectorAll('[data-action="rename-province"]').forEach(function (btn) {
      btn.addEventListener('click', function () { renameProvince(this.dataset.id); });
    });
    container.querySelectorAll('[data-action="delete-province"]').forEach(function (btn) {
      btn.addEventListener('click', function () { deleteProvince(this.dataset.id); });
    });
    container.querySelectorAll('[data-action="set-capital-city"]').forEach(function (sel) {
      sel.addEventListener('change', function () { setProvinceCapitalCity(this.dataset.id, this.value); });
    });
  }

  // ---------- Cities tab ----------

  function selectCity(cityId) {
    selectedCityId = cityId;
    renderActiveTab();
  }

  function startPlaceCity() {
    if (!selectedProvinceId) { alert('Select a province first.'); return; }
    placingCity = true;
    renderActiveTab();
  }

  function handlePlaceCityClick(local) {
    var prov = provinces.find(function (p) { return p.id === selectedProvinceId; });
    if (!prov || !prov.boundary || prov.boundary.length < 3) {
      alert('This province has no boundary yet — draw its shape in the Provinces tab first.');
      placingCity = false; renderActiveTab(); return;
    }
    if (!CountryMap.pointInPolygon(local.x, local.y, prov.boundary)) {
      alert('Place the city inside the selected province.');
      return;
    }
    var name = prompt('Name this city:', '');
    if (name === null) { placingCity = false; renderActiveTab(); return; }

    var isFirstCity = cities.length === 0;
    supabase.from('cities').insert({
      country_id: countryId(),
      province_id: selectedProvinceId,
      name: name.trim() || 'Unnamed City',
      x: local.x, y: local.y,
      is_country_capital: isFirstCity
    }).select().then(function (res) {
      if (res.error) { alert('Could not save city: ' + res.error.message); return; }
      var city = res.data[0];
      cities.push(city);
      placingCity = false;
      if (isFirstCity) {
        markProvinceAsCapital(selectedProvinceId);
      } else {
        redrawPoliticalLayer();
        renderActiveTab();
      }
    });
  }

  function markProvinceAsCapital(provinceId) {
    // Clear any previous capital-province flag, then set this one —
    // done as two calls since the DB unique index only guards ONE
    // is_capital_province=true row at a time.
    supabase.from('provinces').update({ is_capital_province: false }).eq('country_id', countryId()).eq('is_capital_province', true)
      .then(function () {
        return supabase.from('provinces').update({ is_capital_province: true }).eq('id', provinceId).select();
      }).then(function (res) {
        provinces.forEach(function (p) { p.is_capital_province = (p.id === provinceId); });
        redrawPoliticalLayer();
        renderActiveTab();
      });
  }

  function desertCity(cityId) {
    var city = cities.find(function (c) { return c.id === cityId; });
    if (!confirm('Desert "' + city.name + '"? It stays on the map but stops counting toward the province — it can\'t be un-deserted from here.')) return;
    supabase.from('cities').update({ status: 'deserted' }).eq('id', cityId).select().then(function (res) {
      if (res.error) { alert('Could not update city: ' + res.error.message); return; }
      city.status = 'deserted';
      redrawPoliticalLayer();
      renderActiveTab();
    });
  }

  function startPlaceInfra(type) {
    placingInfraType = type;
    renderActiveTab();
  }

  function handlePlaceInfraClick(local) {
    var city = cities.find(function (c) { return c.id === selectedCityId; });
    if (Math.hypot(local.x - city.x, local.y - city.y) > 60) {
      alert('Place that closer to ' + city.name + '.');
      return;
    }
    supabase.from('city_infrastructure').insert({ city_id: city.id, type: placingInfraType, x: local.x, y: local.y })
      .select().then(function (res) {
        if (res.error) { alert('Could not place: ' + res.error.message); return; }
        placingInfraType = null;
        renderActiveTab();
      });
  }

  function renderCitiesTab(container) {
    var provOptions = sortedProvinces();
    if (!selectedProvinceId && provOptions.length) selectedProvinceId = provOptions[0].id;

    var html = '<div class="pc-toolbar">';
    html += '<label>Province: <select id="pcProvinceSelect">';
    if (!provOptions.length) html += '<option value="">No provinces yet</option>';
    provOptions.forEach(function (p) {
      html += '<option value="' + p.id + '"' + (p.id === selectedProvinceId ? ' selected' : '') + '>' + p.name + '</option>';
    });
    html += '</select></label>';
    if (placingCity) {
      html += '<span class="pc-hint">Click inside the province on the map to place the city.</span>';
      html += '<button class="btn" data-action="cancel-place-city">Cancel</button>';
    } else {
      html += '<button class="btn btn-primary" data-action="new-city"' + (provOptions.length ? '' : ' disabled') + '><i class="fas fa-city"></i> New city</button>';
    }
    html += '</div>';

    var provCities = cities.filter(function (c) { return c.province_id === selectedProvinceId; });
    html += '<div class="pc-city-list">';
    if (!provCities.length) html += '<div class="empty-state small"><p>No cities in this province yet.</p></div>';
    provCities.forEach(function (c) {
      html += '<div class="pc-city-row' + (c.id === selectedCityId ? ' selected' : '') + (c.status === 'deserted' ? ' deserted' : '') + '" data-action="select-city" data-id="' + c.id + '">';
      html += '<span>' + (c.is_country_capital ? '<i class="fas fa-star" title="Country capital"></i> ' : '') + c.name + (c.status === 'deserted' ? ' <em>(deserted)</em>' : '') + '</span>';
      if (c.status !== 'deserted') html += '<button class="btn-link danger" data-action="desert-city" data-id="' + c.id + '">Desert</button>';
      html += '</div>';
    });
    html += '</div>';

    // Selected city detail panel
    var city = cities.find(function (c) { return c.id === selectedCityId; });
    html += '<div class="pc-city-detail">';
    if (city) {
      html += '<h4>' + city.name + '</h4>';
      html += '<div class="pc-city-stats"><div>Population <b>—</b></div><div>Income <b>—</b></div><div>Status <b>' + city.status + '</b></div></div>';

      html += '<div class="pc-city-links">';
      [['industries', 'Industries'], ['diplomacy', 'Diplomacy'], ['administration', 'Administration'],
      ['defence', 'Defence'], ['entertainment', 'Entertainment'], ['transport', 'Connectivity']].forEach(function (m) {
        html += '<button class="btn btn-sm" data-action="goto-module" data-key="' + m[0] + '">' + m[1] + '</button>';
      });
      html += '</div>';

      html += '<div class="pc-infra-toolbar"><span class="pc-field-label">Place basic infrastructure:</span>';
      [['water_pump', 'Water pump'], ['sewage_plant', 'Sewage plant'], ['wastewater_treatment', 'Wastewater treatment'],
      ['fire_station', 'Fire station'], ['police_station', 'Police station'], ['hospital', 'Hospital']].forEach(function (t) {
        html += '<button class="btn btn-sm' + (placingInfraType === t[0] ? ' active' : '') + '" data-action="place-infra" data-type="' + t[0] + '">' + t[1] + '</button>';
      });
      if (placingInfraType) html += '<span class="pc-hint">Click near ' + city.name + ' on the map to place it.</span>';
      html += '</div>';
    } else {
      html += '<div class="empty-state small"><p>Select a city to see its details.</p></div>';
    }
    html += '</div>';

    container.innerHTML = html;

    var provSel = container.querySelector('#pcProvinceSelect');
    provSel && provSel.addEventListener('change', function () { selectedProvinceId = this.value; selectedCityId = null; renderActiveTab(); });

    var nb = container.querySelector('[data-action="new-city"]'); nb && nb.addEventListener('click', startPlaceCity);
    var cpc = container.querySelector('[data-action="cancel-place-city"]'); cpc && cpc.addEventListener('click', function () { placingCity = false; renderActiveTab(); });

    container.querySelectorAll('[data-action="select-city"]').forEach(function (row) {
      row.addEventListener('click', function (e) {
        if (e.target.closest('[data-action="desert-city"]')) return;
        selectCity(this.dataset.id);
      });
    });
    container.querySelectorAll('[data-action="desert-city"]').forEach(function (btn) {
      btn.addEventListener('click', function (e) { e.stopPropagation(); desertCity(this.dataset.id); });
    });
    container.querySelectorAll('[data-action="goto-module"]').forEach(function (btn) {
      btn.addEventListener('click', function () { navigateToModule(this.dataset.key); });
    });
    container.querySelectorAll('[data-action="place-infra"]').forEach(function (btn) {
      btn.addEventListener('click', function () { startPlaceInfra(this.dataset.type); });
    });

    if (city) {
      loadInfraFor(city.id).then(function (rows) { redrawInfraLayer(city.id, rows); });
    } else if (mapHandle) {
      mapHandle.layers.infrastructure.innerHTML = '';
    }
  }

  // ---------- Tab shell ----------

  function renderActiveTab() {
    var content = document.getElementById('pcTabContent');
    if (!content) return;
    if (activeTab === 'provinces') renderProvincesTab(content);
    else renderCitiesTab(content);
    redrawPoliticalLayer();
  }

  function render(container) {
    container.innerHTML = '<div class="pc-module"><div class="pc-tabs"><button class="pc-tab active" data-tab="provinces">Provinces</button><button class="pc-tab" data-tab="cities">Cities</button></div><div id="pcMapMount" class="pc-map-mount"></div><div id="pcTabContent" class="pc-tab-content"></div></div>';

    container.querySelectorAll('.pc-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        activeTab = this.dataset.tab;
        container.querySelectorAll('.pc-tab').forEach(function (b) { b.classList.remove('active'); });
        this.classList.add('active');
        drawState = null; placingCity = false; placingInfraType = null;
        renderActiveTab();
      });
    });

    var mapMount = container.querySelector('#pcMapMount');
    mapMount.innerHTML = '<div class="empty-state small"><p>Loading map…</p></div>';

    CountryMap.loadGeometry(countryId()).then(function (g) {
      geom = g;
      mapHandle = CountryMap.render(mapMount, geom);
      mapHandle.svg.addEventListener('click', onMapClick);
      return loadData();
    }).then(function () {
      renderActiveTab();
    }).catch(function (err) {
      console.error('Provinces & Cities failed to load:', err);
      mapMount.innerHTML = '<div class="empty-state small"><p>Could not load the country map — check the console.</p></div>';
    });
  }

  return { render: render };
})();
