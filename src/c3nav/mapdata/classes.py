import json
import os
from collections import OrderedDict


class MapInitError(Exception):
    pass


class MapManager:
    def __init__(self):
        self.main_pkg = None
        self.pkgs = OrderedDict()
        self.levels = []

    def add_map_dir(self, path):
        pkg = MapDataPackage(path)
        if pkg.name in self.pkgs:
            raise MapInitError('Duplicate map package: '+pkg.name)

        if pkg.extends is None:
            if self.main_pkg is not None:
                raise MapInitError('There can not be more than one root map package: tried to add '+pkg.name+', '
                                   'but '+self.main_pkg.name+' was there first.')
            self.main_pkg = pkg
            self.levels = pkg.levels
            self.size = pkg.size
        else:
            if pkg.extends not in self.pkgs:
                raise MapInitError('map package'+pkg.name+' extends '+pkg.exends+', which was not imported '
                                   'beforehand.')

        self.pkgs[pkg.name] = pkg

    @property
    def all_sources(self):
        return sum((pkg.sources for pkg in self.pkgs), [])


class MapDataPackage:
    def __init__(self, path):
        self.path = path

        main_file = os.path.join(path, 'map.json')
        try:
            data = json.load(open(main_file))
        except FileNotFoundError:
            raise MapInitError(main_file+' not found')
        except json.decoder.JSONDecodeError as e:
            raise MapInitError('Could not decode '+main_file+': '+str(e))

        self.name = data.get('name')
        if self.name is None:
            raise MapInitError('Map package '+path+' has no name in map.json.')

        self.extends = data.get('extends')

        self.size = data.get('size')

        self.sources = tuple(MapSource(self, name, source)
                             for name, source in data.get('sources', {}).items())

        self.levels = data.get('levels')


class MapSource:
    def __init__(self, pkg, name, data):
        self.name = name
        self.src = os.path.join(pkg.path, data['src'])
        self.bounds = data['bounds']
