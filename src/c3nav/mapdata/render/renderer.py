from itertools import chain

from django.utils.functional import cached_property
from shapely import prepared
from shapely.geometry import box

from c3nav.mapdata.models import Level
from c3nav.mapdata.render.engines.base import FillAttribs, StrokeAttribs
from c3nav.mapdata.render.geometry import hybrid_union
from c3nav.mapdata.render.renderdata import LevelRenderData


class MapRenderer:
    def __init__(self, level, minx, miny, maxx, maxy, scale=1, access_permissions=None, full_levels=False):
        self.level = level.pk if isinstance(level, Level) else level
        self.minx = minx
        self.miny = miny
        self.maxx = maxx
        self.maxy = maxy
        self.scale = scale
        self.access_permissions = set(access_permissions) if access_permissions else set()
        self.full_levels = full_levels

        self.width = int(round((maxx - minx) * scale))
        self.height = int(round((maxy - miny) * scale))

    @cached_property
    def bbox(self):
        return box(self.minx-1, self.miny-1, self.maxx+1, self.maxy+1)

    def render(self, engine_cls, center=True):
        # add no access restriction to “unlocked“ access restrictions so lookup gets easier
        access_permissions = self.access_permissions | set([None])

        bbox = prepared.prep(self.bbox)

        level_render_data = LevelRenderData.get(self.level)

        engine = engine_cls(self.width, self.height, self.minx, self.miny, float(level_render_data.base_altitude),
                            scale=self.scale, buffer=1, background='#DCDCDC', center=center)

        if self.full_levels:
            levels = tuple(chain(*(
                tuple(sublevel for sublevel in LevelRenderData.get(level.pk).levels
                      if sublevel.pk == level.pk or sublevel.on_top_of_id == level.pk)
                for level in level_render_data.levels if level.on_top_of_id is None
            )))
        else:
            levels = level_render_data.levels

        min_altitude = min(chain(*(tuple(area.altitude for area in geoms.altitudeareas)
                                   for geoms in levels)))

        not_full_levels = engine.is_3d  # always do non-full-levels until after the first primary level
        full_levels = self.full_levels and engine.is_3d
        for geoms in levels:
            engine.add_group('level_%s' % geoms.short_label)

            if geoms.pk == level_render_data.lowest_important_level:
                engine.darken(level_render_data.darken_area)

            if not bbox.intersects(geoms.affected_area):
                continue

            # hide indoor and outdoor rooms if their access restriction was not unlocked
            add_walls = hybrid_union(tuple(area for access_restriction, area in geoms.restricted_spaces_indoors.items()
                                           if access_restriction not in access_permissions))
            crop_areas = hybrid_union(
                tuple(area for access_restriction, area in geoms.restricted_spaces_outdoors.items()
                      if access_restriction not in access_permissions)
            ).union(add_walls)

            if not_full_levels:
                engine.add_geometry(geoms.walls_base, fill=FillAttribs('#aaaaaa'), category='walls')
                engine.add_geometry(geoms.walls_bottom.fit(scale=geoms.min_altitude-min_altitude,
                                                           offset=min_altitude-int(0.7*1000)),
                                    fill=FillAttribs('#aaaaaa'), category='walls')
                for i, altitudearea in enumerate(geoms.altitudeareas):
                    base = altitudearea.base.difference(crop_areas)
                    bottom = altitudearea.bottom.difference(crop_areas)
                    engine.add_geometry(base, fill=FillAttribs('#eeeeee'), category='ground', item=i)
                    engine.add_geometry(bottom.fit(scale=geoms.min_altitude - min_altitude,
                                                   offset=min_altitude - int(0.7 * 1000)),
                                        fill=FillAttribs('#aaaaaa'), category='ground')

            # render altitude areas in default ground color and add ground colors to each one afterwards
            # shadows are directly calculated and added by the engine
            for i, altitudearea in enumerate(geoms.altitudeareas):
                geometry = altitudearea.geometry.difference(crop_areas)
                if not_full_levels:
                    geometry = geometry.filter(bottom=False)
                engine.add_geometry(geometry, altitude=altitudearea.altitude, fill=FillAttribs('#eeeeee'),
                                    category='ground', item=i)

                j = 0
                for color, areas in altitudearea.colors.items():
                    # only select ground colors if their access restriction is unlocked
                    areas = tuple(area for access_restriction, area in areas.items()
                                  if access_restriction in access_permissions)
                    if areas:
                        j += 1
                        hexcolor = ''.join(hex(int(i*255))[2:].zfill(2) for i in engine.color_to_rgb(color)).upper()
                        engine.add_geometry(hybrid_union(areas), fill=FillAttribs(color),
                                            category='ground_%s' % hexcolor, item=j)

            # add obstacles after everything related to ground for the nice right order
            for i, altitudearea in enumerate(geoms.altitudeareas):
                for height, height_obstacles in altitudearea.obstacles.items():
                    for obstacle in height_obstacles:
                        engine.add_geometry(obstacle, fill=FillAttribs('#B7B7B7'),
                                            stroke=StrokeAttribs('#888888', 0.05, min_px=0.2), category='obstacles')

            # add walls, stroke_px makes sure that all walls are at least 1px thick on all zoom levels,
            walls = None
            if not add_walls.is_empty or not geoms.walls.is_empty:
                walls = geoms.walls.union(add_walls)

            walls_extended = geoms.walls_extended and full_levels
            if walls is not None:
                engine.add_geometry(walls.filter(bottom=not not_full_levels,
                                                 top=not walls_extended),
                                    height=geoms.default_height, fill=FillAttribs('#aaaaaa'), category='walls')

            for short_wall in geoms.short_walls:
                engine.add_geometry(short_wall.filter(bottom=not not_full_levels),
                                    fill=FillAttribs('#aaaaaa'), category='walls')

            if walls_extended:
                engine.add_geometry(geoms.walls_extended, fill=FillAttribs('#aaaaaa'), category='walls')

            doors_extended = geoms.doors_extended and full_levels
            if not geoms.doors.is_empty:
                engine.add_geometry(geoms.doors.difference(add_walls).filter(top=not doors_extended),
                                    fill=FillAttribs('#ffffff'),
                                    stroke=StrokeAttribs('#ffffff', 0.05, min_px=0.2),
                                    category='doors')

            if doors_extended:
                engine.add_geometry(geoms.doors_extended, fill=FillAttribs('#aaaaaa'), category='doors')

            if walls is not None:
                engine.add_geometry(walls, stroke=StrokeAttribs('#666666', 0.05, min_px=0.2), category='walls')

            if geoms.on_top_of_id is None:
                not_full_levels = not self.full_levels and engine.is_3d

        return engine
