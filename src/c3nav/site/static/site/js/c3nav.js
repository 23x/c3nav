(function () {
    if (L.Browser.chrome && !('ontouchstart' in window)) {
        L.Browser.pointer = false;
        L.Browser.touch = false;
    }
}());

c3nav = {
    init: function () {
        c3nav.init_map();

        c3nav._set_view('search');

        c3nav.init_locationinputs();

        $('#location-buttons').find('.route').on('click', c3nav._location_buttons_route_click);
        $('#route-search-buttons, #route-result-buttons').find('.swap').on('click', c3nav._route_buttons_swap_click);
        $('#route-search-buttons, #route-summary').find('.close').on('click', c3nav._route_buttons_close_click);
        $('#map').on('click', '.location-popup .button-clear', c3nav._popup_button_click);
    },

    _set_view: function(view) {
        c3nav._view = view;
        $('main').attr('data-view', view);
    },

    // button handlers
    _location_buttons_route_click: function () {
        c3nav._set_view('route-search');
        c3nav.update_map_locations();
        c3nav._locationinput_focus_next();
    },
    _route_buttons_swap_click: function () {
        var $origin = $('#origin-input'),
            $destination = $('#destination-input'),
            tmp = $origin.data('location');
        c3nav._locationinput_set($origin, $destination.data('location'), false);
        c3nav._locationinput_set($destination, tmp, false);
        $origin.stop().css('top', '55px').animate({top: 0}, 150);
        $destination.stop().css('top', '-55px').animate({top: 0}, 150);
        c3nav._locationinput_focus_next();
        c3nav.update_map_locations();
    },
    _route_buttons_close_click: function () {
        var $origin = $('#origin-input'),
            $destination = $('#destination-input');
        if ($origin.is('.selected') && !$destination.is('.selected')) {
            c3nav._locationinput_set($destination, $origin.data('location'), false);
        }
        c3nav._locationinput_set($origin, null, false);
        if ($destination.is('.selected')) {
            c3nav._set_view('location');
        } else {
            c3nav._set_view('search');
            $destination.find('input').focus();
        }
        c3nav.update_map_locations();
    },
    _popup_button_click: function () {
        var location = c3nav.locations_by_id[parseInt($(this).siblings('.location').attr('data-id'))],
            $origin = $('#origin-input'),
            $destination = $('#destination-input');
        if ($(this).is('.as-location')) {
            c3nav._locationinput_set($destination, location, false);
            c3nav._locationinput_set($origin, null, false);
            c3nav._set_view('location');
        } else {
            var $locationinput = $(this).is('.as-origin') ? $origin : $destination,
                $other_locationinput = $(this).is('.as-origin') ? $destination : $origin,
                other_location = $other_locationinput.data('location');
            c3nav._locationinput_set($locationinput, location, false);
            if (other_location === null || other_location === undefined) {
                c3nav._set_view('route-search');
            } else if (other_location.id !== location.id && (other_location.locations === undefined || other_location.locations.indexOf(location.id) === -1)) {
                c3nav._set_view('route-result');
            } else {
                c3nav._locationinput_set($other_locationinput, null, false);
                c3nav._set_view('route-search');
            }
        }
        c3nav.update_map_locations();
    },

    // location inputs
    init_locationinputs: function () {
        c3nav.locations = [];
        c3nav.locations_by_id = {};
        c3nav.current_locationinput = null;
        c3nav._last_match_words_key = null;
        $.getJSON('/api/locations/?searchable', function (data) {
            for (var i = 0; i < data.length; i++) {
                var location = data[i];
                location.elem = $('<div class="location">').append($('<span>').text(location.title))
                    .append($('<small>').text(location.subtitle)).attr('data-id', location.id);
                location.title_words = location.title.toLowerCase().split(/\s+/);
                location.match = ' ' + location.title_words.join(' ') + ' ';
                c3nav.locations.push(location);
                c3nav.locations_by_id[location.id] = location;
            }
        });

        $('.locationinput input').on('input', c3nav._locationinput_input)
            .on('blur', c3nav._locationinput_blur)
            .on('keydown', c3nav._locationinput_keydown);
        $('.locationinput .clear').on('click', c3nav._locationinput_clear);
        $('#autocomplete').on('mouseover', '.location', c3nav._locationinput_hover_suggestion)
            .on('click', '.location', c3nav._locationinput_click_suggestion);
        $('html').on('focus', '*', c3nav._locationinput_global_focuschange);
    },
    _locationinput_set: function (elem, location, update_map) {
        // set a location input
        c3nav._locationinput_reset_autocomplete();
        var location = (location === undefined) ? null : location,
            title = (location === null) ? '' : location.title,
            subtitle = (location === null) ? '' : location.subtitle;
        elem.toggleClass('selected', location !== null).toggleClass('empty', location === null)
            .data('location', location).data('lastlocation', location);
        elem.find('input').val(title).data('origval', null);
        elem.find('small').text(subtitle);

        switch(c3nav._view) {
            case 'search':
                if (elem.attr('id') === 'destination-input' && location !== null) {
                    c3nav._set_view('location');
                }
                break;
            case 'location':
                if (elem.attr('id') === 'destination-input' && location === null) {
                    c3nav._set_view('search');
                }
                break;
            case 'route-search':
                if (location !== null && $('#origin-input').is('.selected') && $('#destination-input').is('.selected')) {
                    c3nav._set_view('route-result');
                }
                break;
            case 'route-result':
                if (location === null) {
                    c3nav._set_view('route-search');
                }
                break;
        }
        if (update_map === undefined || update_map) {
            c3nav.update_map_locations();
            if (location !== null) {
                c3nav.fly_to_bounds();
            }
        }
    },
    _locationinput_reset: function (elem) {
        // reset this locationinput to its last location
        c3nav._locationinput_set(elem, elem.data('lastlocation'));
    },
    _locationinput_clear: function () {
        // clear this locationinput
        c3nav._locationinput_set($(this).parent(), null);
        $(this).parent().find('input').focus();
    },
    _locationinput_reset_autocomplete: function () {
        // hide autocomplete
        var $autocomplete = $('#autocomplete');
        $autocomplete.find('.focus').removeClass('focus');
        $autocomplete.html('');
        c3nav._last_locationinput_words_key = null;
        c3nav.current_locationinput = null;
    },
    _locationinput_blur: function () {
        // when a locationinput is blurred…
        var location = $(this).parent().data('location');
        if (location !== null && location !== undefined) {
            // if the current content is a location name, set it
            c3nav._locationinput_set($(this).parent(), location);
        } else {
            // otherwise, forget the last location
            $(this).parent().data('lastlocation', null);
        }
    },
    _locationinput_global_focuschange: function () {
        // when focus changed, reset autocomplete if it is outside of locationinputs or autocomplete
        if (c3nav.current_locationinput === null) return;
        if ($('#autocomplete > :focus, #' + c3nav.current_locationinput + ' > :focus').length === 0) {
            c3nav._locationinput_reset_autocomplete();
        }
    },
    _locationinput_keydown: function (e) {
        var $autocomplete = $('#autocomplete'), $focused, origval;
        if (e.which === 27) {
            // escape: reset the location input
            origval = $(this).data('origval');
            if (origval !== null) {
                $(this).val(origval);
                $(this).data('origval', null);
                $autocomplete.find('.focus').removeClass('focus')
            } else {
                c3nav._locationinput_reset($(this).parent());
            }
        } else if (e.which === 40 || e.which === 38) {
            // arrows up/down
            var $locations = $autocomplete.find('.location');
            if ($locations.length === 0) return;

            // save current input value in case we have to restore it
            origval = $(this).data('origval');
            if (origval === null || origval === undefined) {
                origval = $(this).val();
                $(this).data('origval', origval)
            }

            // find focused element and remove focus
            $focused = $locations.filter('.focus');
            $locations.removeClass('focus');

            // find next element
            var next;
            if ($focused.length === 0) {
                next = $locations.filter((e.which === 40) ? ':first-child' : ':last-child');
            } else {
                next = (e.which === 40) ? $focused.next() : $focused.prev();
            }

            if (next.length === 0) {
                // if there is no next element, restore original value
                $(this).val($(this).data('origval')).parent().data('location', null);
            } else {
                // otherwise, focus this element, and save location to the input
                next.addClass('focus');
                $(this).val(next.find('span').text()).parent()
                    .data('location', c3nav.locations_by_id[next.attr('data-id')]);
            }
        } else if (e.which === 13) {
            // enter: select currently focused suggestion or first suggestion
            $focused = $autocomplete.find('.location.focus');
            if ($focused.length === 0) {
                $focused = $autocomplete.find('.location:first-child');
            }
            if ($focused.length === 0) return;
            c3nav._locationinput_set($(this).parent(), c3nav.locations_by_id[$focused.attr('data-id')]);
            c3nav._locationinput_focus_next($(this).parent());
        }
    },
    _locationinput_hover_suggestion: function () {
        $(this).addClass('focus').siblings().removeClass('focus');
    },
    _locationinput_click_suggestion: function () {
        var $locationinput = $('#' + c3nav.current_locationinput);
        c3nav._locationinput_set($locationinput, c3nav.locations_by_id[$(this).attr('data-id')]);
        c3nav._locationinput_focus_next($locationinput);
    },
    _locationinput_focus_next: function (elem) {
        var $next = $('.locationinput:not(.selected)');
        if ($next.length === 0) {
            if (elem) elem.find('input').blur();
        } else {
            $next.find('input').focus();
        }
    },
    _locationinput_matches_compare: function (a, b) {
        if (a[1] !== b[1]) return b[1] - a[1];
        if (a[2] !== b[2]) return b[2] - a[2];
        if (a[3] !== b[3]) return b[3] - a[3];
        return a[4] - b[4];
    },
    _locationinput_input: function () {
        var matches = [],
            val = $(this).data('origval', null).val(),
            val_trimmed = $.trim(val),
            val_words = val_trimmed.toLowerCase().split(/\s+/),
            val_words_key = val_words.join(' '),
            $autocomplete = $('#autocomplete'),
            $parent = $(this).parent();
        $parent.toggleClass('empty', val === '');
        if ($parent.is('.selected')) {
            $parent.removeClass('selected').data('location', null);
            switch(c3nav._view) {
                case 'location':
                    if ($parent.attr('id') === 'destination-input') {
                        c3nav._set_view('search');
                    }
                    break;
                case 'route-result':
                    c3nav._set_view('route-search');
                    break;
            }
            c3nav.update_map_locations();
        }

        $autocomplete.find('.focus').removeClass('focus');
        c3nav.current_locationinput = $parent.attr('id');

        if (val_trimmed === '') {
            c3nav._locationinput_reset_autocomplete();
            return;
        }
        if (val_words_key === c3nav._last_locationinput_words_key) return;
        c3nav._last_locationinput_words_key = val_words_key;

        for (var i = 0; i < c3nav.locations.length; i++) {
            var location = c3nav.locations[i],
                leading_words_count = 0,
                words_total_count = 0,
                words_start_count = 0,
                nomatch = false,
                val_word, j;

            // each word has to be in the location
            for (j = 0; j < val_words.length; j++) {
                val_word = val_words[j];
                if (location.match.indexOf(val_word) === -1) {
                    nomatch = true;
                    break;
                }
            }
            if (nomatch) continue;

            // how many words from the beginning are in the title
            for (j = 0; j < val_words.length; j++) {
                val_word = val_words[0];
                if (location.title_words[j] !== val_word &&
                    (j !== val_words.length - 1 || location.title_words[j].indexOf(val_word) !== 0)) break;
                leading_words_count++;
            }

            // how many words in total can be found
            for (j = 0; j < val_words.length; j++) {
                val_word = val_words[0];
                if (location.match.indexOf(' ' + val_word + ' ') !== -1) {
                    words_total_count++;
                } else if (location.match.indexOf(' ' + val_word) !== -1) {
                    words_start_count++;
                }
            }

            matches.push([location.elem, leading_words_count, words_total_count, words_start_count, i])
        }

        matches.sort(c3nav._locationinput_matches_compare);

        $autocomplete.html('');
        var max_items = Math.min(matches.length, Math.floor($('#resultswrapper').height() / 55));
        for (i = 0; i < max_items; i++) {
            $autocomplete.append(matches[i][0]);
        }
    },

    // map
    init_map: function () {
        var $map = $('#map');
        c3nav.bounds = JSON.parse($map.attr('data-bounds'));
        c3nav.levels = JSON.parse($map.attr('data-levels'));

        // create leaflet map
        c3nav.map = L.map('map', {
            renderer: L.svg({padding: 2}),
            zoom: 2,
            maxZoom: 10,
            minZoom: 0,
            crs: L.CRS.Simple,
            maxBounds: L.GeoJSON.coordsToLatLngs(c3nav.bounds),
            zoomControl: false
        });
        c3nav.map.fitBounds(c3nav.bounds, {padding: [30, 50]});

        // set up icons
        L.Icon.Default.imagePath = '/static/leaflet/images/';
        c3nav._add_icon('origin');
        c3nav._add_icon('destination');

        // setup scale control
        L.control.scale({imperial: false}).addTo(c3nav.map);

        // setup level control
        c3nav._levelControl = new LevelControl().addTo(c3nav.map);
        c3nav._locationLayers = {};
        c3nav._locationLayerBounds = {};
        c3nav._routeLayers = {};
        for (var i = c3nav.levels.length - 1; i >= 0; i--) {
            var level = c3nav.levels[i];
            var layerGroup = c3nav._levelControl.addLevel(level[0], level[1]);
            c3nav._locationLayers[level[0]] = L.layerGroup().addTo(layerGroup);
            c3nav._routeLayers[level[0]] = L.layerGroup().addTo(layerGroup);
        }
        c3nav._levelControl.finalize();
        c3nav._levelControl.setLevel(c3nav.levels[0][0]);

        c3nav.schedule_refresh_tile_access();

    },
    _add_icon: function (name) {
        c3nav[name+'Icon'] = new L.Icon({
            iconUrl: '/static/img/marker-icon-'+name+'.png',
            iconRetinaUrl: '/static/img/marker-icon-\'+name+\'-2x.png',
            shadowUrl: '/static/leaflet/images/marker-shadow.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            tooltipAnchor: [16, -28],
            shadowSize: [41, 41]
        });
    },
    update_map_locations: function () {
        // update locations markers on the map
        var $origin = $('#origin-input'),
            $destination = $('#destination-input'),
            single = !$('main').is('[data-view^=route]'),
            bounds = {};
        for (var level_id in c3nav._locationLayers) {
            c3nav._locationLayers[level_id].clearLayers()
        }
        if ($origin.is('.selected')) {
            c3nav._merge_bounds(bounds, c3nav._add_location_to_map($origin.data('location'), single ? new L.Icon.Default() : c3nav.originIcon))
        }
        if ($destination.is('.selected')) {
            c3nav._merge_bounds(bounds, c3nav._add_location_to_map($destination.data('location'), single ? new L.Icon.Default() : c3nav.destinationIcon));
        }
        c3nav._locationLayerBounds = bounds;
    },
    fly_to_bounds: function() {
        // fly to the bounds of the current overlays
        var level = c3nav._levelControl.currentLevel,
            bounds = null;

        if (c3nav._locationLayerBounds[level] !== undefined) {
            bounds = c3nav._locationLayerBounds[level];
        } else {
            for (var level_id in c3nav._locationLayers) {
                if (c3nav._locationLayerBounds[level_id] !== undefined) {
                    bounds = c3nav._locationLayerBounds[level_id];
                    level = level_id
                }
            }
        }
        c3nav._levelControl.setLevel(level);
        if (bounds !== null) {
            var left = 0,
                top = (left === 0) ? $('#search').height()+10 : 10;
            c3nav.map.flyToBounds(bounds, c3nav._add_map_padding({
                duration: 1
            }, 'paddingTopLeft', 'paddingBottomRight'));
        }
    },
    _add_map_padding: function(options, topleft, bottomright) {
        // add padding information for the current ui layout to fitBoudns options
        var left = 0,
            top = (left === 0) ? $('#search').height()+10 : 10;
        options[topleft] = L.point(left+13, top+41);
        options[bottomright] = L.point(50, 20);
        return options;
    },
    _add_location_to_map: function(location, icon) {
        // add a location to the map as a marker
        if (location.locations !== undefined) {
            var bounds = {};
            for (var i=0; i<location.locations.length; i++) {
                c3nav._merge_bounds(bounds, c3nav._add_location_to_map(c3nav.locations_by_id[location.locations[i]], icon));
            }
            return bounds;
        }
        var latlng = L.GeoJSON.coordsToLatLng(location.point.slice(1));
        L.marker(latlng, {
            icon: icon
        }).bindPopup(location.elem[0].outerHTML+$('#popup-buttons').html(), c3nav._add_map_padding({
            className: 'location-popup'
        }, 'autoPanPaddingTopLeft', 'autoPanPaddingBottomRight')).addTo(c3nav._locationLayers[location.point[0]]);

        var result = {};
        result[location.point[0]] = L.latLngBounds(
            (location.bounds !== undefined) ? L.GeoJSON.coordsToLatLngs(location.bounds) : [latlng, latlng]
        );
        return result
    },
    _merge_bounds: function(bounds, new_bounds) {
        for (var level_id in new_bounds) {
            if (bounds[level_id] === undefined) {
                bounds[level_id] = new_bounds[level_id];
            } else {
                bounds[level_id] = bounds[level_id].extend(new_bounds[level_id]);
            }
        }
    },

    schedule_refresh_tile_access: function () {
        window.setTimeout(c3nav.refresh_tile_access, 16000);
    },
    refresh_tile_access: function () {
        $.ajax('/map/tile_access');
        c3nav.schedule_refresh_tile_access();
    }
};
$(document).ready(c3nav.init);


LevelControl = L.Control.extend({
    options: {
        position: 'bottomright',
        addClasses: ''
    },

    onAdd: function () {
        this._container = L.DomUtil.create('div', 'leaflet-control-levels leaflet-bar ' + this.options.addClasses);
        this._tileLayers = {};
        this._overlayLayers = {};
        this._levelButtons = {};
        this.currentLevel = null;
        return this._container;
    },

    addLevel: function (id, title) {
        this._tileLayers[id] = L.tileLayer('/map/' + String(id) + '/{z}/{x}/{y}.png', {
            bounds: L.GeoJSON.coordsToLatLngs(c3nav.bounds)
        });
        var overlay = L.layerGroup();
        this._overlayLayers[id] = overlay;

        var link = L.DomUtil.create('a', '', this._container);
        link.innerHTML = title;
        link.level = id;
        link.href = '#';

        L.DomEvent
            .on(link, 'mousedown dblclick', L.DomEvent.stopPropagation)
            .on(link, 'click', this._levelClick, this);

        this._levelButtons[id] = link;
        return overlay;
    },

    setLevel: function (id) {
        if (id === this.currentLevel) return true;
        if (this._tileLayers[id] === undefined) return false;

        if (this.currentLevel !== null) {
            this._tileLayers[this.currentLevel].remove();
            this._overlayLayers[this.currentLevel].remove();
            L.DomUtil.removeClass(this._levelButtons[this.currentLevel], 'current');
        }
        this._tileLayers[id].addTo(c3nav.map);
        this._overlayLayers[id].addTo(c3nav.map);
        L.DomUtil.addClass(this._levelButtons[id], 'current');
        this.currentLevel = id;
        return true;
    },

    _levelClick: function (e) {
        e.preventDefault();
        e.stopPropagation();
        this.setLevel(e.target.level);
    },

    finalize: function () {
        var buttons = $(this._container).find('a');
        buttons.addClass('current');
        buttons.width(buttons.width());
        buttons.removeClass('current');
    }
});
