# -*- coding: utf-8 -*-
# Generated by Django 1.11.6 on 2017-11-16 01:45
from __future__ import unicode_literals

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('mapdata', '0046_remove_level_render_data'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='mapupdate',
            name='changed_geometries',
        ),
    ]
