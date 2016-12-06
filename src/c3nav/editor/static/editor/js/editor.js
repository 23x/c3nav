editor = {
    init: function () {
        // Init Map
        editor.map = L.map('map', {
            zoom: 2,
            maxZoom: 10,
            minZoom: 1,
            crs: L.CRS.Simple,
            editable: true,
            closePopupOnClick: false
        });
        editor.map.on('click', function () {
            editor.map.doubleClickZoom.enable();
        });

        L.control.scale({imperial: false}).addTo(editor.map);

        $('#show_map').click(function() {
            $('body').removeClass('controls');
        });
        $('#show_details').click(function() {
            $('body').addClass('controls');
        });

        editor.init_geometries();
        editor.init_sidebar();
        editor.get_packages();
        editor.get_sources();
        editor.get_levels();
    },

    // packages
    packages: {},
    get_packages: function () {
        // load packages
        $.getJSON('/api/packages/', function (packages) {
            var bounds = [[0, 0], [0, 0]];
            var pkg;
            for (var i = 0; i < packages.length; i++) {
                pkg = packages[i];
                editor.packages[pkg.name] = pkg;
                if (pkg.bounds === null) continue;
                bounds = [[Math.min(bounds[0][0], pkg.bounds[0][0]), Math.min(bounds[0][1], pkg.bounds[0][1])],
                    [Math.max(bounds[1][0], pkg.bounds[1][0]), Math.max(bounds[1][1], pkg.bounds[1][1])]];
            }
            editor.map.setMaxBounds(bounds);
            editor.map.fitBounds(bounds, {padding: [30, 50]});
        });
    },

    // sources
    sources: {},
    get_sources: function () {
        // load sources
        $.getJSON('/api/sources/', function (sources) {
            var layers = {};
            var source;
            for (var i = 0; i < sources.length; i++) {
                source = sources[i];
                editor.sources[source.name] = source;
                source.layer = L.imageOverlay('/api/sources/' + source.name + '/image/', source.bounds);
                layers[source.name] = source.layer;
            }
            var control = L.control.layers([], layers).addTo(editor.map);
            $(control._layersLink).text('Sources');
        });
    },

    // levels
    levels: {},
    _level: null,
    _loading_geometry: true,
    _level_fake_layers: {},
    get_levels: function () {
        // load levels and set the lowest one afterwards
        $.getJSON('/api/levels/?ordering=-altitude', function (levels) {
            var control = L.control.layers([], [], {
                position: 'bottomright'
            }).addTo(editor.map);
            $(control._layersLink).text('Levels').parent().addClass('leaflet-levels');

            var level, layer;
            for (var i = 0; i < levels.length; i++) {
                level = levels[i];
                layer = L.circle([-200, -200], 0.1);
                layer._c3nav_level = level.name;
                layer.on('add', editor._click_level);
                editor._level_fake_layers[level.name] = layer;
                control.addBaseLayer(layer, level.name);
            }

            editor._loading_geometry = false;
            editor.set_current_level(levels[levels.length - 1].name);
        });
    },
    _click_level: function(e) {
        if (editor._level === null) return;
        var level = e.target._c3nav_level;
        var success = editor.set_current_level(level);
        if (!success) {
            editor._level_fake_layers[level].remove();
            editor._level_fake_layers[editor._level].addTo(editor.map);
        }
    },
    set_current_level: function(level_name) {
        // sets the current level if the sidebar allows it
        if (editor._loading_geometry) return false;
        var level_switch = $('#mapeditcontrols').find('[data-level-switch]');
        if (level_switch.length === 0) return;
        editor._loading_geometry = true;
        if (editor._level !== null) {
            editor._level_fake_layers[editor._level].remove();
        }
        editor._level_fake_layers[level_name].addTo(editor.map);
        editor._level = level_name;
        editor.get_geometries();

        var level_switch_href = level_switch.attr('data-level-switch');
        if (level_switch_href) {
            editor.sidebar_get(level_switch_href.replace('LEVEL', level_name));
        }
        return true;
    },

    // geometries
    _geometries_layer: null,
    _highlight_layer: null,
    _editing_layer: null,
    _get_geometries_next_time: false,
    _geometries: {},
    _creating: false,
    _editing: null,
    _geometry_types: [],
    _shown_geometry_types: {},
    init_geometries: function () {
        // init geometries and edit listeners
        editor._highlight_layer = L.layerGroup().addTo(editor.map);
        editor._editing_layer = L.layerGroup().addTo(editor.map);

        $('#mapeditcontrols').on('mouseenter', '.itemtable tr[data-name]', editor._hover_mapitem_row)
                             .on('mouseleave', '.itemtable tr[data-name]', editor._unhighlight_geometry);

        editor.map.on('editable:drawing:commit', editor._done_creating);
        editor.map.on('editable:editing', editor._update_editing);
        editor.map.on('editable:drawing:cancel', editor._canceled_creating);

        editor._get_geometry_types();
    },
    _get_geometry_types: function() {
        $.getJSON('/api/geometrytypes/', function(geometrytypes) {
            var layers = {};
            var geometrytype, layer;
            for (var i = 0; i < geometrytypes.length; i++) {
                geometrytype = geometrytypes[i];
                layer = L.circle([-200, -200], 0.1);
                layer._c3nav_geometry_type = geometrytype.name;
                layer.on('add', editor._add_geometrytype_layer);
                layer.on('remove', editor._remove_geometrytype_layer);
                layer.addTo(editor.map);
                layers[geometrytype.title_plural] = layer;
                editor._geometry_types.push(geometrytype.name)
                editor._shown_geometry_types[geometrytype.name] = true;
            }
            var control = L.control.layers([], layers).addTo(editor.map);
            $(control._layersLink).text('Types');
        });
    },
    _add_geometrytype_layer: function(e) {
        var type = e.target._c3nav_geometry_type;
        if (!editor._shown_geometry_types[type]) {
            if (editor._loading_geometry) {
                e.target.addTo(map);
                return;
            }
            editor._loading_geometry = true;
            editor._shown_geometry_types[type] = true;
            editor.get_geometries();
        }
    },
    _remove_geometrytype_layer: function(e) {
        var type = e.target._c3nav_geometry_type;
        if (editor._shown_geometry_types[type]) {
            if (editor._loading_geometry) {
                e.target.addTo(map);
                return;
            }
            editor._loading_geometry = true;
            editor._shown_geometry_types[type] = false;
            editor.get_geometries();
        }
    },
    get_geometries: function () {
        // reload geometries of current level
        editor._geometries = {};
        if (editor._geometries_layer !== null) {
            editor.map.removeLayer(editor._geometries_layer);
        }
        geometrytypes = '';
        for (var i = 0; i < editor._geometry_types.length; i++) {
            if (editor._shown_geometry_types[editor._geometry_types[i]]) {
                geometrytypes += '&type=' + editor._geometry_types[i];
            }
        }
        $.getJSON('/api/geometries/?level='+String(editor._level)+geometrytypes, function(geometries) {
            editor._geometries_layer = L.geoJSON(geometries, {
                style: editor._get_geometry_style,
                onEachFeature: editor._register_geojson_feature
            });

            editor._geometries_layer.addTo(editor.map);
            editor._loading_geometry = false;
        });
    },
    _geometry_colors: {
        'building': '#333333',
        'room': '#FFFFFF',
        'outside': '#EEFFEE',
        'obstacle': '#999999',
        'door': '#FF00FF',
        'hole': '#66CC66',
        'elevatorlevel': '#9EF8FB',
        'levelconnector': '#FFFF00'
    },
    _get_geometry_style: function (feature) {
        // style callback for GeoJSON loader
        return editor._get_mapitem_type_style(feature.properties.type);
    },
    _get_mapitem_type_style: function (mapitem_type) {
        // get styles for a specific mapitem
        return {
            fillColor: editor._geometry_colors[mapitem_type],
            weight: 0,
            fillOpacity: 0.6,
            smoothFactor: 0
        };
    },
    _register_geojson_feature: function (feature, layer) {
        // onEachFeature callback for GeoJSON loader – register all needed events
        editor._geometries[feature.properties.type+'-'+feature.properties.name] = layer;
        layer.on('mouseover', editor._hover_geometry_layer)
             .on('mouseout', editor._unhighlight_geometry)
             .on('click', editor._click_geometry_layer)
             .on('dblclick', editor._dblclick_geometry_layer)
    },

    // hover and highlight geometries
    _hover_mapitem_row: function () {
        // hover callback for a itemtable row
        editor._highlight_geometry($(this).closest('.itemtable').attr('data-mapitem-type'), $(this).attr('data-name'));
    },
    _hover_geometry_layer: function (e) {
        // hover callback for a geometry layer
        editor._highlight_geometry(e.target.feature.properties.type, e.target.feature.properties.name);
    },
    _click_geometry_layer: function (e) {
        // click callback for a geometry layer – scroll the corresponding itemtable row into view if it exists
        var properties = e.target.feature.properties;
        var row = $('.itemtable[data-mapitem-type='+properties.type+'] tr[data-name="'+properties.name+'"]');
        if (row.length) {
            row[0].scrollIntoView();
        }
    },
    _dblclick_geometry_layer: function (e) {
        // dblclick callback for a geometry layer - edit this feature if the corresponding itemtable row exists
        var properties = e.target.feature.properties;
        var row = $('.itemtable[data-mapitem-type='+properties.type+'] tr[data-name="'+properties.name+'"]');
        if (row.length) {
            row.find('td:last-child a').click();
            editor.map.doubleClickZoom.disable();
        }
    },
    _highlight_geometry: function(mapitem_type, name) {
        // highlight a geometries layer and itemtable row if they both exist
        var pk = mapitem_type+'-'+name;
        editor._unhighlight_geometry();
        var layer = editor._geometries[pk];
        var row = $('.itemtable[data-mapitem-type='+mapitem_type+'] tr[data-name="'+name+'"]');
        if (layer !== undefined && row.length) {
            row.addClass('highlight');
            L.geoJSON(layer.feature, {
                style: function() {
                    return {
                        color: '#FFFFDD',
                        weight: 3,
                        opacity: 0.7,
                        fillOpacity: 0,
                        className: 'c3nav-highlight'
                    };
                }
            }).addTo(editor._highlight_layer);
        }
    },
    _unhighlight_geometry: function() {
        // unhighlight whatever is highlighted currently
        editor._highlight_layer.clearLayers();
        $('.itemtable .highlight').removeClass('highlight');
    },

    // edit and create geometries
    _check_start_editing: function() {
        // called on sidebar load. start editing or creating depending on how the sidebar may require it
        var mapeditcontrols = $('#mapeditcontrols');
        var geometry_field = mapeditcontrols.find('input[name=geometry]');

        var id_name = $('#id_name');
        id_name.focus();
        if (mapeditcontrols.find('[data-new]').length) {
            id_name.select();
        }

        if (geometry_field.length) {
            var form = geometry_field.closest('form');
            var mapitem_type = form.attr('data-mapitem-type');
            if (geometry_field.val() != '') {
                // edit existing geometry
                if (form.is('[data-name]')) {
                    var name = form.attr('data-name');
                    var pk = mapitem_type+'-'+name;
                    editor._geometries_layer.removeLayer(editor._geometries[pk]);
                }

                editor._editing = L.geoJSON({
                    type: 'Feature',
                    geometry: JSON.parse(geometry_field.val()),
                    properties: {
                        type: mapitem_type
                    }
                }, {
                    style: editor._get_geometry_style
                }).getLayers()[0];
                editor._editing.on('click', editor._click_editing_layer);
                editor._editing.addTo(editor._editing_layer);
                editor._editing.enableEdit();
            } else if (form.is('[data-geomtype]')) {
                // create new geometry
                form.addClass('creation-lock');
                var geomtype = form.attr('data-geomtype');

                var options = editor._get_mapitem_type_style(mapitem_type);
                if (geomtype == 'polygon') {
                    editor.map.editTools.startPolygon(null, options);
                } else if (geomtype == 'polyline') {
                    editor.map.editTools.startPolyline(null, options);
                }
                editor._creating = true;
                $('#id_level').val(editor._level);
                $('#id_levels').find('option[value='+editor._level+']').prop('selected', true);
            }
        } else if (editor._get_geometries_next_time) {
            editor.get_geometries();
            editor._get_geometries_next_time = false;
        }
    },
    _cancel_editing: function() {
        // called on sidebar unload. cancel all editing and creating.
        if (editor._editing !== null) {
            editor._editing_layer.clearLayers();
            editor._editing.disableEdit();
            editor._editing = null;
            editor._get_geometries_next_time = true;
        }
        if (editor._creating) {
            editor._creating = false;
            editor.map.editTools.stopDrawing();
        }
    },
    _canceled_creating: function (e) {
        // called after we canceled creating so we can remove the temporary layer.
        if (!editor._creating) {
            e.layer.remove();
        }
    },
    _click_editing_layer: function(e) {
        // click callback for a currently edited layer. create a hole on ctrl+click.
        if ((e.originalEvent.ctrlKey || e.originalEvent.metaKey)) {
            if (e.target.feature.geometry.type == 'Polygon') {
                this.editor.newHole(e.latlng);
            }
        }
    },
    _done_creating: function(e) {
        // called when creating is completed (by clicking on the last point). fills in the form and switches to editing.
        if (editor._creating) {
            editor._creating = false;
            editor._editing = e.layer;
            editor._editing.addTo(editor._editing_layer);
            editor._editing.on('click', editor._click_editing_layer);
            editor._update_editing();
            $('#mapeditcontrols').find('form.creation-lock').removeClass('creation-lock');
        }
    },
    _update_editing: function () {
        // called if the temporary drawing layer changes. if we are in editing mode (not creating), update the form.
        if (editor._editing !== null) {
            $('#id_geometry').val(JSON.stringify(editor._editing.toGeoJSON().geometry));
        }
    },

    // sidebar
    sidebar_location: null,
    init_sidebar: function() {
        // init the sidebar. sed listeners for form submits and link clicks
        $('#mapeditcontrols').on('click', 'a[href]', editor._sidebar_link_click)
                             .on('click', 'button[type=submit]', editor._sidebar_submit_btn_click)
                             .on('submit', 'form', editor._sidebar_submit);
    },
    sidebar_get: function(location) {
        // load a new page into the sidebar using a GET request
        editor._sidebar_unload();
        $.get(location, editor._sidebar_loaded);
    },
    _sidebar_unload: function() {
        // unload the sidebar. called on sidebar_get and form submit.
        $('#mapeditcontrols').html('').addClass('loading');
        editor._unhighlight_geometry();
        editor._cancel_editing();
    },
    _sidebar_loaded: function(data) {
        // sidebar was loaded. load the content. check if there are any redirects. call _check_start_editing.
        var content = $(data);
        var mapeditcontrols = $('#mapeditcontrols');
        mapeditcontrols.html(content).removeClass('loading');

        var redirect = mapeditcontrols.find('form[name=redirect]');
        if (redirect.length) {
            redirect.submit();
            return;
        }

        redirect = $('span[data-redirect]');
        if (redirect.length) {
            editor.sidebar_get(redirect.attr('data-redirect').replace('LEVEL', editor._level));
            return;
        }

        editor._check_start_editing();
    },
    _sidebar_link_click: function(e) {
        // listener for link-clicks in the sidebar.
        e.preventDefault();
        if ($(this).is('[data-level-link]')) {
            editor.set_current_level($(this).attr('data-level-link'));
            return;
        }
        var href = $(this).attr('href');
        if ($(this).is('[data-insert-level]')) {
            href = href.replace('LEVEL', editor._level);
        }
        editor.sidebar_get(href);
    },
    _sidebar_submit_btn_click: function() {
        // listener for submit-button-clicks in the sidebar, so the submit event will know which button submitted.
        $(this).closest('form').data('btn', $(this)).clearQueue().delay(300).queue(function() {
            $(this).data('btn', null);
        });
    },
    _sidebar_submit: function(e) {
        // listener for form submits in the sidebar.
        if ($(this).attr('name') == 'redirect') return;
        e.preventDefault();
        var data = $(this).serialize();
        var btn = $(this).data('btn');
        if (btn !== undefined && btn !== null) {
            if ($(btn).is('[name]')) {
                data += '&' + $('<input>').attr('name', $(btn).attr('name')).val($(btn).val()).serialize();
            }
            if ($(btn).is('[data-reload-geometries]')) {
                editor._get_geometries_next_time = true;
            }
        }
        var action = $(this).attr('action');
        editor._sidebar_unload();
        $.post(action, data, editor._sidebar_loaded);
    }
};


if ($('#mapeditcontrols').length) {
    editor.init();
}
