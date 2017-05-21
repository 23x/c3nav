from collections import OrderedDict

from django.db import models
from django.utils.translation import ugettext_lazy as _
from shapely.geometry import CAP_STYLE, JOIN_STYLE, mapping

from c3nav.mapdata.fields import GeometryField
from c3nav.mapdata.models.geometry.base import GeometryMixin
from c3nav.mapdata.models.locations import SpecificLocation
from c3nav.mapdata.utils.json import format_geojson

SPACE_MODELS = []


class SpaceGeometryMixin(GeometryMixin):
    space = models.ForeignKey('mapdata.Space', on_delete=models.CASCADE, verbose_name=_('space'))

    class Meta:
        abstract = True

    def _serialize(self, space=True, **kwargs):
        result = super()._serialize(**kwargs)
        if space:
            result['space'] = self.space.id
        return result


class Area(SpecificLocation, SpaceGeometryMixin, models.Model):
    """
    An area in a space.
    """
    geometry = GeometryField('polygon')
    stuffed = models.BooleanField(verbose_name=_('stuffed area'), default=False)

    class Meta:
        verbose_name = _('Area')
        verbose_name_plural = _('Areas')
        default_related_name = 'areas'

    def _serialize(self, **kwargs):
        result = super()._serialize(**kwargs)
        result['stuffed'] = self.stuffed
        return result

    def get_color(self):
        color = super().get_color()
        if not color and self.stuffed:
            color = 'rgba(0, 0, 0, 0.04)'
        return color


class Stair(SpaceGeometryMixin, models.Model):
    """
    A stair
    """
    geometry = GeometryField('linestring')

    class Meta:
        verbose_name = _('Stair')
        verbose_name_plural = _('Stairs')
        default_related_name = 'stairs'

    def to_geojson(self):
        result = super().to_geojson()
        original_geometry = result['geometry']
        draw = self.geometry.buffer(0.05, join_style=JOIN_STYLE.mitre, cap_style=CAP_STYLE.flat)
        result['geometry'] = format_geojson(mapping(draw))
        result['original_geometry'] = original_geometry
        return result

    def to_shadow_geojson(self):
        shadow = self.geometry.parallel_offset(0.03, 'right', join_style=JOIN_STYLE.mitre)
        shadow = shadow.buffer(0.019, join_style=JOIN_STYLE.mitre, cap_style=CAP_STYLE.flat)
        return OrderedDict((
            ('type', 'Feature'),
            ('properties', OrderedDict((
                ('type', 'shadow'),
                ('original_type', self.__class__.__name__.lower()),
                ('original_id', self.id),
            ))),
            ('geometry', format_geojson(mapping(shadow), round=False)),
        ))


class Obstacle(SpaceGeometryMixin, models.Model):
    """
    An obstacle
    """
    geometry = GeometryField('polygon')

    class Meta:
        verbose_name = _('Obstacle')
        verbose_name_plural = _('Obstacles')
        default_related_name = 'obstacles'


class LineObstacle(SpaceGeometryMixin, models.Model):
    """
    An obstacle that is a line with a specific width
    """
    geometry = GeometryField('linestring')
    width = models.DecimalField(_('obstacle width'), max_digits=4, decimal_places=2, default=0.15)

    class Meta:
        verbose_name = _('Line Obstacle')
        verbose_name_plural = _('Line Obstacles')
        default_related_name = 'lineobstacles'

    def serialize(self, geometry=True, **kwargs):
        result = super().serialize(geometry=geometry, **kwargs)
        if geometry:
            result.move_to_end('buffered_geometry')
        return result

    def _serialize(self, geometry=True, **kwargs):
        result = super()._serialize(geometry=geometry, **kwargs)
        result['width'] = float(str(self.width))
        if geometry:
            result['buffered_geometry'] = format_geojson(mapping(self.buffered_geometry))
        return result

    @property
    def buffered_geometry(self):
        return self.geometry.buffer(self.width / 2, join_style=JOIN_STYLE.mitre, cap_style=CAP_STYLE.flat)

    def to_geojson(self):
        result = super().to_geojson()
        result['original_geometry'] = result['geometry']
        result['geometry'] = format_geojson(mapping(self.buffered_geometry))
        return result


class Point(SpecificLocation, SpaceGeometryMixin, models.Model):
    """
    An point in a space.
    """
    geometry = GeometryField('point')

    class Meta:
        verbose_name = _('Point')
        verbose_name_plural = _('Points')
        default_related_name = 'points'
