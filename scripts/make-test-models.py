#!/usr/bin/env python3
"""Small STL and 3MF fixtures for browser/native import checks."""
import pathlib, struct, zipfile
root = pathlib.Path('artifacts')
root.mkdir(exist_ok=True)
vertices = [(0, 0, 0), (20, 0, 0), (0, 20, 0), (0, 0, 20)]
faces = [(0, 2, 1), (0, 1, 3), (0, 3, 2), (1, 2, 3)]
text = 'solid tetrahedron\n'
binary = bytearray(80) + struct.pack('<I', len(faces))
for face in faces:
    text += 'facet normal 0 0 0\nouter loop\n'
    text += ''.join('vertex %s %s %s\n' % vertices[i] for i in face)
    text += 'endloop\nendfacet\n'
    binary += struct.pack('<12fH', 0, 0, 0, *(x for i in face for x in vertices[i]), 0)
(root / 'tetrahedron.stl').write_text(text + 'endsolid tetrahedron\n')
(root / 'tetrahedron-binary.stl').write_bytes(binary)
model = '''<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<resources><basematerials id="2"><base name="Green" displaycolor="#40C090FF"/></basematerials>
<object id="1" type="model" pid="2" pindex="0"><mesh><vertices>'''
model += ''.join('<vertex x="%s" y="%s" z="%s"/>' % v for v in vertices)
model += '</vertices><triangles>'
model += ''.join('<triangle v1="%s" v2="%s" v3="%s"/>' % f for f in faces)
model += '</triangles></mesh></object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 30 40 50"/></build></model>'
with zipfile.ZipFile(root / 'tetrahedron.3mf', 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>')
    z.writestr('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')
    z.writestr('3D/3dmodel.model', model)
print(root.resolve())
